import "server-only";
import { randomUUID } from "node:crypto";
import {
  GESTI_UPLOAD_MIME_TYPES,
  MAX_GESTI_FILE_BYTES,
  MAX_GESTI_FILES_PER_MESSAGE,
  type GestiFileUrl,
  type GestiSignedUpload,
  type GestiUploadedFile
} from "@/lib/gesti-contract";
import type { GestiFileRef } from "@/lib/gesti-parts";
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException
} from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import { isUuid } from "@/server/core/postgrest";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import { detectDocumentKind, extractDocument, UnsupportedDocumentError } from "./documents/extract";
import type { ConfirmUploadsDto, SignUploadsDto } from "./schemas";

// Archivos de Gesti: los que sube la persona (URL firmada a Storage, igual que
// los adjuntos de tareas: Vercel corta los bodies en 4.5 MB) y los que genera
// Gesti. Cada archivo es de UN usuario en UNA organización; todo acceso filtra
// por las dos cosas.

export const GESTI_BUCKET = "gesti-files";
const SIGNED_URL_TTL_SECONDS = 600;

const EXTENSION_BY_MIME = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["text/csv", "csv"],
  ["text/plain", "txt"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

const MIME_BY_EXTENSION = new Map<string, string>(
  [...EXTENSION_BY_MIME].map(([mime, extension]) => [extension, mime])
);
MIME_BY_EXTENSION.set("jpeg", "image/jpeg");

const ALLOWED_MIME: ReadonlySet<string> = new Set(GESTI_UPLOAD_MIME_TYPES);
const PATH_EXTENSIONS = [...new Set(EXTENSION_BY_MIME.values())].join("|");
const PATH_NAME_PATTERN = new RegExp(`^[a-z0-9-]{1,48}\\.(${PATH_EXTENSIONS})$`);

const TYPES_MESSAGE =
  "Gesti lee PDF, Word (.docx), Excel (.xlsx), CSV, TXT e imágenes (PNG, JPG, WEBP, GIF).";
const INVALID_UPLOAD_MESSAGE = "Adjunto inválido. Volvé a adjuntar el archivo.";

export type GestiFileRow = {
  id: string;
  conversation_id: string | null;
  origin: "upload" | "generated";
  path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  extracted_text?: string | null;
  text_truncated?: boolean;
};

const FILE_META_COLUMNS = "id,conversation_id,origin,path,name,mime_type,size_bytes,page_count,text_truncated";
const FILE_FULL_COLUMNS = `${FILE_META_COLUMNS},extracted_text`;

function displayName(name: string) {
  return name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) || "archivo";
}

/** Nombre de objeto seguro: minúsculas, [a-z0-9-] y la extensión. */
function storageFileName(name: string, extension: string) {
  const base =
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "archivo";
  return `${base}.${extension}`;
}

function tooLargeMessage(name: string, size: number) {
  const megabytes = (size / 1_048_576).toFixed(1).replace(".", ",");
  const limit = MAX_GESTI_FILE_BYTES / 1_048_576;
  return `«${name}» pesa ${megabytes} MB. El límite es ${limit} MB por archivo.`;
}

export function fileRefFromRow(row: Pick<GestiFileRow, "id" | "name" | "size_bytes" | "mime_type">): GestiFileRef {
  return { fileId: row.id, name: row.name, size: Number(row.size_bytes), mime: row.mime_type };
}

export class GestiFilesService {
  private readonly logger = new Logger(GestiFilesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get storage() {
    return this.supabase.admin.storage.from(GESTI_BUCKET);
  }

  // Paso 1: valida y firma una subida directa por archivo. El path lo elige el
  // server: <org>/<usuario>/<uuid>/<nombre seguro>.
  async createUploads(organizationId: string, userId: string, dto: SignUploadsDto): Promise<GestiSignedUpload[]> {
    if (dto.files.length > MAX_GESTI_FILES_PER_MESSAGE) {
      throw new BadRequestException(`Se pueden adjuntar hasta ${MAX_GESTI_FILES_PER_MESSAGE} archivos por mensaje.`);
    }

    // Validar todo antes de firmar nada.
    const prepared = dto.files.map((file) => {
      const name = displayName(file.name);
      if (!file.size) throw new BadRequestException("El archivo está vacío.");
      if (file.size > MAX_GESTI_FILE_BYTES) throw new BadRequestException(tooLargeMessage(name, file.size));
      const contentType = this.normalizeMime(file.contentType, file.name, name);
      const extension = EXTENSION_BY_MIME.get(contentType)!;
      return {
        name,
        contentType,
        path: `${organizationId}/${userId}/${randomUUID()}/${storageFileName(file.name, extension)}`
      };
    });

    const uploads: GestiSignedUpload[] = [];
    for (const item of prepared) {
      const { data, error } = await this.storage.createSignedUploadUrl(item.path);
      if (error || !data) {
        throw supabaseError(this.logger, "gesti.createUploads", error, `No se pudo preparar la subida de «${item.name}».`);
      }
      uploads.push({
        name: item.name,
        path: item.path,
        contentType: item.contentType,
        signedUrl: data.signedUrl,
        token: data.token
      });
    }
    return uploads;
  }

  // Paso 2: verifica lo que realmente quedó en Storage, lo lee y lo registra.
  // Todo o nada: si algo falla se borran los objetos de este pedido.
  async confirmUploads(organizationId: string, userId: string, dto: ConfirmUploadsDto): Promise<GestiUploadedFile[]> {
    const paths = dto.uploads.map((upload) => upload.path);
    if (new Set(paths).size !== paths.length || paths.some((path) => !this.isOwnUploadPath(organizationId, userId, path))) {
      // Un path ajeno no se toca: ni se verifica ni se borra.
      throw new BadRequestException(INVALID_UPLOAD_MESSAGE);
    }

    const { data: used, error: usedError } = await this.supabase.admin
      .from("gesti_files")
      .select("path")
      .in("path", paths);
    if (usedError) {
      throw supabaseError(this.logger, "gesti.confirmUploads.used", usedError, "No se pudo leer el archivo.");
    }
    if ((used ?? []).length > 0) {
      throw new BadRequestException(INVALID_UPLOAD_MESSAGE);
    }

    try {
      const rows: Array<Record<string, unknown>> = [];
      for (const upload of dto.uploads) {
        rows.push(await this.readUpload(organizationId, userId, upload));
      }

      const { data, error } = await this.supabase.admin
        .from("gesti_files")
        .insert(rows)
        .select("id,path,name,mime_type,size_bytes,page_count");
      if (error) {
        throw supabaseError(this.logger, "gesti.confirmUploads.insert", error, "No se pudo guardar el archivo.");
      }

      const byPath = new Map(
        ((data ?? []) as unknown as Array<GestiFileRow>).map((row) => [row.path, row] as const)
      );
      return paths.map((path) => {
        const row = byPath.get(path)!;
        return { ...fileRefFromRow(row), pages: row.page_count };
      });
    } catch (cause) {
      await this.removeObjects("gesti.confirmUploads.rejected", paths);
      throw cause;
    }
  }

  /** Los archivos de este usuario/organización entre `ids` (los demás no existen para él). */
  async findOwned(
    organizationId: string,
    userId: string,
    ids: string[],
    options: { withText: boolean }
  ): Promise<GestiFileRow[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase.admin
      .from("gesti_files")
      .select(options.withText ? FILE_FULL_COLUMNS : FILE_META_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .in("id", ids);
    if (error) {
      throw supabaseError(this.logger, "gesti.findOwned", error, "No se pudo leer el archivo.");
    }
    return (data ?? []) as unknown as GestiFileRow[];
  }

  /** Vincula archivos recién subidos a la conversación (solo los que aún no tienen una). */
  async attachToConversation(organizationId: string, userId: string, ids: string[], conversationId: string) {
    if (ids.length === 0) return;
    const { error } = await this.supabase.admin
      .from("gesti_files")
      .update({ conversation_id: conversationId })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .is("conversation_id", null)
      .in("id", ids);
    if (error) {
      throw supabaseError(this.logger, "gesti.attachToConversation", error, "No se pudo guardar el mensaje.");
    }
  }

  async download(path: string): Promise<Uint8Array> {
    const { data, error } = await this.storage.download(path);
    if (error || !data) {
      this.logger.error(`gesti.download: ${error?.message ?? "empty body"}`);
      throw new BadRequestException("No se pudo leer el archivo.");
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  /** Guarda un archivo generado por Gesti y lo vincula a la conversación. */
  async storeGenerated(
    organizationId: string,
    userId: string,
    conversationId: string,
    file: { bytes: Uint8Array; mime: string; filename: string }
  ): Promise<GestiFileRef> {
    const extension = EXTENSION_BY_MIME.get(file.mime) ?? file.filename.split(".").pop() ?? "bin";
    const path = `${organizationId}/${userId}/${randomUUID()}/${storageFileName(file.filename, extension)}`;

    const { error: uploadError } = await this.storage.upload(path, file.bytes, {
      contentType: file.mime,
      upsert: false
    });
    if (uploadError) {
      throw supabaseError(this.logger, "gesti.storeGenerated.upload", uploadError, "No se pudo guardar el archivo.");
    }

    const { data, error } = await this.supabase.admin
      .from("gesti_files")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        conversation_id: conversationId,
        origin: "generated",
        path,
        name: displayName(file.filename),
        mime_type: file.mime,
        size_bytes: file.bytes.byteLength
      })
      .select("id,name,mime_type,size_bytes")
      .single();
    if (error) {
      await this.removeObjects("gesti.storeGenerated.insert", [path]);
      throw supabaseError(this.logger, "gesti.storeGenerated.insert", error, "No se pudo guardar el archivo.");
    }
    return fileRefFromRow(data as unknown as GestiFileRow);
  }

  // GET /gesti/files/:id/url — solo el dueño; URL firmada de 10 minutos.
  async getUrl(organizationId: string, userId: string, fileId: string): Promise<GestiFileUrl> {
    const [file] = await this.findOwned(organizationId, userId, [fileId], { withText: false });
    if (!file) {
      throw new NotFoundException("File not found");
    }

    const { data, error } = await this.storage.createSignedUrl(file.path, SIGNED_URL_TTL_SECONDS, {
      download: file.name
    });
    if (error || !data?.signedUrl) {
      throw supabaseError(this.logger, "gesti.getUrl", error, "No se pudo preparar la descarga.");
    }
    return { url: data.signedUrl };
  }

  private normalizeMime(declared: string, rawName: string, shownName: string): string {
    const type = declared.split(";")[0]!.trim().toLowerCase();
    if (ALLOWED_MIME.has(type)) return type;
    const extension = rawName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const byExtension = extension ? MIME_BY_EXTENSION.get(extension) : undefined;
    if (byExtension) return byExtension;
    throw new BadRequestException(`«${shownName}» no es un formato permitido. ${TYPES_MESSAGE}`);
  }

  // Solo paths con la forma exacta que genera createUploads, dentro de la
  // carpeta de este usuario en esta organización.
  private isOwnUploadPath(organizationId: string, userId: string, path: string) {
    const [folderOrg, folderUser, folderId, fileName, ...rest] = path.split("/");
    return (
      rest.length === 0 &&
      folderOrg === organizationId &&
      folderUser === userId &&
      isUuid(folderId ?? "") &&
      PATH_NAME_PATTERN.test(fileName ?? "")
    );
  }

  // Lo que declara el navegador no es confiable: tamaño y formato salen del
  // objeto que quedó en Storage; el MIME esperado sale de la extensión del path.
  private async readUpload(
    organizationId: string,
    userId: string,
    upload: { path: string; name: string }
  ): Promise<Record<string, unknown>> {
    const name = displayName(upload.name);
    const { data, error } = await this.storage.info(upload.path);
    if (error || !data) {
      throw new BadRequestException(`No se encontró «${name}». Volvé a adjuntarlo.`);
    }

    const info = data as { size?: number; contentType?: string; metadata?: { size?: number; mimetype?: string } };
    const size = Number(info.size ?? info.metadata?.size ?? 0);
    const contentType = String(info.contentType ?? info.metadata?.mimetype ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();

    if (!size) throw new BadRequestException("El archivo está vacío.");
    if (size > MAX_GESTI_FILE_BYTES) throw new BadRequestException(tooLargeMessage(name, size));

    const extension = upload.path.slice(upload.path.lastIndexOf(".") + 1);
    const mime = MIME_BY_EXTENSION.get(extension);
    if (!mime || contentType !== mime) {
      throw new BadRequestException(`«${name}» no es un formato permitido. ${TYPES_MESSAGE}`);
    }

    let extracted: { text: string; pages: number | null; truncated: boolean } | null = null;
    if (detectDocumentKind(mime, upload.path)) {
      const bytes = await this.download(upload.path);
      try {
        extracted = await extractDocument(bytes, mime, name);
      } catch (cause) {
        if (cause instanceof UnsupportedDocumentError) {
          throw new UnprocessableEntityException(cause.message);
        }
        this.logger.error("gesti.readUpload: extraction failed", cause);
        throw new UnprocessableEntityException(`No pude leer «${name}». El archivo parece estar dañado o protegido.`);
      }
    }

    return {
      organization_id: organizationId,
      user_id: userId,
      origin: "upload",
      path: upload.path,
      name,
      mime_type: mime,
      size_bytes: size,
      page_count: extracted?.pages ?? null,
      extracted_text: extracted?.text ?? null,
      text_truncated: extracted?.truncated ?? false
    };
  }

  // Best effort: los objetos huérfanos no son accesibles (bucket privado).
  private async removeObjects(scope: string, paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.storage.remove(paths);
    if (error) {
      this.logger.warn(`${scope}: no se pudieron borrar archivos del storage (${error.message})`);
    }
  }
}
