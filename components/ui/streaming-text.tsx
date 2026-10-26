"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  CornerDownRight,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon
} from "lucide-react";

// Texto que se "escribe" palabra por palabra: cada palabra sale del desenfoque,
// la cita inline aparece en contexto y recién al terminar se habilitan las
// acciones, las fuentes y las preguntas de seguimiento. Se transmite una sola
// vez; "volver a generar" reinicia el flujo.

const WORD_MS = 45;
const BREAK_MS = 15;
const COPY_FEEDBACK_MS = 1800;

export type StreamToken = {
  text: string;
  /** Chip de cita inline: muestra la primera fuente. */
  cite?: boolean;
};

export type StreamingSource = {
  id: string;
  name: string;
  hint?: string;
  icon: LucideIcon;
  /** Sin `onSelect` la fuente se muestra pero no navega (modo demo). */
  onSelect?: (() => void) | undefined;
};

const CITE_MARKER = "[cite]";

// Convierte un texto en tokens: una palabra por token (con su espacio final),
// "\n" como salto de línea y "[cite]" como chip de cita.
export function toTokens(text: string): StreamToken[] {
  const tokens: StreamToken[] = [];
  for (const part of text.split(/(\[cite\]|\n)/)) {
    if (part === CITE_MARKER) {
      tokens.push({ text: "", cite: true });
    } else if (part === "\n") {
      tokens.push({ text: "\n" });
    } else {
      for (const word of part.split(/\s+/)) {
        if (word) tokens.push({ text: `${word} ` });
      }
    }
  }
  return tokens;
}

function plainText(tokens: StreamToken[]) {
  return tokens
    .map((token) => (token.cite ? "" : token.text))
    .join("")
    .replace(/ +\n/g, "\n")
    .trim();
}

function SourceChip({ source }: { source: StreamingSource }) {
  const Icon = source.icon;
  if (!source.onSelect) {
    return (
      <span className="gesti-cite">
        <Icon size={10} strokeWidth={2.2} aria-hidden="true" />
        {source.name}
      </span>
    );
  }
  return (
    <button type="button" className="gesti-cite" onClick={source.onSelect} title={`Abrir ${source.name}`}>
      <Icon size={10} strokeWidth={2.2} aria-hidden="true" />
      {source.name}
    </button>
  );
}

type Feedback = "up" | "down" | null;
type CopyState = "idle" | "copied" | "failed";

export function StreamingText({
  tokens,
  sources = [],
  followUps = [],
  onFollowUp,
  onStreamingChange,
  onProgress
}: {
  tokens: StreamToken[];
  sources?: StreamingSource[];
  followUps?: string[];
  onFollowUp?: (text: string) => void;
  /** Avisa cuando empieza (incluye el reinicio) y cuando termina de escribir. */
  onStreamingChange?: (streaming: boolean) => void;
  /** Se llama en cada palabra nueva, para que el contenedor siga el scroll. */
  onProgress?: () => void;
}) {
  const [count, setCount] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copyTimer = useRef<number | undefined>(undefined);
  const sourcesId = useId();

  const streaming = count < tokens.length;

  // El ritmo sale del reloj y no de encadenar timeouts: si un render se
  // atrasa, el siguiente cuadro muestra las palabras pendientes juntas y la
  // velocidad no se degrada con el largo de la respuesta.
  const [runId, setRunId] = useState(0);
  useEffect(() => {
    const schedule = tokens.map((token) => (token.text === "\n" ? BREAK_MS : WORD_MS));
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      let next = 0;
      let budget = elapsed;
      while (next < schedule.length) {
        const step = schedule[next] ?? WORD_MS;
        if (budget < step) break;
        budget -= step;
        next += 1;
      }
      setCount(next);
      if (next < schedule.length) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [tokens, runId]);

  const notifyStreaming = useEffectEvent((value: boolean) => onStreamingChange?.(value));
  useEffect(() => {
    notifyStreaming(streaming);
  }, [streaming]);

  const notifyProgress = useEffectEvent(() => onProgress?.());
  useEffect(() => {
    notifyProgress();
  }, [count, sourcesOpen]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  async function copy() {
    window.clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(plainText(tokens));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
  }

  function retry() {
    setCount(0);
    setRunId((current) => current + 1);
    setSourcesOpen(false);
    setFeedback(null);
    setCopyState("idle");
  }

  const citeSource = sources[0];
  const copyLabel =
    copyState === "copied" ? "Respuesta copiada" : copyState === "failed" ? "No se pudo copiar" : "Copiar respuesta";

  return (
    <div className="gesti-stream">
      <p className="gesti-stream-text" aria-busy={streaming}>
        {tokens.slice(0, count).map((token, index) => {
          if (token.cite) {
            return citeSource ? (
              <span key={index} className="gesti-cite-wrap">
                <SourceChip source={citeSource} />
                {/* Sin espacio antes de un signo: "en [chip]." y no "en [chip] ." */}
                {/^[.,;:!?)]/.test(tokens[index + 1]?.text ?? "") ? null : " "}
              </span>
            ) : null;
          }
          if (token.text === "\n") return <br key={index} />;
          return (
            <span key={index} className="gesti-word">
              {token.text}
            </span>
          );
        })}
        {streaming ? <span key={count} className="gesti-caret" aria-hidden="true" /> : null}
      </p>

      <div className="gesti-stream-actions" data-ready={!streaming} inert={streaming}>
        <button type="button" className="gesti-icon-btn" onClick={copy} aria-label={copyLabel} title={copyLabel}>
          {copyState === "copied" ? <Check size={15} strokeWidth={1.8} /> : <Copy size={15} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className="gesti-icon-btn"
          onClick={retry}
          aria-label="Volver a generar la respuesta"
          title="Volver a generar"
        >
          <RotateCcw size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="gesti-icon-btn"
          aria-label="Respuesta útil"
          title="Respuesta útil"
          aria-pressed={feedback === "up"}
          onClick={() => setFeedback((current) => (current === "up" ? null : "up"))}
        >
          <ThumbsUp size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="gesti-icon-btn"
          aria-label="Respuesta no útil"
          title="Respuesta no útil"
          aria-pressed={feedback === "down"}
          onClick={() => setFeedback((current) => (current === "down" ? null : "down"))}
        >
          <ThumbsDown size={15} strokeWidth={1.8} />
        </button>
        <span className="gesti-sr-only" role="status">
          {copyState === "idle" ? "" : copyLabel}
        </span>

        {sources.length > 0 ? (
          <button
            type="button"
            className="gesti-sources-toggle"
            aria-expanded={sourcesOpen}
            aria-controls={sourcesId}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            <span className="gesti-source-stack" aria-hidden="true">
              {sources.slice(0, 3).map((source) => {
                const Icon = source.icon;
                return (
                  <span key={source.id} className="gesti-source-dot">
                    <Icon size={8} strokeWidth={2.4} />
                  </span>
                );
              })}
            </span>
            {sources.length === 1 ? "1 fuente" : `${sources.length} fuentes`}
            <ChevronRight size={12} strokeWidth={2} className="gesti-sources-caret" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {sources.length > 0 ? (
        <div className="gesti-sources" id={sourcesId} data-open={sourcesOpen}>
          <div className="gesti-sources-clip" inert={!sourcesOpen || streaming}>
            <ul className="gesti-sources-list">
              {sources.map((source) => {
                const Icon = source.icon;
                const rowContent = (
                  <>
                    <span className="gesti-source-icon" aria-hidden="true">
                      <Icon size={11} strokeWidth={2} />
                    </span>
                    <span className="gesti-source-name">{source.name}</span>
                    {source.hint ? <span className="gesti-source-hint">{source.hint}</span> : null}
                  </>
                );
                return (
                  <li key={source.id}>
                    {source.onSelect ? (
                      <button type="button" className="gesti-source-row" onClick={source.onSelect}>
                        {rowContent}
                      </button>
                    ) : (
                      <div className="gesti-source-row">{rowContent}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {!streaming && followUps.length > 0 ? (
        <div className="gesti-followups">
          <p>Seguí con</p>
          {followUps.map((text, index) => (
            <button
              key={text}
              type="button"
              style={{ animationDelay: `${index * 90}ms` }}
              onClick={() => onFollowUp?.(text)}
            >
              <CornerDownRight size={11} strokeWidth={2} aria-hidden="true" />
              {text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
