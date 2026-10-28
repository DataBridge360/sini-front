"use client";

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  CornerDownRight,
  Globe,
  Maximize2,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { WebSource } from "@/lib/gesti-parts";
import {
  INITIAL_REVEAL,
  blockRanges,
  embedRevealed,
  embedSlots,
  isSafeSourceUrl,
  parseBlocks,
  sourceDomain,
  stepReveal,
  toPlainText,
  wordEnds,
  type InlineSpan,
  type RevealState,
  type TextBlock
} from "@/lib/gesti-stream-text";

// Texto de Gesti que se "escribe" a medida que llega: las palabras aparecen con
// un fundido corto (sin desenfoque: con el stream real se veía como lag), al
// ritmo de lib/gesti-stream-text.ts, que se acelera si el texto llega más
// rápido de lo que se lee. Dibuja el subconjunto de markdown que usa Gesti
// (**negrita**, viñetas, listas numeradas, borradores copiables y citas [[n]]).
// Recién al terminar se habilitan las acciones, las fuentes y las preguntas de
// seguimiento. Los gráficos y tablas (`embeds`) se dibujan dentro de la
// respuesta, en el hueco entre bloques donde Gesti los mostró y siempre arriba
// de las acciones.

const COPY_FEEDBACK_MS = 1800;
const DRAFT_COPY_FEEDBACK_MS = 1500;

/** Una sección de la app que consultó Gesti (la demo y las consultas a la cartera). */
export type StreamingSource = {
  id: string;
  name: string;
  hint?: string;
  icon: LucideIcon;
  /** Sin `onSelect` la fuente se muestra pero no navega (modo demo). */
  onSelect?: (() => void) | undefined;
};

// Qué es la cita [[n]]: la fuente web n; sin fuentes web (demo), la sección n de la app.
type Citation = { kind: "web"; n: number; source: WebSource } | { kind: "app"; source: StreamingSource };

function resolveCitation(n: number, webSources: WebSource[], appSources: StreamingSource[]): Citation | null {
  if (webSources.length > 0) {
    const source = webSources[n - 1];
    return source ? { kind: "web", n, source } : null;
  }
  const source = appSources[n - 1];
  return source ? { kind: "app", source } : null;
}

function CitationChip({ citation }: { citation: Citation }) {
  if (citation.kind === "web") {
    const { source, n } = citation;
    const domain = sourceDomain(source.url);
    const label = `Fuente ${n}: ${source.title || domain}`;
    if (!isSafeSourceUrl(source.url)) {
      return (
        <span className="gesti-cite is-web" title={label}>
          {n}
        </span>
      );
    }
    return (
      <a
        className="gesti-cite is-web"
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${source.title || domain} · ${domain}`}
        aria-label={label}
      >
        {n}
      </a>
    );
  }
  const { source } = citation;
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

/** Algo que va dentro de la respuesta, en el lugar del texto donde Gesti lo mostró. */
export type StreamingEmbed = {
  key: string;
  /** Caracteres de texto escritos cuando se mostró; sin esto (mensajes viejos), después del texto. */
  position: number | undefined;
  node: ReactNode;
};

const NO_EMBEDS: StreamingEmbed[] = [];

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
// Mientras llega (`complete` falso) crece en su lugar y no se puede copiar.
function DraftBlock({ body, complete, animated }: { body: string; complete: boolean; animated: boolean }) {
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
      <section className="gesti-draft" data-animated={animated} data-complete={complete} aria-labelledby={labelId}>
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
            disabled={!complete}
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
            disabled={!complete}
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

// Cuenta de palabras que se van numerando en todo el mensaje: la clave de cada
// una no cambia al llegar más texto, así que las ya escritas no vuelven a aparecer.
type WordCursor = { next: number };

function renderInline(
  spans: InlineSpan[],
  cursor: WordCursor,
  animated: boolean,
  webSources: WebSource[],
  appSources: StreamingSource[]
): ReactNode[] {
  return spans.map((span, index) => {
    if (span.kind === "cite") {
      const citation = resolveCitation(span.n, webSources, appSources);
      const next = spans[index + 1];
      // Sin espacio antes de un signo: "en [chip]." y no "en [chip] ."
      const tight = next?.kind === "text" && /^[.,;:!?)]/.test(next.text);
      return citation ? (
        <span key={`cite-${index}`} className="gesti-cite-wrap">
          <CitationChip citation={citation} />
          {tight ? null : " "}
        </span>
      ) : null;
    }
    const content: ReactNode = animated
      ? span.text.split(/(\s+)/).map((piece) => {
          if (piece === "" || /^\s+$/.test(piece)) return piece;
          const word = cursor.next++;
          return (
            <span key={word} className="gesti-word">
              {piece}
            </span>
          );
        })
      : span.text;
    return span.bold ? <strong key={`b-${index}`}>{content}</strong> : <span key={`t-${index}`}>{content}</span>;
  });
}

function Caret({ step }: { step: number }) {
  return <span key={step} className="gesti-caret" aria-hidden="true" />;
}

export function StreamingText({
  text,
  final,
  webSources = [],
  appSources = [],
  followUps = [],
  onFollowUp,
  onRetry,
  onProgress,
  embeds = NO_EMBEDS,
  instant = false
}: {
  /** Todo lo recibido hasta ahora. */
  text: string;
  /** El server terminó de mandar la respuesta: ya no va a llegar más texto. */
  final: boolean;
  webSources?: WebSource[];
  appSources?: StreamingSource[];
  followUps?: string[];
  onFollowUp?: (text: string) => void;
  /** Sin esto no hay "volver a generar": solo lo ofrecen las respuestas que fallaron. */
  onRetry?: () => void;
  /** Se llama en cada palabra nueva, para que el contenedor siga el scroll. */
  onProgress?: () => void;
  /** Gráficos y tablas de la respuesta, en el orden en que Gesti los mostró. */
  embeds?: StreamingEmbed[];
  /** Muestra el texto completo de entrada (un chat del historial). Solo cuenta al montar. */
  instant?: boolean;
}) {
  const [animated] = useState(!instant);
  const [reveal, setReveal] = useState<RevealState>(INITIAL_REVEAL);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { state: copyState, copy: copyText } = useCopyFeedback(COPY_FEEDBACK_MS);
  const sourcesId = useId();

  const ends = useMemo(() => wordEnds(text, final), [text, final]);
  const shown = animated ? Math.min(reveal.shown, ends.length) : ends.length;
  const complete = final && shown >= ends.length;
  const streaming = !complete;
  const visible = complete ? text : text.slice(0, ends[shown - 1] ?? 0);
  const blocks = useMemo(() => parseBlocks(visible, { complete }), [visible, complete]);

  // Cada embed va en un hueco entre bloques (nunca partiendo uno) y aparece
  // cuando el texto revelado llega a su posición.
  const ranges = useMemo(() => blockRanges(text), [text]);
  const slots = embedSlots(
    ranges,
    embeds.map((embed) => embed.position),
    text.length
  );
  const revealedLength = complete ? text.length : (ends[shown - 1] ?? 0);
  const embedsAt = (slot: number) =>
    embeds.flatMap((embed, index) =>
      Math.min(slots[index] ?? blocks.length, blocks.length) === slot &&
      embedRevealed(embed.position, text.length, revealedLength, complete)
        ? [
            <div key={`embed-${embed.key}`} className="gesti-stream-embed">
              {embed.node}
            </div>
          ]
        : []
    );

  // El ritmo sale del reloj y no de encadenar timeouts (ver stepReveal): si un
  // cuadro se atrasa, el siguiente muestra las palabras pendientes juntas.
  const availableRef = useRef(0);
  useEffect(() => {
    availableRef.current = ends.length;
  }, [ends.length]);
  const running = animated && !complete;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setReveal((current) => stepReveal(current, availableRef.current, delta));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [running]);

  const notifyProgress = useEffectEvent(() => onProgress?.());
  useEffect(() => {
    notifyProgress();
  }, [shown, sourcesOpen]);

  const plain = useMemo(() => toPlainText(text), [text]);
  const copyLabel =
    copyState === "copied" ? "Respuesta copiada" : copyState === "failed" ? "No se pudo copiar" : "Copiar respuesta";
  const sourceCount = webSources.length + appSources.length;

  const cursor: WordCursor = { next: 0 };
  const lastBlock = blocks[blocks.length - 1];
  // El cursor va al final del último párrafo o ítem; después de un borrador, en su propia línea.
  const caretOnOwnLine = streaming && (!lastBlock || (lastBlock.kind === "draft" && lastBlock.complete));
  const inline = (spans: InlineSpan[]) => renderInline(spans, cursor, animated, webSources, appSources);
  const renderBlock = (block: TextBlock, index: number) => {
    const caret = streaming && index === blocks.length - 1 && block.kind !== "draft" ? <Caret step={shown} /> : null;
    switch (block.kind) {
      case "paragraph":
        return (
          <p key={index} className="gesti-stream-text">
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line)}
              </span>
            ))}
            {caret}
          </p>
        );
      case "bullets":
      case "numbered": {
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {inline(item)}
            {itemIndex === block.items.length - 1 ? caret : null}
          </li>
        ));
        return block.kind === "bullets" ? (
          <ul key={index} className="gesti-stream-list">
            {items}
          </ul>
        ) : (
          <ol key={index} className="gesti-stream-list" start={block.start}>
            {items}
          </ol>
        );
      }
      case "draft":
        return <DraftBlock key={index} body={block.body} complete={block.complete} animated={animated} />;
    }
  };

  return (
    <div className="gesti-stream">
      <div className="gesti-stream-body" aria-busy={streaming}>
        {embedsAt(0)}
        {blocks.flatMap((block, index) => [renderBlock(block, index), ...embedsAt(index + 1)])}
        {caretOnOwnLine ? (
          <p className="gesti-stream-text">
            <Caret step={shown} />
          </p>
        ) : null}
      </div>

      <div className="gesti-stream-actions" data-ready={!streaming} inert={streaming}>
        {plain ? (
          <button
            type="button"
            className="gesti-icon-btn"
            onClick={() => void copyText(plain)}
            aria-label={copyLabel}
            title={copyLabel}
          >
            {copyState === "copied" ? <Check size={15} strokeWidth={1.8} /> : <Copy size={15} strokeWidth={1.8} />}
          </button>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            className="gesti-icon-btn"
            onClick={onRetry}
            aria-label="Volver a intentarlo"
            title="Volver a intentarlo"
          >
            <RotateCcw size={15} strokeWidth={1.8} />
          </button>
        ) : null}
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

        {sourceCount > 0 ? (
          <button
            type="button"
            className="gesti-sources-toggle"
            aria-expanded={sourcesOpen}
            aria-controls={sourcesId}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            <span className="gesti-source-stack" aria-hidden="true">
              {[
                ...webSources.map((source) => ({ id: source.url, Icon: Globe })),
                ...appSources.map((source) => ({ id: source.id, Icon: source.icon }))
              ]
                .slice(0, 3)
                .map(({ id, Icon }) => (
                  <span key={id} className="gesti-source-dot">
                    <Icon size={8} strokeWidth={2.4} />
                  </span>
                ))}
            </span>
            {sourceCount === 1 ? "1 fuente" : `${sourceCount} fuentes`}
            <ChevronRight size={12} strokeWidth={2} className="gesti-sources-caret" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {sourceCount > 0 ? (
        <div className="gesti-sources" id={sourcesId} data-open={sourcesOpen}>
          <div className="gesti-sources-clip" inert={!sourcesOpen || streaming}>
            <ul className="gesti-sources-list">
              {webSources.map((source, index) => {
                const domain = sourceDomain(source.url);
                const rowContent = (
                  <>
                    <span className="gesti-source-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="gesti-source-title">{source.title || domain}</span>
                    <span className="gesti-source-domain">{domain}</span>
                  </>
                );
                return (
                  <li key={`web-${source.url}`}>
                    {isSafeSourceUrl(source.url) ? (
                      <a
                        className="gesti-source-row is-web"
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {rowContent}
                      </a>
                    ) : (
                      <div className="gesti-source-row is-web">{rowContent}</div>
                    )}
                  </li>
                );
              })}
              {appSources.map((source) => {
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
          {followUps.map((followUp, index) => (
            <button
              key={followUp}
              type="button"
              style={{ animationDelay: `${index * 90}ms` }}
              onClick={() => onFollowUp?.(followUp)}
            >
              <CornerDownRight size={11} strokeWidth={2} aria-hidden="true" />
              {followUp}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
