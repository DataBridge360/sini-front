"use client";

import { Download, Loader2, Trash2 } from "lucide-react";
import type { TaskAttachment } from "@/lib/api";
import { attachmentKind, attachmentKindLabel, formatFileSize } from "@/lib/task-attachments";
import { ATTACHMENT_ICONS } from "@/components/tasks/shared";

// Adjuntos ya subidos, dentro de una actividad.
//
// Las imágenes van en mosaico (lo que importa es la imagen) y los documentos en
// fila con nombre y peso (lo que importa es cuál es y cuánto ocupa). Meter un PDF
// en una tarjeta cuadrada con un ícono gigante desperdicia el espacio que
// necesita el nombre del archivo.
export function AttachmentGrid({
  attachments,
  variant = "surface",
  canRemove,
  deletingId,
  onOpenImage,
  onRemove
}: {
  attachments: TaskAttachment[];
  // "own" = dentro de una burbuja propia (fondo de acento): las superficies
  // internas se vuelven translúcidas para no romper el contraste.
  variant?: "surface" | "own";
  canRemove: (attachment: TaskAttachment) => boolean;
  deletingId: string | null;
  onOpenImage: (attachmentId: string) => void;
  onRemove: (attachment: TaskAttachment) => void;
}) {
  if (attachments.length === 0) return null;

  // Solo las imágenes con URL firmada válida van al mosaico; el resto cae a
  // fila de documento, que no depende de poder renderizar el contenido.
  const images = attachments.flatMap((item) =>
    attachmentKind(item.mime_type, item.file_name) === "image" && item.url
      ? [{ ...item, url: item.url }]
      : []
  );
  const imageIds = new Set(images.map((item) => item.id));
  const rest = attachments.filter((item) => !imageIds.has(item.id));

  return (
    <div className="sp-attachments" data-variant={variant}>
      {images.length > 0 ? (
        <div className="sp-attachment-grid" data-count={Math.min(images.length, 4)}>
          {images.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              className="sp-attachment-thumb"
              onClick={() => onOpenImage(attachment.id)}
              aria-label={`Ver ${attachment.file_name}`}
            >
              {/* Signed URL temporal: <img> nativo, next/image no aplica acá */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachment.url} alt={attachment.file_name} loading="lazy" />
              {canRemove(attachment) ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="sp-attachment-remove"
                  aria-label={`Eliminar ${attachment.file_name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(attachment);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemove(attachment);
                    }
                  }}
                >
                  {deletingId === attachment.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {rest.map((attachment) => (
        <AttachmentRow
          key={attachment.id}
          attachment={attachment}
          canRemove={canRemove(attachment)}
          isDeleting={deletingId === attachment.id}
          onRemove={() => onRemove(attachment)}
        />
      ))}
    </div>
  );
}

function AttachmentRow({
  attachment,
  canRemove,
  isDeleting,
  onRemove
}: {
  attachment: TaskAttachment;
  canRemove: boolean;
  isDeleting: boolean;
  onRemove: () => void;
}) {
  const kind = attachmentKind(attachment.mime_type, attachment.file_name);

  // Los videos no se pueden subir más, pero los que ya están se siguen viendo.
  if (kind === "video" && attachment.url) {
    return (
      <div className="sp-attachment-video">
        <video src={attachment.url} controls preload="metadata" />
        <div className="sp-attachment-video-meta">
          <span className="truncate">{attachment.file_name}</span>
          {canRemove ? (
            <button type="button" aria-label="Eliminar video" onClick={onRemove} disabled={isDeleting}>
              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const { icon: Icon, className } = ATTACHMENT_ICONS[kind];

  return (
    <div className="sp-attachment-doc">
      <span className={`sp-attachment-doc-icon ${className}`}>
        <Icon size={17} />
      </span>
      <span className="sp-attachment-doc-meta">
        <strong className="truncate">{attachment.file_name}</strong>
        <span>
          {attachmentKindLabel(kind)} · {formatFileSize(attachment.file_size_bytes)}
        </span>
      </span>
      {attachment.url ? (
        <a
          href={attachment.url}
          download={attachment.file_name}
          className="sp-attachment-doc-action"
          aria-label={`Descargar ${attachment.file_name}`}
        >
          <Download size={15} />
        </a>
      ) : null}
      {canRemove ? (
        <button
          type="button"
          className="sp-attachment-doc-action danger"
          aria-label={`Eliminar ${attachment.file_name}`}
          disabled={isDeleting}
          onClick={onRemove}
        >
          {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      ) : null}
    </div>
  );
}
