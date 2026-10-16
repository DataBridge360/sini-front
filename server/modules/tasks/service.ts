import "server-only";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@/server/core/http-errors";
import { Logger } from "@/server/core/logger";
import {
  clampPage,
  pageRange,
  PAGE_SIZE_DEFAULT,
  type Paginated
} from "@/server/core/pagination";
import { escapeLikePattern } from "@/server/core/postgrest";
import type { SupabaseService } from "@/server/core/supabase";
import { supabaseError } from "@/server/core/supabase-error";
import type { OrganizationContext } from "@/server/core/context";
import { canTransitionStatus, transitionErrorMessage } from "./tasks.rules";
import {
  taskBoardStatusValues,
  type CreateTaskDto,
  type CreateTaskMessageDto,
  type ListTasksQueryDto,
  type TaskStatsQueryDto,
  type TaskStatus,
  type UpdateTaskDto,
  type UpdateTaskStatusDto
} from "./schemas";

// Contrato de GET /tasks/stats. El frontend lo espeja en lib/api.ts.
export type TaskStats = {
  pendiente: number;
  en_proceso: number;
  revision: number;
  finalizado: number;
  activas: number;
};

export type UploadedAttachmentFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

type AttachmentRow = {
  storage_path: string;
  message_id?: string | null;
  url?: string | null;
};
type MessageRow = { id: string; attachments?: AttachmentRow[] };
type TaskDetailRow = { id: string; messages?: MessageRow[]; attachments?: AttachmentRow[] };
type CountRow = { count: number };
type TaskListRow = {
  id: string;
  messages?: CountRow[];
  attachments?: CountRow[];
};

const TASK_BASE_SELECT =
  "id,title,status,priority,due_date,created_at,updated_at,archived_at," +
  "assigned_to_user_id,created_by_user_id,approved_by_user_id," +
  "assigned_to:user_profiles!tasks_assigned_to_user_id_fkey(id,full_name)," +
  "created_by:user_profiles!tasks_created_by_user_id_fkey(id,full_name)," +
  "approved_by:user_profiles!tasks_approved_by_user_id_fkey(id,full_name)," +
  "clients!tasks_client_fk(id,full_name)," +
  "policies!tasks_policy_fk(id,policy_number,branch,vehicle_plate,clients!policies_client_fk(id,full_name))";

// Listado: solo contadores. Sin `description` (documento TipTap que puede pesar
// 60kb por tarea) y sin adjuntos embebidos, así el tablero no arrastra ni firma
// URLs que nadie va a mirar.
const TASK_LIST_SELECT =
  `${TASK_BASE_SELECT},messages:task_messages(count),attachments:task_attachments(count)`;

const ATTACHMENT_FIELDS =
  "id,message_id,file_name,mime_type,file_size_bytes,storage_path,created_at,uploaded_by_user_id," +
  "uploaded_by:user_profiles!task_attachments_uploaded_by_user_id_fkey(id,full_name)";

const MESSAGE_FIELDS =
  "id,message,created_at,user_id,user:user_profiles!task_messages_user_id_fkey(id,full_name)";

// Detalle: todo. Los adjuntos vienen en un único embed plano (incluyendo
// message_id) y se reparten en JS entre sus mensajes — PostgREST no permite dos
// alias del mismo recurso embebido con filtros distintos de forma confiable.
const TASK_DETAIL_SELECT =
  `${TASK_BASE_SELECT},description,` +
  `messages:task_messages(${MESSAGE_FIELDS}),` +
  `attachments:task_attachments(${ATTACHMENT_FIELDS})`;

// Debe coincidir con allowed_mime_types/file_size_limit del bucket
// task-attachments (ver 20260728100300_task_attachments_bucket_types.sql).
// Los videos salieron del allowlist: los ya subidos se siguen sirviendo, pero no
// se aceptan nuevos (no hay forma razonable de comprimirlos en el navegador).
export const ATTACHMENT_MIME_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["text/csv", "csv"]
]);

// Inverso, para recuperar el MIME real cuando el navegador miente (Windows y
// Safari mandan application/octet-stream o text/plain para varios .csv/.docx).
export const MIME_BY_EXTENSION = new Map(
  [...ATTACHMENT_MIME_TYPES].map(([mime, extension]) => [extension, mime])
);
MIME_BY_EXTENSION.set("jpeg", "image/jpeg");

export const ATTACHMENT_TYPES_MESSAGE =
  "Se permiten imágenes (PNG, JPG, WEBP, GIF), PDF, Word (DOC, DOCX) y Excel (XLS, XLSX, CSV).";

export const ATTACHMENT_MAX_SIZE_BYTES = 5_242_880; // 5 MB por archivo, ya comprimido
export const ATTACHMENT_MAX_FILES = 10;
export const ATTACHMENT_BUCKET = "task-attachments";
const SIGNED_URL_TTL_SECONDS = 3600;

export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // Tablero: solo tareas activas. Las finalizadas están archivadas y se piden
  // aparte, paginadas — crecen sin techo y arruinarían este listado.
  // Orden: las más cerca de vencer primero (vencidas arriba). Sin fecha, al final.
  async findBoard(organizationId: string) {
    const { data, error } = await this.supabase.admin
      .from("tasks")
      .select(TASK_LIST_SELECT)
      .eq("organization_id", organizationId)
      .in("status", [...taskBoardStatusValues])
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      throw supabaseError(this.logger, "tasks.findBoard", error, "No se pudieron obtener las tareas.");
    }

    return ((data ?? []) as unknown as TaskListRow[]).map((task) => this.flattenCounts(task));
  }

  // Archivadas: paginación numerada (PAGINADO.md). Dos round-trips chicos, un
  // head-count con los mismos filtros y después la página.
  async findArchivedPage(
    organizationId: string,
    options: ListTasksQueryDto
  ): Promise<Paginated<unknown>> {
    const pageSize = options.pageSize ?? PAGE_SIZE_DEFAULT;
    const search = options.search ?? null;
    const priority = options.priority ?? null;
    const assignedTo = options.assignedTo ?? null;

    let countQuery = this.supabase.admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "finalizado");

    // La búsqueda en archivadas es solo por título: filtrar por asegurado o
    // póliza exigiría un join que encarece el head-count de cada página.
    if (search) countQuery = countQuery.ilike("title", `%${escapeLikePattern(search)}%`);
    if (priority) countQuery = countQuery.eq("priority", priority);
    if (assignedTo) countQuery = countQuery.eq("assigned_to_user_id", assignedTo);

    const { count, error: countError } = await countQuery;
    if (countError) {
      throw supabaseError(
        this.logger,
        "tasks.findArchivedPage.count",
        countError,
        "No se pudieron obtener las tareas archivadas."
      );
    }

    const total = count ?? 0;
    const page = clampPage(options.page ?? 1, pageSize, total);
    const { from, to } = pageRange(page, pageSize);

    let query = this.supabase.admin
      .from("tasks")
      .select(TASK_LIST_SELECT)
      .eq("organization_id", organizationId)
      .eq("status", "finalizado");

    if (search) query = query.ilike("title", `%${escapeLikePattern(search)}%`);
    if (priority) query = query.eq("priority", priority);
    if (assignedTo) query = query.eq("assigned_to_user_id", assignedTo);

    const { data, error } = await query
      // archived_at y no updated_at: editar el título de una archivada no debe
      // reordenar la lista.
      .order("archived_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      throw supabaseError(
        this.logger,
        "tasks.findArchivedPage",
        error,
        "No se pudieron obtener las tareas archivadas."
      );
    }

    const items = ((data ?? []) as unknown as TaskListRow[]).map((task) => this.flattenCounts(task));
    return { items, total, page, pageSize };
  }

  // Recuento por etapa para el dashboard. Cuatro head-counts (COUNT en el
  // servidor, cero filas por la red): 'finalizado' crece sin techo y contarlo
  // trayendo las filas es exactamente lo que este endpoint existe para evitar.
  // Sin `assignedTo` cuenta toda la organización; con él, lo de esa persona.
  async findStats(organizationId: string, options: TaskStatsQueryDto): Promise<TaskStats> {
    const assignedTo = options.assignedTo ?? null;

    const countByStatus = async (status: TaskStatus) => {
      let query = this.supabase.admin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", status);

      if (assignedTo) query = query.eq("assigned_to_user_id", assignedTo);

      const { count, error } = await query;
      if (error) {
        throw supabaseError(
          this.logger,
          "tasks.findStats",
          error,
          "No se pudieron obtener los recuentos de tareas."
        );
      }
      return count ?? 0;
    };

    const [pendiente, enProceso, revision, finalizado] = await Promise.all([
      countByStatus("pendiente"),
      countByStatus("en_proceso"),
      countByStatus("revision"),
      countByStatus("finalizado")
    ]);

    return {
      pendiente,
      en_proceso: enProceso,
      revision,
      finalizado,
      // Lo que sigue en el tablero: las tres etapas vivas.
      activas: pendiente + enProceso + revision
    };
  }

  async findOne(organizationId: string, taskId: string) {
    const { data, error } = await this.supabase.admin
      .from("tasks")
      .select(TASK_DETAIL_SELECT)
      .eq("organization_id", organizationId)
      .eq("id", taskId)
      .order("created_at", { ascending: true, referencedTable: "messages" })
      .order("created_at", { ascending: true, referencedTable: "attachments" })
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "tasks.findOne", error, "No se pudo obtener la tarea.");
    }
    if (!data) {
      throw new NotFoundException("Task not found");
    }

    return this.withTaskAttachmentUrls(data as unknown as TaskDetailRow);
  }

  async create(organizationId: string, userId: string, dto: CreateTaskDto) {
    if (dto.assignedToUserId) {
      await this.ensureMemberInOrganization(organizationId, dto.assignedToUserId);
    }

    const { data, error } = await this.supabase.admin
      .from("tasks")
      .insert({
        organization_id: organizationId,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status ?? "pendiente",
        priority: dto.priority ?? "media",
        due_date: dto.dueDate ?? null,
        assigned_to_user_id: dto.assignedToUserId ?? null,
        client_id: dto.clientId ?? null,
        policy_id: dto.policyId ?? null,
        created_by_user_id: userId
      })
      .select(TASK_DETAIL_SELECT)
      .single();

    if (error) {
      // FK compuesta (id, organization_id): un cliente/póliza de otra organización
      // o inexistente cae acá como violación de clave foránea.
      if (error.code === "23503") {
        throw new BadRequestException("La referencia a cliente o póliza no es válida.");
      }
      throw supabaseError(this.logger, "tasks.create", error, "No se pudo crear la tarea.");
    }

    return this.withTaskAttachmentUrls(data as unknown as TaskDetailRow);
  }

  async update(organizationId: string, taskId: string, dto: UpdateTaskDto) {
    await this.ensureTaskInOrganization(organizationId, taskId);

    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.dueDate !== undefined) patch.due_date = dto.dueDate;
    if (dto.clientId !== undefined) patch.client_id = dto.clientId;
    if (dto.policyId !== undefined) patch.policy_id = dto.policyId;
    if (dto.assignedToUserId !== undefined) {
      if (dto.assignedToUserId) {
        await this.ensureMemberInOrganization(organizationId, dto.assignedToUserId);
      }
      patch.assigned_to_user_id = dto.assignedToUserId;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("No hay cambios para guardar.");
    }

    const { data, error } = await this.supabase.admin
      .from("tasks")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", taskId)
      .select(TASK_DETAIL_SELECT)
      .single();

    if (error) {
      if (error.code === "23503") {
        throw new BadRequestException("La referencia a cliente o póliza no es válida.");
      }
      throw supabaseError(this.logger, "tasks.update", error, "No se pudo actualizar la tarea.");
    }

    return this.withTaskAttachmentUrls(data as unknown as TaskDetailRow);
  }

  // Único camino para cambiar de etapa. Acá vive el gate de aprobación: solo un
  // productor aprueba (-> finalizado), rechaza (saca de revision) y desarchiva.
  async updateStatus(
    organization: OrganizationContext,
    taskId: string,
    userId: string,
    dto: UpdateTaskStatusDto
  ) {
    const current = await this.ensureTaskInOrganization(organization.id, taskId);
    const from = current.status;

    if (from === dto.status) {
      return this.findOne(organization.id, taskId);
    }

    if (!canTransitionStatus(from, dto.status, this.canModerate(organization))) {
      throw new ForbiddenException(transitionErrorMessage(from, dto.status));
    }

    const { data, error } = await this.supabase.admin
      .from("tasks")
      .update({
        status: dto.status,
        // Quién aprobó. archived_at lo sella el trigger de la base.
        approved_by_user_id: dto.status === "finalizado" ? userId : null
      })
      .eq("organization_id", organization.id)
      .eq("id", taskId)
      .select(TASK_DETAIL_SELECT)
      .single();

    if (error) {
      throw supabaseError(this.logger, "tasks.updateStatus", error, "No se pudo mover la tarea.");
    }

    return this.withTaskAttachmentUrls(data as unknown as TaskDetailRow);
  }

  async delete(organization: OrganizationContext, taskId: string, userId: string) {
    const { data, error } = await this.supabase.admin
      .from("tasks")
      .select("id,created_by_user_id,attachments:task_attachments(storage_path)")
      .eq("organization_id", organization.id)
      .eq("id", taskId)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "tasks.delete", error, "No se pudo eliminar la tarea.");
    }
    if (!data) {
      throw new NotFoundException("Task not found");
    }

    if (data.created_by_user_id !== userId && !this.canModerate(organization)) {
      throw new ForbiddenException("Solo quien creó la tarea o un productor pueden eliminarla.");
    }

    await this.removeStoredFiles(
      "tasks.delete",
      (data.attachments ?? []).map((attachment) => attachment.storage_path)
    );

    const { error: deleteError } = await this.supabase.admin
      .from("tasks")
      .delete()
      .eq("organization_id", organization.id)
      .eq("id", taskId);

    if (deleteError) {
      throw supabaseError(this.logger, "tasks.delete", deleteError, "No se pudo eliminar la tarea.");
    }

    return { ok: true };
  }

  // Una actividad = texto y/o archivos, en una sola request multipart.
  //
  // Todo o nada: los archivos se validan ANTES de tocar storage y, si algo falla
  // después, se borran los objetos subidos y el mensaje. El usuario ve "se envió
  // todo" o "no se envió nada", nunca una actividad a medias.
  async addMessage(
    organizationId: string,
    taskId: string,
    userId: string,
    dto: CreateTaskMessageDto,
    files: UploadedAttachmentFile[]
  ) {
    await this.ensureTaskInOrganization(organizationId, taskId);

    const message = dto.message ?? null;
    if (!message && files.length === 0) {
      throw new BadRequestException("Escribí algo o adjuntá un archivo.");
    }
    if (files.length > ATTACHMENT_MAX_FILES) {
      throw new BadRequestException(`Se pueden adjuntar hasta ${ATTACHMENT_MAX_FILES} archivos por actividad.`);
    }

    // 1) Validar todo antes de subir nada.
    const prepared = files.map((file) => this.prepareAttachment(organizationId, taskId, file));

    // 2) Insertar el mensaje.
    const { data: created, error } = await this.supabase.admin
      .from("task_messages")
      .insert({
        organization_id: organizationId,
        task_id: taskId,
        user_id: userId,
        message
      })
      .select(MESSAGE_FIELDS)
      .single();

    if (error) {
      throw supabaseError(this.logger, "tasks.addMessage", error, "No se pudo enviar la actividad.");
    }

    if (prepared.length === 0) {
      return { ...created, attachments: [] };
    }

    // 3) Subir los objetos. 4) Insertar las filas. 5) Rollback si algo falla.
    const uploaded: string[] = [];
    try {
      for (const item of prepared) {
        const { error: uploadError } = await this.supabase.admin.storage
          .from(ATTACHMENT_BUCKET)
          .upload(item.path, item.file.buffer, {
            cacheControl: "31536000",
            contentType: item.mimeType,
            upsert: false
          });
        if (uploadError) {
          throw supabaseError(
            this.logger,
            "tasks.addMessage.storage",
            uploadError,
            `No se pudo subir «${item.displayName}».`
          );
        }
        uploaded.push(item.path);
      }

      const { data: attachments, error: attachmentsError } = await this.supabase.admin
        .from("task_attachments")
        .insert(
          prepared.map((item) => ({
            organization_id: organizationId,
            task_id: taskId,
            message_id: created.id,
            uploaded_by_user_id: userId,
            file_name: item.displayName,
            mime_type: item.mimeType,
            file_size_bytes: item.file.size,
            storage_path: item.path
          }))
        )
        .select(ATTACHMENT_FIELDS);

      if (attachmentsError) {
        throw supabaseError(
          this.logger,
          "tasks.addMessage.attachments",
          attachmentsError,
          "No se pudieron guardar los adjuntos."
        );
      }

      const rows = (attachments ?? []) as unknown as AttachmentRow[];
      const urlByPath = await this.signPathMap(rows.map((row) => row.storage_path));
      return {
        ...created,
        attachments: rows.map((row) => ({ ...row, url: urlByPath.get(row.storage_path) ?? null }))
      };
    } catch (rollbackCause) {
      await this.removeStoredFiles("tasks.addMessage.rollback", uploaded);
      await this.supabase.admin
        .from("task_messages")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", created.id);
      throw rollbackCause;
    }
  }

  async deleteMessage(
    organization: OrganizationContext,
    taskId: string,
    messageId: string,
    userId: string
  ) {
    await this.ensureTaskInOrganization(organization.id, taskId);

    const { data: existing, error: findError } = await this.supabase.admin
      .from("task_messages")
      .select("id,user_id,attachments:task_attachments(storage_path)")
      .eq("organization_id", organization.id)
      .eq("task_id", taskId)
      .eq("id", messageId)
      .maybeSingle();

    if (findError) {
      throw supabaseError(this.logger, "tasks.deleteMessage", findError, "No se pudo borrar la actividad.");
    }
    if (!existing) {
      throw new NotFoundException("Message not found");
    }

    // Cada uno borra sus mensajes; el productor puede moderar cualquiera.
    if (existing.user_id !== userId && !this.canModerate(organization)) {
      throw new ForbiddenException("Solo quien escribió la actividad o un productor pueden borrarla.");
    }

    // Las filas de task_attachments las limpia el cascade de la FK; los objetos
    // del bucket hay que borrarlos a mano.
    await this.removeStoredFiles(
      "tasks.deleteMessage",
      (existing.attachments ?? []).map((attachment) => attachment.storage_path)
    );

    const { error } = await this.supabase.admin
      .from("task_messages")
      .delete()
      .eq("organization_id", organization.id)
      .eq("task_id", taskId)
      .eq("id", messageId);

    if (error) {
      throw supabaseError(this.logger, "tasks.deleteMessage", error, "No se pudo borrar la actividad.");
    }

    return { ok: true };
  }

  async deleteAttachment(
    organization: OrganizationContext,
    taskId: string,
    attachmentId: string,
    userId: string
  ) {
    await this.ensureTaskInOrganization(organization.id, taskId);

    const { data, error } = await this.supabase.admin
      .from("task_attachments")
      .select("id,uploaded_by_user_id,storage_path")
      .eq("organization_id", organization.id)
      .eq("task_id", taskId)
      .eq("id", attachmentId)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "tasks.deleteAttachment", error, "No se pudo borrar el adjunto.");
    }
    if (!data) {
      throw new NotFoundException("Attachment not found");
    }

    if (data.uploaded_by_user_id !== userId && !this.canModerate(organization)) {
      throw new ForbiddenException("Solo quien subió el archivo o un productor pueden eliminarlo.");
    }

    await this.removeStoredFiles("tasks.deleteAttachment", [data.storage_path]);

    const { error: deleteError } = await this.supabase.admin
      .from("task_attachments")
      .delete()
      .eq("organization_id", organization.id)
      .eq("id", attachmentId);

    if (deleteError) {
      throw supabaseError(this.logger, "tasks.deleteAttachment", deleteError, "No se pudo borrar el adjunto.");
    }

    return { ok: true };
  }

  private canModerate(organization: OrganizationContext) {
    return organization.role === "productor" || organization.role === "platform_admin";
  }

  // Valida tipo y tamaño, y arma nombre + path. No toca storage: se corre sobre
  // todos los archivos antes de subir el primero.
  private prepareAttachment(organizationId: string, taskId: string, file: UploadedAttachmentFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("El archivo está vacío.");
    }

    const mimeType = this.normalizeMimeType(file);
    const extension = ATTACHMENT_MIME_TYPES.get(mimeType)!;

    if (file.size > ATTACHMENT_MAX_SIZE_BYTES) {
      const megabytes = (file.size / 1_048_576).toFixed(1).replace(".", ",");
      throw new BadRequestException(
        `«${file.originalname}» pesa ${megabytes} MB. El límite es 5 MB por archivo.`
      );
    }

    const safeBaseName =
      file.originalname
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "archivo";

    return {
      file,
      mimeType,
      // Nombre saneado: sin saltos de línea y acotado (viene del cliente, no es confiable).
      displayName: file.originalname.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) || "archivo",
      path: `${organizationId}/${taskId}/${Date.now()}-${safeBaseName}.${extension}`
    };
  }

  // El navegador miente: Windows y Safari mandan application/octet-stream o
  // text/plain para varios .csv/.docx. Si el MIME declarado no está en el
  // allowlist, se resuelve por extensión. El MIME que devuelve esta función es el
  // que se guarda y el que se manda al bucket, así que siempre pertenece al
  // allowlist del bucket.
  private normalizeMimeType(file: UploadedAttachmentFile): string {
    if (ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      return file.mimetype;
    }

    const extension = file.originalname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const byExtension = extension ? MIME_BY_EXTENSION.get(extension) : undefined;
    if (byExtension) {
      return byExtension;
    }

    throw new BadRequestException(`«${file.originalname}» no es un formato permitido. ${ATTACHMENT_TYPES_MESSAGE}`);
  }

  private async ensureTaskInOrganization(organizationId: string, taskId: string) {
    const { data, error } = await this.supabase.admin
      .from("tasks")
      .select("id,status")
      .eq("organization_id", organizationId)
      .eq("id", taskId)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "tasks.ensureTaskInOrganization", error);
    }
    if (!data) {
      throw new NotFoundException("Task not found");
    }

    return data as { id: string; status: TaskStatus };
  }

  private async ensureMemberInOrganization(organizationId: string, userId: string) {
    const { data, error } = await this.supabase.admin
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw supabaseError(this.logger, "tasks.ensureMemberInOrganization", error);
    }
    if (!data) {
      throw new BadRequestException("El usuario asignado no pertenece a la organización.");
    }
  }

  private flattenCounts(task: TaskListRow) {
    const { messages, attachments, ...rest } = task;
    return {
      ...rest,
      messages_count: messages?.[0]?.count ?? 0,
      attachments_count: attachments?.[0]?.count ?? 0
    };
  }

  // Bucket privado: el frontend recibe URLs firmadas con vencimiento de 1 hora;
  // cada refetch del detalle las renueva. Un solo batch por tarea.
  //
  // Los adjuntos llegan en un embed plano y se reparten acá: los que tienen
  // message_id van dentro de su actividad, los que no (subidos antes de que los
  // adjuntos colgaran del mensaje) quedan como "Archivos de la tarea".
  private async withTaskAttachmentUrls(task: TaskDetailRow) {
    const all = task.attachments ?? [];
    const urlByPath = await this.signPathMap(all.map((item) => item.storage_path));
    const withUrl = all.map((attachment) => ({
      ...attachment,
      url: urlByPath.get(attachment.storage_path) ?? null
    }));

    const byMessage = new Map<string, typeof withUrl>();
    const loose: typeof withUrl = [];
    for (const attachment of withUrl) {
      if (!attachment.message_id) {
        loose.push(attachment);
        continue;
      }
      const bucket = byMessage.get(attachment.message_id);
      if (bucket) bucket.push(attachment);
      else byMessage.set(attachment.message_id, [attachment]);
    }

    return {
      ...task,
      messages: (task.messages ?? []).map((message) => ({
        ...message,
        attachments: byMessage.get(message.id) ?? []
      })),
      attachments: loose
    };
  }

  private async signPathMap(paths: string[]) {
    const urlByPath = new Map<string, string>();
    if (paths.length === 0) {
      return urlByPath;
    }

    const { data, error } = await this.supabase.admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

    if (error) {
      // Sin URLs firmadas la vista sigue siendo útil; se registra y se devuelve null.
      this.logger.warn(`tasks.signPathMap: no se pudieron firmar URLs (${error.message})`);
      return urlByPath;
    }

    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        urlByPath.set(item.path, item.signedUrl);
      }
    }
    return urlByPath;
  }

  // Best effort: si falla la limpieza del storage la operación igual sigue; los
  // objetos huérfanos no son accesibles (bucket privado).
  private async removeStoredFiles(scope: string, paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.supabase.admin.storage.from(ATTACHMENT_BUCKET).remove(paths);
    if (error) {
      this.logger.warn(`${scope}: no se pudieron borrar archivos del storage (${error.message})`);
    }
  }
}
