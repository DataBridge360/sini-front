"use client";

import { AlertCircle, Camera, Loader2, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_TYPES_HINT,
  attachmentKindLabel,
  formatFileSize,
  prepareAttachment,
  releasePreview,
  type PreparedAttachment
} from "@/lib/task-attachments";
import { ATTACHMENT_ICONS } from "@/components/tasks/shared";

// Redactor de una actividad: texto y/o archivos, en un solo envío.
//
// Los archivos se comprimen y validan al agregarlos, no al enviar: enterarse de
// que un archivo no entra recién después de escribir el mensaje y tocar enviar
// es la peor versión de este flujo.
export function TaskActivityComposer({
  isSending,
  progress,
  onSend
}: {
  isSending: boolean;
  progress: number | null;
  onSend: (message: string, files: File[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<PreparedAttachment[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const queueRef = useRef<PreparedAttachment[]>([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Las previews son object URLs: si no se revocan, quedan reteniendo el archivo
  // en memoria mientras viva la pestaña.
  useEffect(() => {
    return () => {
      for (const item of queueRef.current) releasePreview(item);
    };
  }, []);

  const accepted = queue.filter((item) => item.ok);
  const canSend = (draft.trim().length > 0 || accepted.length > 0) && !isSending && !isPreparing;

  const addFiles = async (files: FileList | File[]) => {
    const incoming = [...files];
    if (incoming.length === 0) return;

    const room = ATTACHMENT_MAX_FILES - queue.filter((item) => item.ok).length;
    const allowed = incoming.slice(0, Math.max(0, room));

    setIsPreparing(true);
    try {
      const prepared = await Promise.all(allowed.map((file) => prepareAttachment(file)));
      const overflow = incoming.length - allowed.length;
      setQueue((current) => [
        ...current,
        ...prepared,
        ...(overflow > 0
          ? [
              {
                ok: false as const,
                id: `overflow-${Date.now()}`,
                fileName: "",
                error: `Se pueden adjuntar hasta ${ATTACHMENT_MAX_FILES} archivos por actividad; ${overflow} quedaron afuera.`
              }
            ]
          : [])
      ]);
    } finally {
      setIsPreparing(false);
    }
  };

  const removeFromQueue = (id: string) => {
    setQueue((current) => {
      const target = current.find((item) => item.id === id);
      if (target) releasePreview(target);
      return current.filter((item) => item.id !== id);
    });
  };

  const send = async () => {
    if (!canSend) return;
    try {
      await onSend(draft.trim(), accepted.map((item) => item.file));
      for (const item of queue) releasePreview(item);
      setDraft("");
      setQueue([]);
    } catch {
      // El toast de error ya se mostró. Se conservan el borrador Y la cola: que
      // el usuario tenga que volver a elegir 5 archivos por un error de red es
      // inaceptable.
    }
  };

  return (
    <div
      className="sp-activity-composer"
      data-drag={isDragging ? "on" : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setIsDragging(false);
        if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
      }}
    >
      {isSending && progress !== null ? (
        <div className="sp-activity-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
      ) : null}

      {queue.length > 0 ? (
        <div className="sp-composer-queue">
          {queue.map((item) =>
            item.ok ? (
              <div key={item.id} className="sp-composer-chip">
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" className="sp-composer-thumb" />
                ) : (
                  <span className={`sp-composer-icon ${ATTACHMENT_ICONS[item.kind].className}`}>
                    {(() => {
                      const Icon = ATTACHMENT_ICONS[item.kind].icon;
                      return <Icon size={15} />;
                    })()}
                  </span>
                )}
                <span className="sp-composer-chip-meta">
                  <strong className="truncate">{item.file.name}</strong>
                  <span>
                    {attachmentKindLabel(item.kind)} · {formatFileSize(item.file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Quitar ${item.file.name}`}
                  disabled={isSending}
                  onClick={() => removeFromQueue(item.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div key={item.id} className="sp-composer-chip error">
                <span className="sp-composer-icon bg-red-50 text-red-600">
                  <AlertCircle size={15} />
                </span>
                <span className="sp-composer-chip-meta">
                  <span className="sp-composer-error">{item.error}</span>
                </span>
                <button type="button" aria-label="Descartar" onClick={() => removeFromQueue(item.id)}>
                  <X size={13} />
                </button>
              </div>
            )
          )}
        </div>
      ) : null}

      <div className="sp-composer-row">
        <textarea
          value={draft}
          rows={2}
          placeholder="Escribí una actualización..."
          className="sp-composer-input"
          disabled={isSending}
          onChange={(event) => setDraft(event.target.value)}
          // Captura de pantalla + Ctrl+V: el caso más frecuente de adjuntar algo.
          onPaste={(event) => {
            const files = event.clipboardData.files;
            if (files.length > 0) {
              event.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />

        <div className="sp-composer-actions">
          <button
            type="button"
            className="sp-composer-attach"
            aria-label="Adjuntar archivo"
            title={ATTACHMENT_TYPES_HINT}
            disabled={isSending || isPreparing}
            onClick={() => fileInputRef.current?.click()}
          >
            {isPreparing ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          </button>

          {/* En el celular la mayoría de los adjuntos son fotos del momento. */}
          <button
            type="button"
            className="sp-composer-attach sp-composer-camera"
            aria-label="Sacar una foto"
            disabled={isSending || isPreparing}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={16} />
          </button>

          <button
            type="button"
            className="sp-composer-send"
            aria-label="Enviar actividad"
            disabled={!canSend}
            onClick={() => void send()}
          >
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>

      <p className="sp-composer-hint">
        {isSending && progress !== null
          ? `Enviando${accepted.length > 0 ? ` ${accepted.length} ${accepted.length === 1 ? "archivo" : "archivos"}` : ""}... ${Math.round(progress * 100)}%`
          : ATTACHMENT_TYPES_HINT}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
