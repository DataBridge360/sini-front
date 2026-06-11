"use client";

import type { TaskFormPayload, TaskPriority } from "@/lib/api";
import { taskPriorityMeta } from "@/lib/tasks";

// API que el shell de la vista expone a las tarjetas y modales de tareas.
export type TaskApi = {
  currentUserId: string;
  canModerate: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isSendingMessage: boolean;
  isUploading: boolean;
  deletingMessageId: string | null;
  deletingAttachmentId: string | null;
  onUpdate: (taskId: string, patch: Partial<TaskFormPayload>) => Promise<unknown>;
  onDelete: (taskId: string) => Promise<unknown>;
  onSendMessage: (taskId: string, message: string) => Promise<unknown>;
  onDeleteMessage: (taskId: string, messageId: string) => Promise<unknown>;
  onUploadAttachment: (taskId: string, file: File) => Promise<unknown>;
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

export function formatFileSize(bytes: number) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const FIELD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";
export const FIELD_SELECT_CLASS =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none transition-colors hover:border-slate-300 focus:border-[color:var(--org-primary)]";
