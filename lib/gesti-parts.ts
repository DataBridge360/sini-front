import { z } from "zod";

// Partes estructuradas de un mensaje de Gesti, compartidas por el server (las
// valida como input de las herramientas del modelo y las guarda en
// gesti_messages.parts) y por el chat (las dibuja). Todo con topes: lo escribe
// un modelo y no puede crecer sin límite.

export const CHART_KINDS = ["bar", "line", "area", "pie", "table", "cards", "stats"] as const;

export const MAX_CHART_LABELS = 60;
export const MAX_CHART_SERIES = 6;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 100;
export const MAX_CARDS = 12;
export const MAX_CARD_FIELDS = 8;
export const MIN_STATS = 2;
export const MAX_STATS = 6;
/** Tope de `position`: la respuesta guardada nunca pasa de este largo. */
export const MAX_CHART_POSITION = 20_000;

const shortText = (max: number) => z.string().trim().min(1).max(max);

/** Qué registro de la cartera abre una fila de una tabla. */
export const CHART_LINK_KINDS = ["task", "policy", "client", "notice", "company"] as const;
export type ChartLinkKind = (typeof CHART_LINK_KINDS)[number];

/**
 * Enlace de una fila de tabla a un registro de la CRM. Lo arma SIEMPRE el
 * server a partir de las referencias opacas (`#Rk7q2-3`) que devolvieron las
 * herramientas de datos en este turno: el modelo nunca lo escribe ni lo ve.
 * `clientId` lo piden pólizas y avisos (se abren dentro de la ficha del
 * asegurado) y `policyId` los avisos (abren su póliza).
 */
export const chartLinkSchema = z.object({
  kind: z.enum(CHART_LINK_KINDS),
  id: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64).optional(),
  policyId: z.string().min(1).max(64).optional()
});

export type ChartLink = z.infer<typeof chartLinkSchema>;

/** Un dato de una card: etiqueta y valor ("Vence" / "20/10"). */
const cardFieldSchema = z.object({
  label: shortText(40),
  value: z.union([shortText(200), z.number().finite()])
});

const cardShape = {
  title: shortText(120),
  subtitle: z.string().trim().max(160).optional(),
  /** Estado corto ("Vencida", "Pendiente"); el color sale del texto. */
  badge: z.string().trim().min(1).max(30).optional(),
  fields: z.array(cardFieldSchema).max(MAX_CARD_FIELDS).optional()
};

/** La card tal como la escribe el modelo: `ref` es la referencia opaca del registro que muestra. */
const cardInputSchema = z.object({ ...cardShape, ref: z.string().max(40).nullable().optional() });

/** La card guardada: sin `ref`; su enlace resuelto va en `links` del gráfico, en el mismo orden. */
const cardSchema = z.object(cardShape);

export type ChartCard = z.infer<typeof cardSchema>;

/** Una cifra destacada de `stats`. */
const statSchema = z.object({
  label: shortText(60),
  value: z.union([shortText(40), z.number().finite()]),
  hint: z.string().trim().max(100).optional()
});

export type ChartStat = z.infer<typeof statSchema>;

const chartShape = {
  kind: z.enum(CHART_KINDS),
  title: shortText(120),
  subtitle: z.string().trim().max(200).optional(),
  /** Unidad de los valores, para ejes y tooltips: "$", "%", "pólizas". */
  unit: z.string().trim().max(20).optional(),
  /** Gráficos: una etiqueta por punto (eje X o porción de la torta). */
  labels: z.array(shortText(60)).max(MAX_CHART_LABELS).optional(),
  /** Gráficos: una serie por línea/grupo de barras; `pie` usa solo la primera. */
  series: z
    .array(
      z.object({
        name: shortText(60),
        values: z.array(z.number().finite()).max(MAX_CHART_LABELS)
      })
    )
    .max(MAX_CHART_SERIES)
    .optional(),
  /** Tablas: encabezados y filas. */
  columns: z.array(shortText(60)).max(MAX_TABLE_COLUMNS).optional(),
  rows: z
    .array(z.array(z.union([z.string().max(200), z.number().finite(), z.null()])).max(MAX_TABLE_COLUMNS))
    .max(MAX_TABLE_ROWS)
    .optional(),
  /** Stats: de 2 a 6 cifras destacadas. */
  items: z.array(statSchema).min(MIN_STATS).max(MAX_STATS).optional()
};

function checkChart(
  chart: {
    kind: (typeof CHART_KINDS)[number];
    labels?: string[] | undefined;
    series?: Array<{ values: number[] }> | undefined;
    columns?: string[] | undefined;
    rows?: unknown[][] | undefined;
    cards?: unknown[] | undefined;
    items?: unknown[] | undefined;
  },
  context: z.RefinementCtx
) {
  if (chart.kind === "cards") {
    if (!chart.cards?.length) context.addIssue({ code: "custom", message: "Cards need at least one card" });
    return;
  }
  if (chart.kind === "stats") {
    if (!chart.items || chart.items.length < MIN_STATS) {
      context.addIssue({ code: "custom", message: `Stats need between ${MIN_STATS} and ${MAX_STATS} items` });
    }
    return;
  }
  if (chart.kind === "table") {
    if (!chart.columns?.length || !chart.rows) {
      context.addIssue({ code: "custom", message: "A table needs columns and rows" });
      return;
    }
    if (chart.rows.some((row) => row.length !== chart.columns?.length)) {
      context.addIssue({ code: "custom", message: "Every row needs one cell per column" });
    }
    return;
  }
  const labels = chart.labels ?? [];
  const series = chart.series ?? [];
  if (labels.length === 0 || series.length === 0) {
    context.addIssue({ code: "custom", message: "A chart needs labels and at least one series" });
    return;
  }
  if (series.some((item) => item.values.length !== labels.length)) {
    context.addIssue({ code: "custom", message: "Every series needs one value per label" });
  }
  if (chart.kind === "pie" && (series[0]?.values ?? []).some((value) => value < 0)) {
    context.addIssue({ code: "custom", message: "A pie chart cannot have negative values" });
  }
}

/**
 * Lo que el modelo le pasa a show_chart. Para tablas, `refs` trae una
 * referencia opaca (`#Rk7q2-3`, la que vio junto al registro) por fila, o null;
 * para cards, cada card trae la suya en `ref`.
 * No acepta enlaces ni posición: eso lo pone el server.
 */
export const chartInputSchema = z
  .object({
    ...chartShape,
    /** Cards: de 1 a 12. */
    cards: z.array(cardInputSchema).min(1).max(MAX_CARDS).optional(),
    /** Tablas: la referencia (`#Rk7q2-3`) del registro que lista cada fila, en el mismo orden que `rows`. */
    refs: z.array(z.string().max(40).nullable()).max(MAX_TABLE_ROWS).optional()
  })
  .superRefine(checkChart);

export type ChartInput = z.infer<typeof chartInputSchema>;

/**
 * El gráfico tal como se guarda y se manda al navegador. Además de lo que
 * armó el modelo lleva lo que resolvió el server: `links` (uno por fila de una
 * tabla o por card, null si no abre nada) y `position` (cuántos caracteres de
 * texto se habían escrito cuando Gesti lo mostró; sin ella, después del texto).
 */
export const chartSpecSchema = z
  .object({
    ...chartShape,
    cards: z.array(cardSchema).min(1).max(MAX_CARDS).optional(),
    links: z.array(chartLinkSchema.nullable()).max(MAX_TABLE_ROWS).optional(),
    position: z.number().int().min(0).max(MAX_CHART_POSITION).optional()
  })
  .superRefine(checkChart);

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const webSourceSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().max(300)
});

export type WebSource = z.infer<typeof webSourceSchema>;

export const questionSchema = z.object({
  question: shortText(300),
  options: z.array(shortText(120)).min(2).max(4),
  /** Además de las opciones, el usuario puede responder con sus palabras. */
  allowFreeText: z.boolean().default(true)
});

export type GestiQuestion = z.infer<typeof questionSchema>;

export const DOCUMENT_FORMATS = ["docx", "pdf", "xlsx"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const fileRefSchema = z.object({
  fileId: z.string().uuid(),
  name: z.string().max(200),
  size: z.number().int().nonnegative(),
  mime: z.string().max(200)
});

export type GestiFileRef = z.infer<typeof fileRefSchema>;

export const APP_SOURCES = ["notices", "policies", "clients", "tasks", "companies"] as const;
export type AppSource = (typeof APP_SOURCES)[number];

export const messagePartsSchema = z.object({
  /** Archivos que adjuntó el usuario. */
  attachments: z.array(fileRefSchema).max(10).optional(),
  /** Páginas web citadas (web_search), en el orden de los chips [n]. */
  sources: z.array(webSourceSchema).max(20).optional(),
  /** Secciones de la app que consultó para responder. */
  appSources: z.array(z.enum(APP_SOURCES)).max(APP_SOURCES.length).optional(),
  charts: z.array(chartSpecSchema).max(4).optional(),
  question: questionSchema.optional(),
  /** Archivos que generó o editó Gesti. */
  documents: z.array(fileRefSchema).max(4).optional(),
  /** Respuesta especial: se agotó el presupuesto del mes o falló la respuesta. */
  notice: z.enum(["budget_exhausted", "error", "not_configured"]).optional()
});

export type MessageParts = z.infer<typeof messagePartsSchema>;

/** Tope de la respuesta visible de Gesti (S3). */
export const MAX_REPLY_CHARS = 5000;
