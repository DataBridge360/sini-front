"use client";

import { useState } from "react";
import { Download, File as FileIcon, FileImage, FileSpreadsheet, FileText, Loader2, MessageCircleQuestion } from "lucide-react";
import { GestiChart } from "@/components/ui/gesti-chart";
import { isSafeSourceUrl } from "@/lib/gesti-stream-text";
import type { ChartSpec, GestiFileRef, GestiQuestion } from "@/lib/gesti-parts";
import { formatFileSize } from "@/lib/task-attachments";

// Lo que acompaña al texto de una respuesta de Gesti: gráficos, la pregunta
// con opciones y los archivos que generó. El texto en sí está en streaming-text.tsx.

export function GestiCharts({ charts }: { charts: ChartSpec[] }) {
  if (charts.length === 0) return null;
  return (
    <div className="gesti-parts">
      {charts.map((chart, index) => (
        <GestiChart key={`${index}-${chart.title}`} chart={chart} />
      ))}
    </div>
  );
}

/**
 * Pregunta de Gesti con 2-4 opciones. Solo se puede contestar en la última
 * respuesta; apretar una opción manda ese texto como mensaje, y también se puede
 * escribir en el compositor.
 */
export function GestiQuestionCard({
  question,
  interactive,
  onAnswer
}: {
  question: GestiQuestion;
  interactive: boolean;
  onAnswer: (answer: string) => void;
}) {
  return (
    <section className="gesti-question" data-interactive={interactive} aria-label="Pregunta de Gesti">
      <p className="gesti-question-text">
        <MessageCircleQuestion size={16} strokeWidth={1.9} aria-hidden="true" />
        {question.question}
      </p>
      <ul className="gesti-question-options">
        {question.options.map((option) => (
          <li key={option}>
            <button type="button" disabled={!interactive} onClick={() => onAnswer(option)}>
              {option}
            </button>
          </li>
        ))}
      </ul>
      {interactive && question.allowFreeText ? (
        <p className="gesti-question-hint">O respondé con tus palabras en el mensaje de abajo.</p>
      ) : null}
    </section>
  );
}

function fileIconFor(file: Pick<GestiFileRef, "mime" | "name">) {
  if (file.mime.startsWith("image/")) return FileImage;
  if (file.mime.includes("spreadsheet") || /\.(xlsx|csv)$/i.test(file.name)) return FileSpreadsheet;
  if (file.mime === "application/pdf" || file.mime.includes("wordprocessing") || /\.(pdf|docx)$/i.test(file.name)) {
    return FileText;
  }
  return FileIcon;
}

function formatLabel(file: Pick<GestiFileRef, "mime" | "name">) {
  const extension = /\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1];
  return (extension ?? "archivo").toUpperCase();
}

/** Abre una URL firmada: el server la manda con el nombre de descarga, así que baja el archivo sin dejar la página. */
export function openSignedUrl(url: string) {
  if (!isSafeSourceUrl(url)) throw new Error("Enlace de descarga inválido");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function useFileDownload(resolveUrl: ((fileId: string) => Promise<string>) | undefined) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  async function download(fileId: string) {
    if (!resolveUrl || loadingId) return;
    setLoadingId(fileId);
    setFailedId(null);
    try {
      openSignedUrl(await resolveUrl(fileId));
    } catch {
      setFailedId(fileId);
    } finally {
      setLoadingId(null);
    }
  }

  return { loadingId, failedId, download: resolveUrl ? download : undefined };
}

/** Archivos que generó o editó Gesti, con su botón de descarga. */
export function GestiDocumentCards({
  documents,
  resolveUrl
}: {
  documents: GestiFileRef[];
  resolveUrl: ((fileId: string) => Promise<string>) | undefined;
}) {
  const { loadingId, failedId, download } = useFileDownload(resolveUrl);
  if (documents.length === 0) return null;
  return (
    <ul className="gesti-documents" aria-label="Archivos generados">
      {documents.map((file) => {
        const Icon = fileIconFor(file);
        const loading = loadingId === file.fileId;
        return (
          <li key={file.fileId} className="gesti-document">
            <span className="gesti-document-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <span className="gesti-document-meta">
              <span className="gesti-document-name" title={file.name}>
                {file.name}
              </span>
              <span className="gesti-document-size">
                {formatLabel(file)} · {formatFileSize(file.size)}
                {failedId === file.fileId ? (
                  <span className="gesti-document-error" role="alert">
                    {" "}
                    · No se pudo descargar. Probá de nuevo.
                  </span>
                ) : null}
              </span>
            </span>
            {download ? (
              <button
                type="button"
                className="gesti-document-download"
                disabled={loadingId !== null}
                onClick={() => void download(file.fileId)}
              >
                {loading ? (
                  <Loader2 size={15} strokeWidth={2} className="gesti-spin" aria-hidden="true" />
                ) : (
                  <Download size={15} strokeWidth={2} aria-hidden="true" />
                )}
                Descargar
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
