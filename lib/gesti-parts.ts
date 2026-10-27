import { z } from "zod";

// Partes estructuradas de un mensaje de Gesti, compartidas por el server (las
// valida como input de las herramientas del modelo y las guarda en
// gesti_messages.parts) y por el chat (las dibuja). Todo con topes: lo escribe
// un modelo y no puede crecer sin límite.

export const CHART_KINDS = ["bar", "line", "area", "pie", "table"] as const;

export const MAX_CHART_LABELS = 60;
export const MAX_CHART_SERIES = 6;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 100;

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const chartSpecSchema = z
  .object({
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
      .optional()
  })
  .superRefine((chart, context) => {
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
  });

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
