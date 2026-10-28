// Texto de una respuesta de Gesti que llega por partes. Acá está la lógica pura
// (sin React): cortar el texto en palabras completas, el ritmo con el que se
// muestran y el parser del subconjunto de markdown que usa el modelo
// (`**negrita**`, viñetas, listas numeradas, bloques `:::borrador` y citas
// `[[n]]`). La UI está en components/ui/streaming-text.tsx.

// ---------- Palabras ----------

/**
 * Posición (en el texto) donde termina cada palabra completa. Una palabra al
 * final del texto puede estar a medias mientras llega el stream: solo cuenta
 * cuando ya terminó (`final`), así nunca se muestra "**neg" ni ":::bor".
 */
export function wordEnds(text: string, final: boolean): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const end = match.index + match[0].length;
    if (end === text.length && !final) break;
    ends.push(end);
  }
  return ends;
}

// ---------- Ritmo ----------

/** Lo que tarda en aparecer cada palabra cuando el stream va más lento que la lectura. */
export const WORD_MS = 28;
/** Cuánto puede quedar atrás lo que se ve respecto de lo recibido. */
export const MAX_LAG_MS = 250;

export type RevealState = {
  /** Palabras ya visibles. */
  shown: number;
  /** Tiempo acumulado hacia la próxima palabra. */
  credit: number;
};

export const INITIAL_REVEAL: RevealState = { shown: 0, credit: 0 };

/**
 * Avanza el reloj `deltaMs`: una palabra cada `wordMs` y, si el stream trajo
 * más de lo que se alcanza a mostrar, salta para no quedar más de `maxLagMs`
 * atrás. Devuelve el mismo objeto si no cambió nada (React no re-renderiza).
 */
export function stepReveal(
  state: RevealState,
  available: number,
  deltaMs: number,
  wordMs = WORD_MS,
  maxLagMs = MAX_LAG_MS
): RevealState {
  if (state.shown >= available) {
    // Alcanzó lo recibido: no se guarda tiempo, o lo que llegue después saldría de golpe.
    return state.credit === 0 && state.shown === available ? state : { shown: available, credit: 0 };
  }
  const credit = state.credit + Math.max(0, deltaMs);
  const steps = Math.floor(credit / wordMs);
  let shown = Math.min(available, state.shown + steps);
  let rest = credit - steps * wordMs;
  const maxBacklog = Math.max(1, Math.floor(maxLagMs / wordMs));
  if (available - shown > maxBacklog) shown = available - maxBacklog;
  if (shown >= available) rest = 0;
  return shown === state.shown && rest === state.credit ? state : { shown, credit: rest };
}

// ---------- Markdown ----------

export type InlineSpan = { kind: "text"; text: string; bold: boolean } | { kind: "cite"; n: number };

export type TextBlock =
  | { kind: "paragraph"; lines: InlineSpan[][] }
  | { kind: "bullets"; items: InlineSpan[][] }
  | { kind: "numbered"; start: number; items: InlineSpan[][] }
  /** `complete` es falso mientras el bloque todavía no se cerró con `:::`. */
  | { kind: "draft"; body: string; complete: boolean };

const INLINE_TOKEN = /(\*\*|\[\[\d{1,2}\]\])/;
const CITE = /^\[\[(\d{1,2})\]\]$/;
const BULLET = /^\s*[•\-*]\s+(\S.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(\S.*)$/;
const DRAFT_OPEN = /^\s*:::\s*borrador\s*$/i;
const DRAFT_CLOSE = /^\s*:::\s*$/;

/**
 * Una línea en tramos de texto (con o sin negrita) y citas. Un `**` sin cerrar
 * mientras llega el stream deja en negrita lo que sigue; ya completo (`complete`)
 * es texto literal.
 */
export function parseInline(line: string, complete = true): InlineSpan[] {
  const parts = line.split(INLINE_TOKEN);
  const markers = parts.filter((part) => part === "**").length;
  const literalIndex = complete && markers % 2 === 1 ? parts.lastIndexOf("**") : -1;

  const spans: InlineSpan[] = [];
  let bold = false;
  const pushText = (text: string, isBold: boolean) => {
    if (!text) return;
    const last = spans[spans.length - 1];
    if (last?.kind === "text" && last.bold === isBold) last.text += text;
    else spans.push({ kind: "text", text, bold: isBold });
  };

  parts.forEach((part, index) => {
    if (part === "**" && index !== literalIndex) {
      bold = !bold;
      return;
    }
    const cite = CITE.exec(part);
    if (cite) {
      spans.push({ kind: "cite", n: Number(cite[1]) });
      return;
    }
    pushText(part, bold);
  });
  return spans;
}

export type BlockRange = { start: number; end: number };

/**
 * El texto (completo o a medias) en bloques, cada uno con dónde empieza y
 * termina en el texto original (también si usa saltos CRLF). Un `:::borrador`
 * sin cerrar es un borrador abierto: se muestra lo que lleva y sigue creciendo.
 */
function parseBlockRanges(text: string, complete: boolean): Array<{ block: TextBlock } & BlockRange> {
  const entries: Array<{ block: TextBlock } & BlockRange> = [];
  // Líneas y separadores alternados: el desplazamiento se cuenta sobre el texto original.
  const pieces = text.split(/(\r\n?|\n)/);

  let paragraph: InlineSpan[][] | null = null;
  let bullets: InlineSpan[][] | null = null;
  let numbered: Extract<TextBlock, { kind: "numbered" }> | null = null;
  let draft: string[] | null = null;
  let draftStart = 0;

  const flush = () => {
    paragraph = null;
    bullets = null;
    numbered = null;
  };
  // El bloque en curso siempre es el último: lo extiende hasta el final de esta línea.
  const extend = (end: number) => {
    const last = entries[entries.length - 1];
    if (last) last.end = end;
  };
  const open = (block: TextBlock, start: number, end: number) => {
    entries.push({ block, start, end });
  };

  let offset = 0;
  for (let index = 0; index < pieces.length; index += 2) {
    const line = pieces[index] ?? "";
    const lineStart = offset;
    const lineEnd = lineStart + line.trimEnd().length;
    offset += line.length + (pieces[index + 1]?.length ?? 0);

    if (draft) {
      if (DRAFT_CLOSE.test(line)) {
        open({ kind: "draft", body: draft.join("\n").trim(), complete: true }, draftStart, lineEnd);
        draft = null;
      } else {
        draft.push(line);
      }
      continue;
    }
    if (DRAFT_OPEN.test(line)) {
      flush();
      draft = [];
      draftStart = lineStart;
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      paragraph = null;
      numbered = null;
      const item = parseInline(bullet[1] ?? "", complete);
      if (bullets) {
        bullets.push(item);
        extend(lineEnd);
      } else {
        bullets = [item];
        open({ kind: "bullets", items: bullets }, lineStart, lineEnd);
      }
      continue;
    }
    const number = NUMBERED.exec(line);
    if (number) {
      paragraph = null;
      bullets = null;
      const item = parseInline(number[2] ?? "", complete);
      if (numbered) {
        numbered.items.push(item);
        extend(lineEnd);
      } else {
        numbered = { kind: "numbered", start: Number(number[1]), items: [item] };
        open(numbered, lineStart, lineEnd);
      }
      continue;
    }
    bullets = null;
    numbered = null;
    const spans = parseInline(line.trim(), complete);
    if (paragraph) {
      paragraph.push(spans);
      extend(lineEnd);
    } else {
      paragraph = [spans];
      open({ kind: "paragraph", lines: paragraph }, lineStart, lineEnd);
    }
  }

  if (draft) open({ kind: "draft", body: (draft as string[]).join("\n").trim(), complete: false }, draftStart, text.length);
  return entries;
}

/**
 * El texto (completo o a medias) en bloques. Un `:::borrador` sin cerrar es un
 * borrador abierto: se muestra lo que lleva y sigue creciendo.
 */
export function parseBlocks(text: string, options: { complete?: boolean } = {}): TextBlock[] {
  return parseBlockRanges(text, options.complete ?? true).map((entry) => entry.block);
}

/** Dónde empieza y termina cada bloque de `parseBlocks(text)`, en el texto original. */
export function blockRanges(text: string): BlockRange[] {
  return parseBlockRanges(text, true).map(({ start, end }) => ({ start, end }));
}

// ---------- Gráficos y tablas dentro del texto ----------

/**
 * En qué hueco entre bloques va cada gráfico: `n` significa "después de los
 * primeros n bloques" (0 = arriba de todo, la cantidad de bloques = al final).
 * `positions` son los caracteres de texto que Gesti había escrito al mostrarlo;
 * se recortan al texto, y un bloque que ya había empezado queda entero arriba
 * (nunca se parte un párrafo, una lista ni un borrador). Sin posición (mensajes
 * viejos) va después del texto. Respeta el orden: posiciones crecientes dan
 * huecos crecientes.
 */
export function embedSlots(
  ranges: ReadonlyArray<BlockRange>,
  positions: ReadonlyArray<number | undefined>,
  textLength: number
): number[] {
  return positions.map((position) => {
    if (position === undefined || !Number.isFinite(position)) return ranges.length;
    const clamped = Math.min(Math.max(0, Math.floor(position)), Math.max(0, textLength));
    return ranges.filter((range) => range.start < clamped).length;
  });
}

/**
 * Si un gráfico ya se puede mostrar mientras el texto se va escribiendo: cuando
 * lo revelado llega a su posición. Con el texto completo siempre se muestra, y
 * uno sin posición (mensajes viejos) espera a que el texto termine.
 */
export function embedRevealed(
  position: number | undefined,
  textLength: number,
  revealedLength: number,
  complete: boolean
): boolean {
  if (complete) return true;
  if (position === undefined || !Number.isFinite(position)) return false;
  return revealedLength >= Math.min(Math.max(0, Math.floor(position)), Math.max(0, textLength));
}

/** El texto sin marcas (para "Copiar respuesta"): sin `[[n]]`, sin `**` y con el borrador como párrafo. */
export function toPlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !DRAFT_OPEN.test(line) && !DRAFT_CLOSE.test(line))
    .join("\n")
    .replace(/[ \t]*\[\[\d{1,2}\]\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "https://www.bcra.gob.ar/x?y" → "bcra.gob.ar"; si no es una URL, el texto tal cual. */
export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Solo se abren enlaces http(s): una cita nunca puede llevar a `javascript:` u otro esquema. */
export function isSafeSourceUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
