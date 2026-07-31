"use client";

import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TaskAttachment, TaskMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AttachmentGrid } from "@/components/tasks/attachment-tile";
import { ConfirmDialog } from "@/components/ui/modal";

// Conversación de la tarea: quién hizo qué, cuándo, y con qué archivos.
export function TaskActivity({
  messages,
  currentUserId,
  canModerate,
  deletingMessageId,
  deletingAttachmentId,
  onOpenImage,
  onDeleteMessage,
  onDeleteAttachment
}: {
  messages: TaskMessage[];
  currentUserId: string;
  canModerate: boolean;
  deletingMessageId: string | null;
  deletingAttachmentId: string | null;
  onOpenImage: (attachmentId: string) => void;
  onDeleteMessage: (messageId: string) => Promise<unknown>;
  onDeleteAttachment: (attachmentId: string) => Promise<unknown>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [confirmingMessageId, setConfirmingMessageId] = useState<string | null>(null);
  const [confirmingAttachment, setConfirmingAttachment] = useState<TaskAttachment | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  return (
    <>
      <div ref={listRef} className="sp-activity-list">
        {messages.length === 0 ? (
          <div className="sp-activity-empty">
            <MessageSquare size={20} />
            <strong>Todavía no hay actividad</strong>
            <span>Contá acá lo que va pasando y adjuntá lo que haga falta: fotos, PDF, planillas.</span>
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.user_id === currentUserId;
            const canDelete = isOwn || canModerate;

            return (
              <article key={message.id} className="sp-activity-item" data-own={isOwn ? "true" : undefined}>
                <header>
                  <strong>{isOwn ? "Vos" : message.user?.full_name ?? "Usuario"}</strong>
                  <time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time>
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="Eliminar actividad"
                      disabled={deletingMessageId === message.id}
                      onClick={() => setConfirmingMessageId(message.id)}
                    >
                      {deletingMessageId === message.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  ) : null}
                </header>

                <div className="sp-activity-bubble">
                  {message.message ? <p>{message.message}</p> : null}
                  <AttachmentGrid
                    attachments={message.attachments}
                    variant={isOwn ? "own" : "surface"}
                    deletingId={deletingAttachmentId}
                    canRemove={(attachment) =>
                      canModerate || attachment.uploaded_by_user_id === currentUserId
                    }
                    onOpenImage={onOpenImage}
                    onRemove={setConfirmingAttachment}
                  />
                </div>
              </article>
            );
          })
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirmingMessageId)}
        title="Eliminar actividad"
        message="¿Eliminar esta actividad? Se borran también los archivos que tenga adjuntos. Esta acción no se puede deshacer."
        confirmLabel="Eliminar actividad"
        isBusy={Boolean(confirmingMessageId && deletingMessageId === confirmingMessageId)}
        onClose={() => setConfirmingMessageId(null)}
        onConfirm={() => {
          if (!confirmingMessageId) return;
          void onDeleteMessage(confirmingMessageId)
            .catch(() => undefined)
            .finally(() => setConfirmingMessageId(null));
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmingAttachment)}
        title="Eliminar archivo"
        message={`¿Eliminar «${confirmingAttachment?.file_name ?? ""}»? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar archivo"
        isBusy={Boolean(confirmingAttachment && deletingAttachmentId === confirmingAttachment.id)}
        onClose={() => setConfirmingAttachment(null)}
        onConfirm={() => {
          if (!confirmingAttachment) return;
          void onDeleteAttachment(confirmingAttachment.id)
            .catch(() => undefined)
            .finally(() => setConfirmingAttachment(null));
        }}
      />
    </>
  );
}
