// Funciones puras de los gráficos de Gesti (components/ui/gesti-chart.tsx):
// formato es-AR, escala del eje Y, etiquetas del eje X, orden de tablas y
// geometría de la torta. Sin DOM, para poder probarlas con vitest.

export type ChartCell = string | number | null;

const EMPTY_VALUE = "—";
const LOCALE = "es-AR";

const formatters = new Map<number, Intl.NumberFormat>();

function numberFormat(maxFractionDigits: number) {
  let format = formatters.get(maxFractionDigits);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFractionDigits, useGrouping: false });
    formatters.set(maxFractionDigits, format);
  }
  return format;
}

/**
 * Número es-AR sin signo. Los miles se agrupan a mano: es-AR agrupa recién desde
 * 5 cifras (1234) y en un gráfico todos los miles tienen que verse igual (1.234).
 */
function formatDecimal(abs: number, maxFractionDigits: number) {
  const [integer = "0", fraction] = numberFormat(maxFractionDigits).format(abs).split(",");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction ? `${grouped},${fraction}` : grouped;
}

const COMPACT_TIERS = [
  { divisor: 1e12, suffix: " B" },
  { divisor: 1e9, suffix: " mil M" },
  { divisor: 1e6, suffix: " M" },
  { divisor: 1e3, suffix: " mil" }
];

/** A partir de cuánto un eje o una etiqueta abrevia los números ("12 mil", "1,5 M"). */
export const COMPACT_THRESHOLD = 10_000;

export function shouldCompact(maxAbs: number) {
  return Number.isFinite(maxAbs) && maxAbs >= COMPACT_THRESHOLD;
}

const roundTenth = (value: number) => Math.round(value * 10) / 10;

/** Magnitud sin signo, ya formateada. */
function formatMagnitude(abs: number, compact: boolean, maxFractionDigits: number) {
  if (compact) {
    for (const [index, tier] of COMPACT_TIERS.entries()) {
      if (abs < tier.divisor) continue;
      const scaled = roundTenth(abs / tier.divisor);
      // 999.960 se redondea a 1000 mil: sube a la unidad siguiente ("1 M").
      const bigger = COMPACT_TIERS[index - 1];
      if (scaled >= 1000 && bigger) return `${formatDecimal(roundTenth(abs / bigger.divisor), 1)}${bigger.suffix}`;
      return `${formatDecimal(scaled, 1)}${tier.suffix}`;
    }
  }
  return formatDecimal(abs, maxFractionDigits);
}

export type FormatOptions = {
  /** Abrevia miles y millones. */
  compact?: boolean;
  /** Decimales máximos fuera del modo compacto (2 por defecto). */
  maxFractionDigits?: number;
};

/** Número es-AR sin unidad: `1.234,5`, o `1,2 M` en modo compacto. */
export function formatNumber(value: number, options: FormatOptions = {}) {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const text = formatMagnitude(Math.abs(value), options.compact ?? false, options.maxFractionDigits ?? 2);
  // Un valor que redondea a cero no lleva signo ("-0").
  const isZero = /^0(,0*)?$/.test(text);
  return value < 0 && !isZero ? `-${text}` : text;
}

/** Valor con unidad: "$" va delante, "%" pegado detrás, el resto detrás con un espacio. */
export function formatValue(value: number, unit?: string, options: FormatOptions = {}) {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const number = formatNumber(Math.abs(value), options);
  const sign = value < 0 && number !== "0" ? "-" : "";
  const cleanUnit = unit?.trim();
  if (!cleanUnit) return `${sign}${number}`;
  if (cleanUnit === "$") return `${sign}$${number}`;
  if (cleanUnit === "%") return `${sign}${number}%`;
  return `${sign}${number} ${cleanUnit}`;
}

/** Participación (0–1) como porcentaje es-AR con hasta un decimal: `12,5%`. */
export function formatPercent(share: number) {
  if (!Number.isFinite(share)) return EMPTY_VALUE;
  return `${formatDecimal(share * 100, 1)}%`;
}

export function truncateLabel(label: string, max: number) {
  const chars = Array.from(label);
  if (chars.length <= max) return label;
  return `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

// ---------- Eje Y ----------

export type NiceScale = {
  min: number;
  max: number;
  step: number;
  ticks: number[];
};

const STEP_MANTISSAS = [1, 2, 2.5, 5, 10];

/**
 * Escala "linda" para el eje Y: el paso más fino (1, 2, 2,5 o 5 × 10^n) que deja
 * como máximo `maxTicks` marcas y cubre [min, max]. Tolera rangos vacíos,
 * valores iguales, negativos y datos no finitos (nunca devuelve NaN).
 */
export function niceTicks(rawMin: number, rawMax: number, options: { maxTicks?: number; includeZero?: boolean } = {}): NiceScale {
  const maxTicks = Math.min(10, Math.max(2, Math.floor(options.maxTicks ?? 5)));
  let min = Number.isFinite(rawMin) ? rawMin : 0;
  let max = Number.isFinite(rawMax) ? rawMax : 0;
  if (min > max) [min, max] = [max, min];
  if (options.includeZero ?? true) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    if (min === 0) {
      max = 1;
    } else {
      const pad = Math.abs(min) * 0.1;
      min -= pad;
      max += pad;
    }
  }

  const exponent = Math.floor(Math.log10((max - min) / maxTicks)) - 1;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const mantissa of STEP_MANTISSAS) {
      const power = exponent + attempt;
      const step = mantissa * 10 ** power;
      const first = Math.floor(min / step + 1e-9);
      const last = Math.ceil(max / step - 1e-9);
      if (last - first + 1 > maxTicks) continue;
      const decimals = Math.min(12, Math.max(0, -power + (mantissa === 2.5 ? 1 : 0)));
      const ticks: number[] = [];
      for (let index = first; index <= last; index += 1) {
        ticks.push(Number((index * step).toFixed(decimals)) + 0);
      }
      return { min: ticks[0] ?? min, max: ticks[ticks.length - 1] ?? max, step, ticks };
    }
  }
  return { min, max, step: max - min, ticks: [min, max] };
}

/**
 * El eje arranca en cero salvo en las líneas cuyos valores son positivos y casi
 * iguales: ahí cero aplasta la línea y se acerca a [min, max].
 */
export function shouldIncludeZero(kind: "bar" | "line" | "area", min: number, max: number) {
  if (kind !== "line") return true;
  if (!(min > 0) || !(max > 0)) return true;
  return (max - min) / max >= 0.25;
}

// ---------- Eje X ----------

export type XLabelPlan = {
  /** Se dibuja una etiqueta cada `step` puntos. */
  step: number;
  rotate: boolean;
};

const CHAR_WIDTH = 6;
const LABEL_GAP = 6;
const ROTATED_SLOT = 14;

/**
 * Decide cómo entran las etiquetas del eje X: horizontales y completas si
 * caben, horizontales salteando algunas si alcanza con saltear una, o inclinadas
 * (con salto si hace falta) cuando están muy apretadas.
 */
export function planXLabels(count: number, plotWidth: number, longestLabel: number): XLabelPlan {
  if (count <= 1 || !(plotWidth > 0)) return { step: 1, rotate: false };
  const slot = plotWidth / count;
  const needed = longestLabel * CHAR_WIDTH + LABEL_GAP;
  if (slot >= needed) return { step: 1, rotate: false };
  const horizontalStep = Math.ceil(needed / slot);
  if (horizontalStep <= 2) return { step: horizontalStep, rotate: false };
  return { step: Math.max(1, Math.ceil(ROTATED_SLOT / slot)), rotate: true };
}

// ---------- Tablas ----------

export type SortDirection = "asc" | "desc";

export function isNumericColumn(rows: ChartCell[][], column: number) {
  let seen = false;
  for (const row of rows) {
    const cell = row[column];
    if (cell === null || cell === undefined) continue;
    if (typeof cell !== "number") return false;
    seen = true;
  }
  return seen;
}

// "30/10", "01/11/2026" o "28/10 (hoy)" → un número que ordena por fecha. Sin año
// cuenta como el mismo año (las tablas de vencimientos son de pocos días).
const DATE_CELL = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?!\d)/;

function dateSortKey(cell: string): number | null {
  const match = DATE_CELL.exec(cell.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : 0;
  return year * 10_000 + month * 100 + day;
}

function compareText(left: string, right: string) {
  const leftDate = dateSortKey(left);
  const rightDate = dateSortKey(right);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  return left.localeCompare(right, LOCALE, { numeric: true, sensitivity: "base" });
}

/** Posiciones originales de las filas, ya ordenadas. Las celdas vacías van siempre al final. Las fechas dd/mm, por fecha. Estable. */
function sortedIndexes(rows: ChartCell[][], column: number, direction: SortDirection) {
  const factor = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = a.row[column] ?? null;
      const right = b.row[column] ?? null;
      if (left === null || right === null) {
        if (left === right) return a.index - b.index;
        return left === null ? 1 : -1;
      }
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : compareText(String(left), String(right));
      return result === 0 ? a.index - b.index : result * factor;
    })
    .map((item) => item.index);
}

/** Ordena sin mutar; las celdas vacías van siempre al final. Las fechas dd/mm, por fecha. Estable. */
export function sortRows(rows: ChartCell[][], column: number, direction: SortDirection) {
  return sortedIndexes(rows, column, direction).map((index) => rows[index] as ChartCell[]);
}

export type TableEntry<L> = { row: ChartCell[]; link: L | null; index: number };

/**
 * Las filas de una tabla en el orden a mostrar, cada una con SU enlace (el de
 * la fila original, también después de ordenar) y su posición original.
 */
export function tableEntries<L>(
  rows: ChartCell[][],
  links: ReadonlyArray<L | null> | undefined,
  sort: { column: number; direction: SortDirection } | null
): Array<TableEntry<L>> {
  const order = sort ? sortedIndexes(rows, sort.column, sort.direction) : rows.map((_, index) => index);
  return order.map((index) => ({ row: rows[index] as ChartCell[], link: links?.[index] ?? null, index }));
}

const LINK_LABELS = {
  task: "tarea",
  policy: "póliza",
  notice: "aviso de pago",
  client: "asegurado",
  company: "compañía"
} as const;

export type RecordDestination =
  | { tab: "tasks"; taskId: string }
  | { tab: "clients"; clientId: string; policyId: string | null }
  | { tab: "companies" };

/**
 * A dónde lleva el enlace de una fila: una tarea abre su detalle; una póliza o
 * un aviso (que abre su póliza) la ficha del asegurado con esa póliza abierta;
 * un asegurado, su ficha; una compañía, la pestaña de compañías. Null si falta
 * algún id para poder abrirlo.
 */
export function recordDestination(link: {
  kind: keyof typeof LINK_LABELS;
  id: string;
  clientId?: string | undefined;
  policyId?: string | undefined;
}): RecordDestination | null {
  switch (link.kind) {
    case "task":
      return { tab: "tasks", taskId: link.id };
    case "policy":
      return link.clientId ? { tab: "clients", clientId: link.clientId, policyId: link.id } : null;
    case "notice":
      return link.clientId && link.policyId ? { tab: "clients", clientId: link.clientId, policyId: link.policyId } : null;
    case "client":
      return { tab: "clients", clientId: link.id, policyId: null };
    case "company":
      return { tab: "companies" };
  }
}

/** Etiqueta accesible de una fila clickeable: "Abrir tarea: Llamar a Ana". */
export function recordLinkLabel(kind: keyof typeof LINK_LABELS, cell: ChartCell | undefined): string {
  const name = cell === null || cell === undefined ? "" : String(cell).trim();
  return name ? `Abrir ${LINK_LABELS[kind]}: ${name}` : `Abrir ${LINK_LABELS[kind]}`;
}

// ---------- Cards ----------

export type BadgeTone = "danger" | "warning" | "ok" | "neutral";

// Sobre el texto sin tildes y en minúsculas. Primero lo grave: "no pagado" no es "pagado".
const TONE_PATTERNS: ReadonlyArray<readonly [Exclude<BadgeTone, "neutral">, RegExp]> = [
  ["danger", /\b(vencid[oa]s?|impag[oa]s?|atrasad[oa]s?|rechazad[oa]s?|no (pagad|cobrad)[oa]s?)\b/],
  ["warning", /\b(pendientes?|por (avisar|vencer|cobrar))\b/],
  ["ok", /\b(pagad[oa]s?|cobrad[oa]s?|al dia|completad[oa]s?|resuelt[oa]s?|vigentes?)\b/]
];

/** Color de la insignia de una card según suene a estado: vencida, pendiente, pagado... Sin match, neutro. */
export function badgeTone(text: string): BadgeTone {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const [tone, pattern] of TONE_PATTERNS) if (pattern.test(normalized)) return tone;
  return "neutral";
}

// ---------- Torta ----------

export type Slice = { label: string; value: number; sourceIndexes: number[] };

/**
 * Deja a lo sumo `max` porciones: si hay más, se queda con las más grandes (en su
 * orden original) y junta el resto en "Otros". Los valores negativos cuentan como 0.
 */
export function groupSlices(labels: string[], values: number[], max = 6, othersLabel = "Otros"): Slice[] {
  const slices: Slice[] = labels.map((label, index) => ({
    label,
    value: Math.max(0, values[index] !== undefined && Number.isFinite(values[index]) ? (values[index] ?? 0) : 0),
    sourceIndexes: [index]
  }));
  if (slices.length <= max) return slices;
  const keep = new Set(
    [...slices]
      .sort((a, b) => b.value - a.value || (a.sourceIndexes[0] ?? 0) - (b.sourceIndexes[0] ?? 0))
      .slice(0, max - 1)
      .map((slice) => slice.sourceIndexes[0])
  );
  const kept = slices.filter((slice) => keep.has(slice.sourceIndexes[0] ?? -1));
  const rest = slices.filter((slice) => !keep.has(slice.sourceIndexes[0] ?? -1));
  return [
    ...kept,
    {
      label: othersLabel,
      value: rest.reduce((sum, slice) => sum + slice.value, 0),
      sourceIndexes: rest.flatMap((slice) => slice.sourceIndexes)
    }
  ];
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  // 0 rad = arriba, en sentido horario.
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)] as const;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function arcSegment(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
  const [x1, y1] = polar(cx, cy, outer, start);
  const [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end);
  const [x4, y4] = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return (
    `M${round(x1)} ${round(y1)}A${outer} ${outer} 0 ${large} 1 ${round(x2)} ${round(y2)}` +
    `L${round(x3)} ${round(y3)}A${inner} ${inner} 0 ${large} 0 ${round(x4)} ${round(y4)}Z`
  );
}

/** Path de una porción de dona entre dos ángulos (radianes, 0 = arriba). */
export function donutSlicePath(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
  const sweep = end - start;
  if (!(sweep > 0)) return "";
  // Un arco de 360° colapsa en SVG: se dibuja como dos mitades.
  if (sweep >= Math.PI * 2 - 1e-6) {
    const middle = start + Math.PI;
    return `${arcSegment(cx, cy, outer, inner, start, middle)}${arcSegment(cx, cy, outer, inner, middle, start + Math.PI * 2)}`;
  }
  return arcSegment(cx, cy, outer, inner, start, end);
}

// ---------- Accesibilidad ----------

const KIND_LABELS: Record<string, string> = {
  bar: "Gráfico de barras",
  line: "Gráfico de líneas",
  area: "Gráfico de áreas",
  pie: "Gráfico de torta",
  table: "Tabla"
};

/** Resumen para el aria-label del SVG: qué es, cuántos puntos y el rango de valores. */
export function summarizeChart(input: { kind: string; title: string; unit?: string | undefined; labels: string[]; seriesNames: string[]; min: number; max: number }) {
  const parts = [`${KIND_LABELS[input.kind] ?? "Gráfico"}: ${input.title}`];
  const count = input.labels.length;
  if (count > 0) {
    parts.push(`${count} ${count === 1 ? "punto" : "puntos"}, de ${input.labels[0]} a ${input.labels[count - 1]}`);
  }
  if (input.seriesNames.length > 0) {
    parts.push(`${input.seriesNames.length === 1 ? "Serie" : "Series"}: ${input.seriesNames.join(", ")}`);
  }
  if (Number.isFinite(input.min) && Number.isFinite(input.max) && count > 0) {
    parts.push(`Valores entre ${formatValue(input.min, input.unit)} y ${formatValue(input.max, input.unit)}`);
  }
  return `${parts.join(". ")}.`;
}
