import { z } from "zod";
import { pageField, pageSizeField } from "@/server/core/pagination";

// Flujo completo. 'finalizado' == archivada: sale del tablero y solo se ve en
// la vista Archivadas (ver tasks.rules.ts para quién puede llegar ahí).
export const taskStatusValues = ["pendiente", "en_proceso", "revision", "finalizado"] as const;
// Lo que muestra el tablero.
export const taskBoardStatusValues = ["pendiente", "en_proceso", "revision"] as const;
// Una tarea no nace en revisión ni archivada.
export const taskCreatableStatusValues = ["pendiente", "en_proceso"] as const;
export const taskPriorityValues = ["alta", "media", "baja"] as const;

export type TaskStatus = (typeof taskStatusValues)[number];

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

// Documento TipTap (JSON arbitrario). Se acota el tamaño serializado para que
// una descripción no infle la fila ni el payload. El tope debe dejar margen
// dentro del límite global de body (256kb en main.ts) incluso con texto
// multibyte (UTF-8 puede triplicar los bytes por carácter).
const descriptionSchema = z
  .unknown()
  .nullable()
  .optional()
  .refine(
    (value) => value == null || JSON.stringify(value).length <= 60_000,
    "La descripción es demasiado larga"
  );

const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullable().optional());
const optionalIsoDate = z.preprocess(emptyToNull, z.iso.date().nullable().optional());

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: descriptionSchema,
  status: z.enum(taskCreatableStatusValues).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  dueDate: optionalIsoDate,
  assignedToUserId: optionalUuid,
  clientId: optionalUuid,
  policyId: optionalUuid
});

// Sin `status` a propósito: todo cambio de etapa pasa por PATCH /:id/status, que
// es el único lugar donde se valida la transición contra el rol. Aceptarlo acá
// sería un bypass del gate de aprobación.
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: descriptionSchema,
  priority: z.enum(taskPriorityValues).optional(),
  dueDate: optionalIsoDate,
  assignedToUserId: optionalUuid,
  clientId: optionalUuid,
  policyId: optionalUuid
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(taskStatusValues)
});

// En multipart el texto es opcional: una actividad puede ser solo archivos. Que
// venga al menos una de las dos cosas lo valida el servicio, que es quien ve los
// files.
export const createTaskMessageSchema = z.object({
  message: z.preprocess(emptyToNull, z.string().trim().min(1).max(4000).nullable().optional())
});

// GET /tasks?archived=1&page=&pageSize=&search=&priority=&assignedTo=
// Sin `archived` devuelve el tablero (activas, sin paginar).
export const listTasksQuerySchema = z.object({
  archived: z.preprocess((value) => value === "1" || value === "true", z.boolean()).optional(),
  page: pageField,
  pageSize: pageSizeField,
  search: z.preprocess(emptyToNull, z.string().trim().max(200).nullable().optional()),
  priority: z.preprocess(emptyToNull, z.enum(taskPriorityValues).nullable().optional()),
  assignedTo: optionalUuid
});

// GET /tasks/stats?assignedTo=
// Recuento por etapa. Sin `assignedTo` cuenta toda la organización.
export const taskStatsQuerySchema = z.object({
  assignedTo: optionalUuid
});

export type CreateTaskDto = z.infer<typeof createTaskSchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusDto = z.infer<typeof updateTaskStatusSchema>;
export type CreateTaskMessageDto = z.infer<typeof createTaskMessageSchema>;
export type ListTasksQueryDto = z.infer<typeof listTasksQuerySchema>;
export type TaskStatsQueryDto = z.infer<typeof taskStatsQuerySchema>;
