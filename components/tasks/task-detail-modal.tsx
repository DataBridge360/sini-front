"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/react";
import { Check, Info, Loader2, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  type ApiCommonOptions,
  type Client,
  type OrganizationMember,
  type Policy,
  type TaskDetail,
  type TaskListItem
} from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useDeferRealtime, useRealtimeStatus } from "@/lib/realtime";
import { collectImages } from "@/lib/task-attachments";
import { canDeleteTask } from "@/lib/tasks";
import { AttachmentGrid } from "@/components/tasks/attachment-tile";
import { AttachmentLightbox } from "@/components/tasks/attachment-lightbox";
import { FIELD_LABEL_CLASS, StatusChip, type TaskApi } from "@/components/tasks/shared";
import { TaskActivity } from "@/components/tasks/task-activity";
import { TaskActivityComposer } from "@/components/tasks/task-activity-composer";
import { TaskDetailFields } from "@/components/tasks/task-detail-fields";
import { TaskDetailMenu } from "@/components/tasks/task-detail-menu";
import { TaskActivitySkeleton, TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { TaskDetailSummary } from "@/components/tasks/task-detail-summary";
import { TaskEditor } from "@/components/tasks/task-editor";
import { TaskStatusControl } from "@/components/tasks/task-status-control";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";

export function TaskDetailModal({
  taskId,
  fallback,
  common,
  members,
  clients,
  policies,
  api,
  onClose
}: {
  taskId: string | null;
  // Fila del listado que ya está en caché: permite pintar el encabezado real
  // mientras llega el detalle, en vez de un spinner en blanco.
  fallback: TaskListItem | null;
  common: ApiCommonOptions;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  api: TaskApi;
  onClose: () => void;
}) {
  if (!taskId) return null;
  // Keyed por id: cambiar de tarea resetea el estado local (título, borradores).
  return (
    <TaskDetailContent
      key={taskId}
      taskId={taskId}
      fallback={fallback}
      common={common}
      members={members}
      clients={clients}
      policies={policies}
      api={api}
      onClose={onClose}
    />
  );
}

function TaskDetailContent({
  taskId,
  fallback,
  common,
  members,
  clients,
  policies,
  api,
  onClose
}: {
  taskId: string;
  fallback: TaskListItem | null;
  common: ApiCommonOptions;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  api: TaskApi;
  onClose: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  // Los datos se leen; editarlos es un modo aparte que se pide desde el menú.
  const [isEditing, setIsEditing] = useState(false);
  // En mobile el detalle se parte en dos: los datos y la conversación.
  const [paneOverride, setPaneOverride] = useState<"detail" | "activity" | null>(null);

  // Con el canal de tiempo real conectado la actividad llega sola y no hace falta
  // preguntar cada 15 segundos. El refresco periódico queda como respaldo para
  // cuando no hay canal (sin configurar, red caída, suscripción rechazada): así
  // el detalle nunca funciona peor que antes.
  const isLive = useRealtimeStatus() === "connected";

  const detailQuery = useQuery({
    queryKey: ["task", common.organizationSlug ?? "", taskId],
    queryFn: () => apiRequest<TaskDetail>(`/tasks/${taskId}`, common),
    refetchInterval: isLive ? false : 15_000
  });

  const task = detailQuery.data;

  // El título es el del servidor salvo que el usuario esté editándolo: así no
  // hay que sincronizar estado con un efecto cuando llega el detalle.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const title = titleDraft ?? task?.title ?? fallback?.title ?? "";

  // Por defecto abre en la conversación si ya hay algo escrito: es lo que la
  // gente viene a mirar cuando vuelve a una tarea en curso.
  const pane = paneOverride ?? (task && task.messages.length > 0 ? "activity" : "detail");

  const images = useMemo(() => {
    if (!task) return [];
    return collectImages([...task.messages.flatMap((message) => message.attachments), ...task.attachments]);
  }, [task]);

  const status = task?.status ?? fallback?.status ?? "pendiente";
  const allowDelete = task ? canDeleteTask(task, api.currentUserId, api.canModerate) : false;
  const isAwaitingApproval = status === "revision" && !api.canModerate;

  const update = (patch: Parameters<TaskApi["onUpdate"]>[1]) => {
    void api.onUpdate(taskId, patch).catch(() => undefined);
  };

  const saveTitle = () => {
    const value = title.trim();
    // Un título vacío no es un título: se descarta el borrador y vuelve el real.
    if (!value || !task) {
      setTitleDraft(null);
      return;
    }
    if (value !== task.title) update({ title: value });
    setTitleDraft(null);
  };

  const header = (
    <div className="sp-task-detail-head">
      <input
        value={title}
        maxLength={200}
        aria-label="Título de la tarea"
        className="sp-task-title-input"
        readOnly={!isEditing}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <StatusChip status={status} />
      <TaskDetailMenu
        isEditing={isEditing}
        canDelete={allowDelete}
        onToggleEdit={() => setIsEditing((editing) => !editing)}
        onDelete={() => setConfirmingDelete(true)}
      />
    </div>
  );

  return (
    <>
      <Modal
        isOpen
        size="lg"
        title={task?.title ?? fallback?.title ?? "Tarea"}
        headerSlot={header}
        bodyClassName="sp-task-detail-body"
        onClose={onClose}
      >
        {/* Los datos, arriba de todo: es lo primero que se mira al abrir. En
            lectura por defecto; los controles aparecen con "Editar datos". */}
        {task ? (
          isEditing ? (
            <div className="sp-task-detail-edit">
              <TaskDetailFields
                task={task}
                members={members}
                clients={clients}
                policies={policies}
                onUpdate={update}
              />
              <button type="button" className="sp-task-edit-done" onClick={() => setIsEditing(false)}>
                <Check size={14} />
                Listo
              </button>
            </div>
          ) : (
            <TaskDetailSummary task={task} />
          )
        ) : null}

        <div className="sp-task-detail-actions">
          <nav className="sp-task-panes" role="tablist" aria-label="Secciones de la tarea">
            <button
              type="button"
              role="tab"
              aria-selected={pane === "detail"}
              onClick={() => setPaneOverride("detail")}
            >
              Detalle
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === "activity"}
              onClick={() => setPaneOverride("activity")}
            >
              <MessageSquare size={13} />
              Actividad
              {task && task.messages.length > 0 ? <b>{task.messages.length}</b> : null}
            </button>
          </nav>
        </div>

        {isAwaitingApproval ? (
          <p className="sp-task-notice">
            <Info size={15} className="shrink-0" />
            Esta tarea está esperando la aprobación de un productor. Podés seguir comentando en la
            actividad.
          </p>
        ) : null}

        {detailQuery.error ? <ErrorState text={detailQuery.error.message} /> : null}

        <div className="sp-task-detail-grid" data-pane={pane ?? "detail"}>
          <div className="sp-task-detail-main">
            {!task ? (
              <TaskDetailSkeleton />
            ) : (
              <>
                <TaskDescription task={task} onUpdate={api.onUpdate} />

                {task.attachments.length > 0 ? (
                  <details className="sp-task-legacy-files">
                    <summary>Archivos de la tarea ({task.attachments.length})</summary>
                    <p>Se adjuntaron antes de que los archivos formaran parte de una actividad.</p>
                    <AttachmentGrid
                      attachments={task.attachments}
                      deletingId={api.deletingAttachmentId}
                      canRemove={(attachment) =>
                        api.canModerate || attachment.uploaded_by_user_id === api.currentUserId
                      }
                      onOpenImage={setLightboxId}
                      onRemove={(attachment) =>
                        void api.onDeleteAttachment(taskId, attachment.id).catch(() => undefined)
                      }
                    />
                  </details>
                ) : null}

                <p className="sp-task-detail-meta">
                  Creada por{" "}
                  <strong>{task.created_by?.full_name ?? "Usuario"}</strong>
                  {" · "}
                  {formatDateTime(task.created_at)}
                  {task.status === "finalizado" && task.archived_at ? (
                    <>
                      {" · Aprobada"}
                      {task.approved_by ? ` por ${task.approved_by.full_name}` : ""} el{" "}
                      {formatDate(task.archived_at)}
                    </>
                  ) : null}
                  {task.due_date ? ` · Vence el ${formatDate(task.due_date)}` : ""}
                </p>
              </>
            )}
          </div>

          <aside className="sp-task-detail-side">
            <header className="sp-task-detail-side-head">
              <MessageSquare size={14} />
              <h3>Actividad</h3>
              {task && task.messages.length > 0 ? <span>{task.messages.length}</span> : null}
            </header>

            {task ? (
              <TaskActivity
                messages={task.messages}
                currentUserId={api.currentUserId}
                canModerate={api.canModerate}
                deletingMessageId={api.deletingMessageId}
                deletingAttachmentId={api.deletingAttachmentId}
                onOpenImage={setLightboxId}
                onDeleteMessage={(messageId) => api.onDeleteMessage(taskId, messageId)}
                onDeleteAttachment={(attachmentId) => api.onDeleteAttachment(taskId, attachmentId)}
              />
            ) : (
              <TaskActivitySkeleton />
            )}

            <TaskActivityComposer
              isSending={api.isSendingMessage}
              progress={api.uploadProgress}
              onSend={(message, files) => api.onSendMessage(taskId, message, files)}
            />
          </aside>
        </div>

        {/* La acción de avance al pie: en el celular queda donde llega el pulgar,
            y deja de competir con los datos por el borde superior. */}
        <footer className="sp-task-detail-footer">
          <TaskStatusControl
            status={status}
            canModerate={api.canModerate}
            isBusy={api.movingTaskId === taskId}
            size="md"
            fullWidth
            onMove={(next) => void api.onMove(taskId, next).catch(() => undefined)}
          />
        </footer>
      </Modal>

      <AttachmentLightbox images={images} startId={lightboxId} onClose={() => setLightboxId(null)} />

      <ConfirmDialog
        isOpen={confirmingDelete}
        title="Eliminar tarea"
        message={`¿Eliminar la tarea "${task?.title ?? ""}"? Se borran también la actividad y los archivos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar tarea"
        isBusy={api.isDeleting}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          void api
            .onDelete(taskId)
            .then(() => {
              setConfirmingDelete(false);
              onClose();
            })
            .catch(() => undefined);
        }}
      />
    </>
  );
}

function TaskDescription({
  task,
  onUpdate
}: {
  task: TaskDetail;
  onUpdate: TaskApi["onUpdate"];
}) {
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved">("idle");

  // Mientras hay texto sin guardar los refrescos esperan, para no meter ruido
  // encima de alguien que está escribiendo. El freno se suelta solo, poco después
  // de que deja de tipear y el autoguardado termina.
  useDeferRealtime(saveState === "pending" || saveState === "saving");

  const draftRef = useRef<JSONContent | null>(null);
  const timerRef = useRef<number | null>(null);
  const taskIdRef = useRef(task.id);
  const onUpdateRef = useRef(onUpdate);

  // Mantiene las referencias frescas para el flush diferido sin re-crear el timer.
  useEffect(() => {
    taskIdRef.current = task.id;
    onUpdateRef.current = onUpdate;
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
    <div className="sp-task-description">
      <div className="mb-2 flex items-center justify-between">
        <span className={FIELD_LABEL_CLASS}>Descripción</span>
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          {saveState === "saving" ? <Loader2 size={11} className="animate-spin" /> : null}
          {saveState === "saved" ? <Check size={11} className="text-emerald-500" /> : null}
          {saveState === "pending"
            ? "Sin guardar..."
            : saveState === "saving"
              ? "Guardando..."
              : saveState === "saved"
                ? "Guardado"
                : ""}
        </span>
      </div>
      <TaskEditor
        value={task.description}
        minHeightClass="min-h-[220px]"
        placeholder="Detallá la tarea: objetivos, checklist, tablas..."
        onChange={schedule}
      />
    </div>
  );
}
