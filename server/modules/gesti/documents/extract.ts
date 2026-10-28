import "server-only";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { EXTRACTABLE_MIME, MAX_EXTRACTED_CHARS, type ExtractedDocument } from "./spec";

// Lee un archivo subido y lo convierte en texto plano para el modelo. Los
// errores de las librerías nunca salen tal cual: se traducen a un mensaje que
// el usuario puede leer.

export type DocumentKind = keyof typeof EXTRACTABLE_MIME;

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

const KIND_BY_MIME: Record<string, DocumentKind> = {
  [EXTRACTABLE_MIME.pdf]: "pdf",
  [EXTRACTABLE_MIME.docx]: "docx",
  [EXTRACTABLE_MIME.xlsx]: "xlsx",
  [EXTRACTABLE_MIME.csv]: "csv",
  "application/csv": "csv",
  [EXTRACTABLE_MIME.txt]: "txt"
};

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  csv: "csv",
  txt: "txt"
};

/** El mime manda; si viene vacío o genérico (pasa seguido en navegadores) se usa la extensión. */
export function detectDocumentKind(mime: string, name: string): DocumentKind | null {
  const byMime = KIND_BY_MIME[mime.split(";")[0]!.trim().toLowerCase()];
  if (byMime) return byMime;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (KIND_BY_EXTENSION[name.slice(dot + 1).trim().toLowerCase()] ?? null);
}

export async function extractDocument(bytes: Uint8Array, mime: string, name: string): Promise<ExtractedDocument> {
  const label = displayName(name);
  const kind = detectDocumentKind(mime, name);
  if (!kind) {
    throw new UnsupportedDocumentError(
      `No pude leer «${label}». Gesti lee archivos PDF, Word (.docx), Excel (.xlsx), CSV y TXT.`
    );
  }

  try {
    const raw = await readKind(kind, bytes);
    return finish(raw.text, raw.pages);
  } catch {
    throw new UnsupportedDocumentError(`No pude leer «${label}». El archivo parece estar dañado o protegido.`);
  }
}

async function readKind(kind: DocumentKind, bytes: Uint8Array): Promise<{ text: string; pages: number | null }> {
  switch (kind) {
    case "pdf":
      return readPdf(bytes);
    case "docx":
      return { text: (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value, pages: null };
    case "xlsx":
      return { text: await readXlsx(bytes), pages: null };
    default:
      return { text: new TextDecoder("utf-8").decode(bytes), pages: null };
  }
}

async function readPdf(bytes: Uint8Array) {
  // pdf.js se queda con el buffer que recibe: se le pasa una copia.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return {
    text: text.map((page, index) => `\n\n--- Página ${index + 1} ---\n${page}`).join(""),
    pages: totalPages
  };
}

async function readXlsx(bytes: Uint8Array): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);

  const sections: string[] = [];
  let size = 0;
  for (const sheet of workbook.worksheets) {
    const lines = [`## Hoja: ${sheet.name}`];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (size > MAX_EXTRACTED_CHARS) return;
      const cells: string[] = [];
      for (let column = 1; column <= row.cellCount; column++) {
        cells.push(cellText(row.getCell(column).value));
      }
      const line = cells.join("\t").replace(/\t+$/, "");
      if (!line.trim()) return;
      lines.push(line);
      size += line.length + 1;
    });
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value).replace(/[\t\r\n]+/g, " ");
  // Fórmulas: se usa el resultado cacheado, nunca la fórmula.
  if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  if ("richText" in value) return cellText(value.richText.map((part) => part.text).join(""));
  if ("text" in value) return cellText(String(value.text));
  if ("error" in value) return String(value.error);
  return "";
}

function finish(raw: string, pages: number | null): ExtractedDocument {
  const text = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const truncated = text.length > MAX_EXTRACTED_CHARS;
  return { text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text, pages, truncated };
}

// Se usa dentro de un mensaje para el usuario: sin caracteres de control ni nombres enormes.
function displayName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (clean.length > 80 ? `${clean.slice(0, 77)}...` : clean) || "archivo";
}
