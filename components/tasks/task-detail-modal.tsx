"use client";

import type { JSONContent } from "@tiptap/react";
import {
  CalendarDays,
  Check,
  FileText,
  Film,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
  User,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Client, OrganizationMember, Policy, Task, TaskPriority, TaskStatus } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { canDeleteTask, TASK_COLUMNS, TASK_PRIORITIES } from "@/lib/tasks";
import { FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, formatFileSize, type TaskApi } from "@/components/tasks/shared";
import { SearchSelect } from "@/components/tasks/search-select";
import { TaskEditor } from "@/components/tasks/task-editor";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/modal";

const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

export function TaskDetailModal({
  task,
  members,
  clients,
  policies,
  api,
  onClose
}: {
  task: Task | null;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  api: TaskApi;
  onClose: () => void;
}) {
  if (!task) return null;
  // Keyed por id: cambiar de tarea resetea el estado local (título, borradores).
  return (
    <TaskDetailContent
      key={task.id}
      task={task}
      members={members}
      clients={clients}
      policies={policies}
      api={api}
      onClose={onClose}
    />
  );
}

function TaskDetailContent({
  task,
  members,
  clients,
  policies,
  api,
  onClose
}: {
  task: Task;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  api: TaskApi;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const memberOptions = useMemo(
    () => members.map((member) => ({ id: member.id, label: member.full_name })),
    [members]
  );
  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        id: client.id,
        label: client.full_name,
        hint: client.phone ?? client.locality ?? undefined
      })),
    [clients]
  );
  const policyOptions = useMemo(
    () =>
      policies.map((policy) => ({
        id: policy.id,
        label: `#${policy.policy_number} · ${policy.clients?.full_name ?? "Sin cliente"}`,
        hint: `${policy.branch}${policy.vehicle_plate ? ` · ${policy.vehicle_plate}` : ""}`
      })),
    [policies]
  );

  // El toast de error ya lo muestra la mutación; acá solo evitamos rechazos sin capturar.
  const update = (patch: Parameters<TaskApi["onUpdate"]>[1]) => {
    void api.onUpdate(task.id, patch).catch(() => undefined);
  };

  const saveTitle = () => {
    const value = title.trim();
    if (!value) {
      setTitle(task.title);
      return;
    }
    if (value !== task.title) {
      update({ title: value });
    }
  };

  const allowDelete = canDeleteTask(task, api.currentUserId, api.canModerate);

  return (
    <div
      className="fixed inset-0 z-50 grid min-h-dvh place-items-center overflow-hidden bg-slate-950/45 p-4 max-[520px]:p-2"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="flex h-[min(900px,calc(100dvh-24px))] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-6 py-4 max-[640px]:px-4">
          <input
            value={title}
            maxLength={200}
            aria-label="Título de la tarea"
            className="h-10 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-xl font-bold text-slate-900 outline-none transition-colors focus:bg-slate-50 max-[640px]:text-lg"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          {allowDelete ? (
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              aria-label="Eliminar tarea"
              title="Eliminar tarea"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={17} />
            </button>
          ) : null}
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] max-[1100px]:grid-cols-[minmax(0,1fr)_340px] max-[900px]:grid-cols-1">
          <div className="min-h-0 overflow-y-auto px-7 py-6 max-[900px]:max-h-[55%] max-[640px]:px-4 max-[640px]:py-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 max-[640px]:grid-cols-1">
              <label className="flex min-w-0 flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Etapa</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  value={task.status}
                  onChange={(event) => update({ status: event.target.value as TaskStatus })}
                >
                  {TASK_COLUMNS.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Prioridad</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  value={task.priority}
                  onChange={(event) => update({ priority: event.target.value as TaskPriority })}
                >
                  {TASK_PRIORITIES.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Asignado a</span>
                <SearchSelect
                  value={task.assigned_to_user_id}
                  options={memberOptions}
                  placeholder="Sin asignar"
                  onChange={(id) => update({ assignedToUserId: id })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Vencimiento</span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <DatePicker
                      value={task.due_date ?? ""}
                      onChange={(value) => update({ dueDate: value || null })}
                      placeholder="Sin fecha"
                      ariaLabel="Vencimiento"
                    />
                  </div>
                  {task.due_date ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:text-red-500"
                      aria-label="Quitar fecha"
                      onClick={() => update({ dueDate: null })}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Asegurado</span>
                <SearchSelect
                  value={task.clients?.id ?? null}
                  options={clientOptions}
                  placeholder="Vincular asegurado"
                  onChange={(id) => update({ clientId: id })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Póliza</span>
                <SearchSelect
                  value={task.policies?.id ?? null}
                  options={policyOptions}
                  placeholder="Vincular póliza"
                  onChange={(id) => update({ policyId: id })}
                />
              </div>
            </div>

            <TaskDescription task={task} api={api} />

            <TaskAttachments task={task} api={api} />

            <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
              Creada por <strong className="font-semibold text-slate-500">{task.created_by?.full_name ?? "Usuario"}</strong>
              {" · "}
              {formatDateTime(task.created_at)}
            </p>
          </div>

          <TaskChat task={task} api={api} />
        </div>
      </section>

      <ConfirmDialog
        isOpen={confirmingDelete}
        title="Eliminar tarea"
        message={`¿Eliminar la tarea "${task.title}"? Se borran también el chat y los adjuntos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar tarea"
        isBusy={api.isDeleting}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          void api
            .onDelete(task.id)
            .then(() => {
              setConfirmingDelete(false);
              onClose();
            })
            .catch(() => undefined);
        }}
      />
    </div>
  );
}

function TaskDescription({ task, api }: { task: Task; api: TaskApi }) {
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const draftRef = useRef<JSONContent | null>(null);
  const timerRef = useRef<number | null>(null);
  const taskIdRef = useRef(task.id);
  const onUpdateRef = useRef(api.onUpdate);

  // Mantiene las referencias frescas para el flush diferido sin re-crear el timer.
  useEffect(() => {
    taskIdRef.current = task.id;
    onUpdateRef.current = api.onUpdate;
  });

  const flush = async () => {
    const draft = draftRef.current;
    if (!draft) return;
    draftRef.current = null;
    setSaveState("saving");
    try {
      await onUpdateRef.current(taskIdRef.current, { description: draft });
      setSaveState(draftRef.current ? "pending" : "saved");
    } catch {
      // Reintenta en el próximo cambio: se conserva el borrador.
      draftRef.current = draftRef.current ?? draft;
      setSaveState("pending");
    }
  };

  const schedule = (json: JSONContent) => {
    draftRef.current = json;
    setSaveState("pending");
    window.clearTimeout(timerRef.current ?? undefined);
    timerRef.current = window.setTimeout(() => void flush(), 1200);
  };

  // Al desmontar (cerrar el modal) se guarda lo pendiente sin esperar.
  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current ?? undefined);
      const draft = draftRef.current;
      if (draft) {
        void onUpdateRef.current(taskIdRef.current, { description: draft }).catch(() => undefined);
      }
    };
  }, []);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <span className={FIELD_LABEL_CLASS}>Descripción</span>
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          {saveState === "saving" ? <Loader2 size={11} className="animate-spin" /> : null}
          {saveState === "saved" ? <Check size={11} className="text-emerald-500" /> : null}
          {saveState === "pending" ? "Sin guardar..." : saveState === "saving" ? "Guardando..." : saveState === "saved" ? "Guardado" : ""}
        </span>
      </div>
      <TaskEditor
        value={task.description}
        minHeightClass="min-h-[260px]"
        placeholder="Detallá la tarea: objetivos, checklist, tablas..."
        onChange={schedule}
      />
    </div>
  );
}

function TaskAttachments({ task, api }: { task: Task; api: TaskApi }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const attachments = task.attachments ?? [];
  const confirming = attachments.find((attachment) => attachment.id === confirmingId);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <span className={FIELD_LABEL_CLASS}>
          Adjuntos{attachments.length > 0 ? ` (${attachments.length})` : ""}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60"
          onClick={() => inputRef.current?.click()}
          disabled={api.isUploading}
        >
          {api.isUploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
          {api.isUploading ? "Subiendo..." : "Adjuntar"}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={ATTACHMENT_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void api.onUploadAttachment(task.id, file).catch(() => undefined);
            event.target.value = "";
          }}
        />
      </div>
      {attachments.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[12px] text-slate-400">
          Imágenes y videos de hasta 50 MB
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 max-[1100px]:grid-cols-2">
          {attachments.map((attachment) => {
            const isImage = attachment.mime_type.startsWith("image/");
            const isVideo = attachment.mime_type.startsWith("video/");
            const canRemove = api.canModerate || attachment.uploaded_by_user_id === api.currentUserId;
            return (
              <div key={attachment.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {attachment.url && isImage ? (
                  <a href={attachment.url} target="_blank" rel="noreferrer">
                    {/* Signed URL temporal: <img> nativo, next/image no aplica acá */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.url} alt={attachment.file_name} className="h-32 w-full object-cover" />
                  </a>
                ) : attachment.url && isVideo ? (
                  <video src={attachment.url} controls preload="metadata" className="h-32 w-full bg-slate-900 object-contain" />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center text-slate-300">
                    {isVideo ? <Film size={26} /> : <FileText size={26} />}
                  </div>
                )}
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-slate-600">{attachment.file_name}</span>
                    <span className="block truncate text-[10px] text-slate-400">
                      {formatFileSize(attachment.file_size_bytes)} · {attachment.uploaded_by?.full_name ?? "Usuario"}
                    </span>
                  </span>
                  {canRemove ? (
                    <button
                      type="button"
                      aria-label="Eliminar adjunto"
                      className="shrink-0 text-slate-400 transition-colors hover:text-red-600 disabled:opacity-50"
                      disabled={api.deletingAttachmentId === attachment.id}
                      onClick={() => setConfirmingId(attachment.id)}
                    >
                      {api.deletingAttachmentId === attachment.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(confirming)}
        title="Eliminar adjunto"
        message={`¿Eliminar el archivo "${confirming?.file_name ?? ""}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar adjunto"
        isBusy={Boolean(confirmingId && api.deletingAttachmentId === confirmingId)}
        onClose={() => setConfirmingId(null)}
        onConfirm={() => {
          if (!confirmingId) return;
          void api
            .onDeleteAttachment(task.id, confirmingId)
            .catch(() => undefined)
            .finally(() => setConfirmingId(null));
        }}
      />
    </div>
  );
}

function TaskChat({ task, api }: { task: Task; api: TaskApi }) {
  const [draft, setDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const messages = task.messages ?? [];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = async () => {
    const value = draft.trim();
    if (!value || api.isSendingMessage) return;
    try {
      await api.onSendMessage(task.id, value);
      setDraft("");
    } catch {
      // El toast de error ya se mostró; se conserva el borrador para reintentar.
    }
  };

  return (
    <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-slate-50/60 max-[900px]:border-l-0 max-[900px]:border-t">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
        <MessageSquare size={15} className="text-slate-400" />
        <h3 className="m-0 text-[13px] font-semibold text-slate-700">Actividad</h3>
        {messages.length > 0 ? (
          <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-bold text-slate-500">{messages.length}</span>
        ) : null}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="m-0 mt-4 text-center text-[12px] text-slate-400">
            Documentá acá lo que va pasando con esta tarea.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {messages.map((message) => {
              const own = message.user_id === api.currentUserId;
              const canRemove = own || api.canModerate;
              return (
                <div key={message.id} className={`group flex max-w-[92%] flex-col gap-0.5 ${own ? "self-end" : "self-start"}`}>
                  <span className={`flex items-center gap-1 text-[10px] text-slate-400 ${own ? "justify-end" : ""}`}>
                    <strong className="font-semibold text-slate-500">{own ? "Vos" : message.user?.full_name ?? "Usuario"}</strong>
                    {formatDateTime(message.created_at)}
                  </span>
                  <div
                    className={`relative whitespace-pre-line rounded-xl px-3 py-2 text-[13px] leading-snug ${
                      own
                        ? "rounded-br-sm bg-[color:var(--org-primary)] text-white"
                        : "rounded-bl-sm border border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {message.message}
                    {canRemove ? (
                      <button
                        type="button"
                        aria-label="Eliminar mensaje"
                        className={`absolute -top-1.5 ${own ? "-left-1.5" : "-right-1.5"} hidden h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition-colors hover:text-red-600 group-hover:flex`}
                        disabled={api.deletingMessageId === message.id}
                        onClick={() => setConfirmingId(message.id)}
                      >
                        {api.deletingMessageId === message.id ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Trash2 size={10} />
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            rows={2}
            placeholder="Escribí una actualización..."
            className="min-h-9 min-w-0 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 outline-none transition-colors focus:border-[color:var(--org-primary)]"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={api.isSendingMessage}
          />
          <button
            type="button"
            aria-label="Enviar mensaje"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--org-primary)] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            onClick={() => void send()}
            disabled={api.isSendingMessage || !draft.trim()}
          >
            {api.isSendingMessage ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <p className="m-0 mt-1 flex items-center gap-1 text-[10px] text-slate-400">
          <User size={10} /> Enter envía · Shift+Enter salto de línea
          {task.due_date ? (
            <span className="ml-auto flex items-center gap-1">
              <CalendarDays size={10} /> Vence el {formatDate(task.due_date)}
            </span>
          ) : null}
        </p>
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirmingId)}
        title="Eliminar mensaje"
        message="¿Eliminar este mensaje del chat? Esta acción no se puede deshacer."
        confirmLabel="Eliminar mensaje"
        isBusy={Boolean(confirmingId && api.deletingMessageId === confirmingId)}
        onClose={() => setConfirmingId(null)}
        onConfirm={() => {
          if (!confirmingId) return;
          void api
            .onDeleteMessage(task.id, confirmingId)
            .catch(() => undefined)
            .finally(() => setConfirmingId(null));
        }}
      />
    </aside>
  );
}
