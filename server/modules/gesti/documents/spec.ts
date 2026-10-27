import { z } from "zod";
import { DOCUMENT_FORMATS } from "@/lib/gesti-parts";

// Lo que el modelo escribe para generar un archivo (create_document y
// edit_document). El modelo nunca escribe código ni bytes: describe el
// contenido y el server arma el DOCX, PDF o XLSX. Topes para que un input
// gigante no tumbe la función.

export const MAX_DOCUMENT_BLOCKS = 400;
export const MAX_BLOCK_TABLE_ROWS = 500;
export const MAX_SHEETS = 10;
export const MAX_SHEET_ROWS = 5000;
export const MAX_SHEET_COLUMNS = 50;

const text = (max: number) => z.string().max(max);

export const documentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: text(300), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  /** Admite **negrita** en línea. */
  z.object({ type: z.literal("paragraph"), text: text(8000) }),
  z.object({ type: z.literal("list"), items: z.array(text(2000)).max(200), ordered: z.boolean().optional() }),
  z.object({
    type: z.literal("table"),
    headers: z.array(text(200)).min(1).max(20),
    rows: z.array(z.array(text(1000)).max(20)).max(MAX_BLOCK_TABLE_ROWS)
  }),
  z.object({ type: z.literal("page_break") })
]);

export type DocumentBlock = z.infer<typeof documentBlockSchema>;

const cellSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);

export const sheetSchema = z.object({
  name: z.string().trim().min(1).max(31),
  headers: z.array(text(200)).max(MAX_SHEET_COLUMNS),
  rows: z.array(z.array(cellSchema).max(MAX_SHEET_COLUMNS)).max(MAX_SHEET_ROWS)
});

export type SheetSpec = z.infer<typeof sheetSchema>;

export const documentSpecSchema = z
  .object({
    format: z.enum(DOCUMENT_FORMATS),
    /** Nombre del archivo sin extensión. */
    filename: z.string().trim().min(1).max(80),
    title: z.string().trim().max(200).optional(),
    /** DOCX y PDF. */
    blocks: z.array(documentBlockSchema).max(MAX_DOCUMENT_BLOCKS).optional(),
    /** XLSX. */
    sheets: z.array(sheetSchema).min(1).max(MAX_SHEETS).optional()
  })
  .superRefine((spec, context) => {
    if (spec.format === "xlsx" && !spec.sheets?.length) {
      context.addIssue({ code: "custom", message: "An xlsx document needs at least one sheet" });
    }
    if (spec.format !== "xlsx" && !spec.blocks?.length) {
      context.addIssue({ code: "custom", message: "A docx or pdf document needs at least one block" });
    }
  });

export type DocumentSpec = z.infer<typeof documentSpecSchema>;

export const DOCUMENT_MIME: Record<DocumentSpec["format"], string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

/** Resultado de leer un archivo subido. */
export type ExtractedDocument = {
  /** Texto plano; las planillas van como TSV con "## Hoja: <nombre>" por hoja. */
  text: string;
  /** Páginas del PDF; null en otros formatos. */
  pages: number | null;
  /** El texto se cortó en MAX_EXTRACTED_CHARS. */
  truncated: boolean;
};

export const MAX_EXTRACTED_CHARS = 400_000;

/** Tipos que Gesti sabe leer como texto. */
export const EXTRACTABLE_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain"
} as const;
