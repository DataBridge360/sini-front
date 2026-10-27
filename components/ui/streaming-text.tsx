"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  CornerDownRight,
  Maximize2,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon
} from "lucide-react";
import { Modal } from "@/components/ui/modal";

// Texto que se "escribe" palabra por palabra: cada palabra sale del desenfoque,
// la cita inline aparece en contexto y recién al terminar se habilitan las
// acciones, las fuentes y las preguntas de seguimiento. Se transmite una sola
// vez; "volver a generar" reinicia el flujo. Si la respuesta trae un borrador
// (un mensaje para copiar), aparece como bloque cuando el texto llega a él y el
// resto sigue escribiéndose debajo.

const WORD_MS = 45;
const BREAK_MS = 15;
// Lo que tarda el bloque del borrador en "salir" antes de seguir con el texto.
const DRAFT_MS = 220;
const COPY_FEEDBACK_MS = 1800;
const DRAFT_COPY_FEEDBACK_MS = 1500;

export type StreamToken = {
  text: string;
  /** Chip de cita inline: muestra la primera fuente. */
  cite?: boolean;
  /** Bloque de borrador copiable: el cuerpo del mensaje, tal cual se copia. */
  draft?: string;
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

function wordTokens(text: string): StreamToken[] {
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

// Convierte un texto en tokens: una palabra por token (con su espacio final),
// "\n" como salto de línea y "[cite]" como chip de cita. Si se pasa `draft` y
// está en el texto, ese tramo es un solo token de bloque entre lo de antes y
// lo de después.
export function toTokens(text: string, draft?: string): StreamToken[] {
  const at = draft ? text.indexOf(draft) : -1;
  if (!draft || at < 0) return wordTokens(text);
  return [
    ...wordTokens(text.slice(0, at).trimEnd()),
    { text: "", draft },
    ...wordTokens(text.slice(at + draft.length).trimStart())
  ];
}

function plainText(tokens: StreamToken[]) {
  return tokens
    .map((token) => (token.draft === undefined ? (token.cite ? "" : token.text) : `\n\n${token.draft}\n\n`))
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

// Copia al portapapeles y deja el resultado a la vista un rato antes de volver a "idle".
function useCopyFeedback(feedbackMs: number) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      window.clearTimeout(timer.current);
      try {
        await navigator.clipboard.writeText(text);
        setState("copied");
      } catch {
        setState("failed");
      }
      timer.current = window.setTimeout(() => setState("idle"), feedbackMs);
    },
    [feedbackMs]
  );

  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    setState("idle");
  }, []);

  return { state, copy, reset };
}

// Mensaje listo para copiar: solo se copia el cuerpo, sin la frase de
// introducción ni la de cierre. "Expandir" lo abre grande para leerlo entero.
function DraftBlock({ body, animated }: { body: string; animated: boolean }) {
  const [open, setOpen] = useState(false);
  const { state, copy } = useCopyFeedback(DRAFT_COPY_FEEDBACK_MS);
  const expandRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  const close = useCallback(() => {
    setOpen(false);
    expandRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const statusText = state === "copied" ? "Copiado" : state === "failed" ? "No se pudo copiar" : "";
  const copyIcon = state === "copied" ? <Check size={15} strokeWidth={1.9} /> : <Copy size={15} strokeWidth={1.8} />;

  return (
    <>
      <section className="gesti-draft" data-animated={animated} aria-labelledby={labelId}>
        <header className="gesti-draft-head">
          <span id={labelId} className="gesti-draft-label">
            Borrador
          </span>
          <span className="gesti-draft-status" data-state={state} role="status">
            {statusText}
          </span>
          <button
            type="button"
            className="gesti-icon-btn"
            onClick={() => copy(body)}
            aria-label="Copiar borrador"
            title="Copiar borrador"
          >
            {copyIcon}
          </button>
          <button
            ref={expandRef}
            type="button"
            className="gesti-icon-btn"
            onClick={() => setOpen(true)}
            aria-label="Expandir borrador"
            title="Expandir borrador"
            aria-haspopup="dialog"
          >
            <Maximize2 size={15} strokeWidth={1.8} />
          </button>
        </header>
        <div className="gesti-draft-body">{body}</div>
      </section>

      <Modal title="Borrador" isOpen={open} onClose={close}>
        <div className="gesti-draft-modal">
          <div className="gesti-draft-modal-text">{body}</div>
          <div className="gesti-draft-modal-actions">
            <span className="gesti-draft-status" data-state={state} role="status">
              {statusText}
            </span>
            <button type="button" className="gesti-draft-copy" onClick={() => copy(body)} autoFocus>
              {copyIcon}
              Copiar
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

type Segment =
  | { kind: "text"; start: number; tokens: StreamToken[]; last: boolean }
  | { kind: "draft"; start: number; body: string };

// Parte lo visible en párrafos de texto y bloques de borrador, en orden. Si el
// último es un bloque y todavía se escribe, queda un párrafo vacío para el cursor.
function buildSegments(visible: StreamToken[], streaming: boolean): Segment[] {
  const segments: Segment[] = [];
  let run: Extract<Segment, { kind: "text" }> | null = null;
  visible.forEach((token, index) => {
    if (token.draft !== undefined) {
      run = null;
      segments.push({ kind: "draft", start: index, body: token.draft });
      return;
    }
    if (!run) {
      run = { kind: "text", start: index, tokens: [], last: false };
      segments.push(run);
    }
    run.tokens.push(token);
  });
  const tail = segments[segments.length - 1];
  if (streaming && tail?.kind === "draft") {
    segments.push({ kind: "text", start: tail.start + 1, tokens: [], last: true });
  } else if (tail?.kind === "text") {
    tail.last = true;
  }
  return segments;
}

export function StreamingText({
  tokens,
  sources = [],
  followUps = [],
  onFollowUp,
  onStreamingChange,
  onProgress,
  instant = false
}: {
  tokens: StreamToken[];
  sources?: StreamingSource[];
  followUps?: string[];
  onFollowUp?: (text: string) => void;
  /** Avisa cuando empieza (incluye el reinicio) y cuando termina de escribir. */
  onStreamingChange?: (streaming: boolean) => void;
  /** Se llama en cada palabra nueva, para que el contenedor siga el scroll. */
  onProgress?: () => void;
  /** Muestra el texto completo de entrada (un chat del historial). Solo cuenta al montar. */
  instant?: boolean;
}) {
  const [animated] = useState(!instant);
  const [count, setCount] = useState(() => (animated ? 0 : tokens.length));
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { state: copyState, copy: copyText, reset: resetCopy } = useCopyFeedback(COPY_FEEDBACK_MS);
  const sourcesId = useId();

  const streaming = count < tokens.length;

  // El ritmo sale del reloj y no de encadenar timeouts: si un render se
  // atrasa, el siguiente cuadro muestra las palabras pendientes juntas y la
  // velocidad no se degrada con el largo de la respuesta.
  const [runId, setRunId] = useState(0);
  useEffect(() => {
    // Lo restaurado ya está escrito; "Reintentar" (runId > 0) sí lo vuelve a escribir.
    if (!animated && runId === 0) return;
    const schedule = tokens.map((token) =>
      token.draft !== undefined ? DRAFT_MS : token.text === "\n" ? BREAK_MS : WORD_MS
    );
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
  }, [tokens, runId, animated]);

  const notifyStreaming = useEffectEvent((value: boolean) => onStreamingChange?.(value));
  useEffect(() => {
    notifyStreaming(streaming);
  }, [streaming]);

  const notifyProgress = useEffectEvent(() => onProgress?.());
  useEffect(() => {
    notifyProgress();
  }, [count, sourcesOpen]);

  function copy() {
    void copyText(plainText(tokens));
  }

  function retry() {
    setCount(0);
    setRunId((current) => current + 1);
    setSourcesOpen(false);
    setFeedback(null);
    resetCopy();
  }

  const segments = buildSegments(tokens.slice(0, count), streaming);
  const citeSource = sources[0];
  const copyLabel =
    copyState === "copied" ? "Respuesta copiada" : copyState === "failed" ? "No se pudo copiar" : "Copiar respuesta";

  return (
    <div className="gesti-stream">
      <div className="gesti-stream-body" aria-busy={streaming}>
        {segments.map((segment) =>
          segment.kind === "draft" ? (
            <DraftBlock key={`draft-${segment.start}`} body={segment.body} animated={animated} />
          ) : (
            <p key={`text-${segment.start}`} className="gesti-stream-text">
              {segment.tokens.map((token, offset) => {
                const index = segment.start + offset;
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
              {streaming && segment.last ? <span key={count} className="gesti-caret" aria-hidden="true" /> : null}
            </p>
          )
        )}
      </div>

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
