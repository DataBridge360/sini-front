"use client";

import { FileSpreadsheet, FileText, FileType2, Film, Paperclip, type LucideIcon } from "lucide-react";
import type { TaskFormPayload, TaskPriority, TaskStatus } from "@/lib/api";
import type { AttachmentKind } from "@/lib/task-attachments";
import { TASK_STATUS_META, taskPriorityMeta } from "@/lib/tasks";

// API que el shell de la vista expone a las tarjetas y modales de tareas.
export type TaskApi = {
  currentUserId: string;
  canModerate: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isSendingMessage: boolean;
  // Progreso de la subida en curso (0..1), o null si no hay ninguna.
  uploadProgress: number | null;
  deletingMessageId: string | null;
  deletingAttachmentId: string | null;
  movingTaskId: string | null;
  onUpdate: (taskId: string, patch: Partial<TaskFormPayload>) => Promise<unknown>;
  onMove: (taskId: string, status: TaskStatus) => Promise<unknown>;
  onDelete: (taskId: string) => Promise<unknown>;
  // Una actividad = texto y/o archivos, en una sola request.
  onSendMessage: (taskId: string, message: string, files: File[]) => Promise<unknown>;
  onDeleteMessage: (taskId: string, messageId: string) => Promise<unknown>;
  onDeleteAttachment: (taskId: string, attachmentId: string) => Promise<unknown>;
};

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  const meta = taskPriorityMeta(priority);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
      {meta.label}
    </span>
  );
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
      {meta.label}
    </span>
  );
}

// El color acá identifica el tipo de archivo (es la convención universal de PDF
// rojo / Word azul / Excel verde), no un estado semántico. Es la única excepción
// deliberada a la Semantic-Color Rule de DESIGN.md.
export const ATTACHMENT_ICONS: Record<AttachmentKind, { icon: LucideIcon; className: string }> = {
  image: { icon: FileText, className: "bg-slate-100 text-slate-500" },
  pdf: { icon: FileText, className: "bg-red-50 text-red-600" },
  word: { icon: FileType2, className: "bg-blue-50 text-blue-600" },
  excel: { icon: FileSpreadsheet, className: "bg-emerald-50 text-emerald-600" },
  video: { icon: Film, className: "bg-slate-100 text-slate-500" },
  file: { icon: Paperclip, className: "bg-slate-100 text-slate-500" }
};

export const FIELD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";
export const FIELD_SELECT_CLASS =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none transition-colors hover:border-slate-300 focus:border-[color:var(--org-primary)]";
