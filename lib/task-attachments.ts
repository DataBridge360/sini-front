// Adjuntos de una actividad: tipos permitidos, compresión y validación en el
// navegador, antes de que el archivo viaje.
//
// El backend valida lo mismo (es la autoridad real); acá se valida para que el
// usuario se entere del problema al instante en vez de después de subir 5 MB.

import type { TaskAttachment } from "@/lib/api";
import { compressAttachment } from "@/lib/media";

// 5 MB estrictos por archivo, medidos DESPUÉS de comprimir.
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 10;

// Se aceptan MIME y extensiones: Windows y Safari mandan el MIME equivocado para
// varios .csv y .docx, y con solo MIMEs el selector de archivos los muestra
// grises.
export const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv"
].join(",");

export const ATTACHMENT_TYPES_HINT =
  "Imágenes, PDF, Word y Excel · hasta 5 MB por archivo";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv"
]);

const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv"
]);

// "video" no se puede subir más; existe solo para renderizar lo ya subido.
export type AttachmentKind = "image" | "pdf" | "word" | "excel" | "video" | "file";

function extensionOf(fileName: string) {
  return fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
}

export function attachmentKind(mimeType: string, fileName = ""): AttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("word")) return "word";
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "text/csv") {
    return "excel";
  }

  // El MIME puede venir mal; la extensión desempata.
  const extension = extensionOf(fileName);
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["doc", "docx"].includes(extension)) return "word";
  if (["xls", "xlsx", "csv"].includes(extension)) return "excel";
  return "file";
}

const KIND_LABELS: Record<AttachmentKind, string> = {
  image: "Imagen",
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  video: "Video",
  file: "Archivo"
};

export function attachmentKindLabel(kind: AttachmentKind) {
  return KIND_LABELS[kind];
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;
}

export type PreparedAttachment =
  | { ok: true; id: string; file: File; previewUrl: string | null; kind: AttachmentKind }
  | { ok: false; id: string; fileName: string; error: string };

let preparedCounter = 0;

function isAllowed(file: File) {
  return ALLOWED_MIME_TYPES.has(file.type) || ALLOWED_EXTENSIONS.has(extensionOf(file.name));
}

// Comprime primero y valida después: una foto de celular de 8 MB suele quedar
// muy por debajo del límite tras pasar por compressAttachment, así que
// rechazarla antes de comprimir sería rechazar algo que sí entra.
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const id = `att-${++preparedCounter}`;

  if (!isAllowed(file)) {
    return {
      ok: false,
      id,
      fileName: file.name,
      error: `«${file.name}» no es un formato permitido. Se aceptan imágenes, PDF, Word y Excel.`
    };
  }

  // Solo se comprimen imágenes; los documentos van tal cual (ver lib/media.ts).
  const prepared = await compressAttachment(file);

  if (prepared.size > ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      id,
      fileName: file.name,
      error: `«${file.name}» pesa ${formatFileSize(prepared.size)}. El límite es 5 MB por archivo.`
    };
  }

  const kind = attachmentKind(prepared.type, prepared.name);
  return {
    ok: true,
    id,
    file: prepared,
    previewUrl: kind === "image" ? URL.createObjectURL(prepared) : null,
    kind
  };
}

export function releasePreview(prepared: PreparedAttachment) {
  if (prepared.ok && prepared.previewUrl) {
    URL.revokeObjectURL(prepared.previewUrl);
  }
}

// Las imágenes de una tarea, en orden cronológico, para que el lightbox pueda
// recorrerlas todas y no solo las de una actividad.
export function collectImages(attachments: TaskAttachment[]) {
  return attachments.filter(
    (attachment) => attachment.url && attachmentKind(attachment.mime_type, attachment.file_name) === "image"
  );
}
