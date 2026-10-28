import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import ExcelJS from "exceljs";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { DOCUMENT_MIME, documentSpecSchema, type DocumentBlock, type DocumentSpec, type SheetSpec } from "./spec";

// Arma el archivo a partir de lo que describió el modelo. El input se valida
// acá porque los llamadores pueden pasar datos sin validar.

export type RenderedDocument = { bytes: Uint8Array; mime: string; filename: string };

export async function renderDocument(input: DocumentSpec): Promise<RenderedDocument> {
  const spec = documentSpecSchema.parse(input);
  const blocks = spec.blocks ?? [];
  const bytes =
    spec.format === "docx"
      ? await renderDocx(spec, blocks)
      : spec.format === "pdf"
        ? await renderPdf(spec, blocks)
        : await renderXlsx(spec.sheets ?? []);
  return { bytes, mime: DOCUMENT_MIME[spec.format], filename: `${sanitizeFilename(spec.filename)}.${spec.format}` };
}

function sanitizeFilename(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    // Sin puntos ni espacios en los bordes ("..", ".hidden", "nombre."): Windows los descarta o los confunde.
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return clean || "documento";
}

/** Parte "texto **negrita** texto" en tramos; un ** sin cerrar deja en negrita hasta el final. */
function parseInline(text: string): { text: string; bold: boolean }[] {
  return text
    .split("**")
    .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
    .filter((run) => run.text);
}

// ---------------------------------------------------------------- DOCX

const DOCX_FONT = "Calibri";
// A4 con márgenes de 1": 11906 - 2 * 1440 twips.
const DOCX_CONTENT_WIDTH = 9026;
const DOCX_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const DOCX_HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;

function docxRuns(text: string, bold = false): TextRun[] {
  return text.split("\n").flatMap((line, lineIndex) => {
    const runs = parseInline(line);
    if (!runs.length) return lineIndex ? [new TextRun({ text: "", break: 1 })] : [];
    return runs.map(
      (run, runIndex) =>
        new TextRun({ text: run.text, bold: bold || run.bold, ...(lineIndex && !runIndex ? { break: 1 } : {}) })
    );
  });
}

async function renderDocx(spec: DocumentSpec, blocks: DocumentBlock[]): Promise<Uint8Array> {
  let orderedLists = 0;
  const children: (Paragraph | Table)[] = [];

  if (spec.title) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(spec.title)] }));
  }

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        children.push(new Paragraph({ heading: DOCX_HEADINGS[block.level], children: docxRuns(block.text) }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: docxRuns(block.text) }));
        break;
      case "list": {
        const instance = block.ordered ? ++orderedLists : 0;
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: docxRuns(item),
              numbering: block.ordered
                ? { reference: "ordered", level: 0, instance }
                : { reference: "bullets", level: 0 },
              spacing: { after: 60 }
            })
          );
        }
        break;
      }
      case "table":
        children.push(docxTable(block.headers, block.rows), new Paragraph({ spacing: { after: 120 } }));
        break;
      case "page_break":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  const hanging = { left: 720, hanging: 360 };
  const doc = new Document({
    title: spec.title ?? spec.filename,
    styles: {
      default: {
        document: { run: { font: DOCX_FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } },
        title: { run: { font: DOCX_FONT, size: 48, bold: true }, paragraph: { spacing: { after: 240 } } },
        heading1: { run: { font: DOCX_FONT, size: 32, bold: true }, paragraph: { spacing: { before: 320, after: 120 } } },
        heading2: { run: { font: DOCX_FONT, size: 28, bold: true }, paragraph: { spacing: { before: 240, after: 100 } } },
        heading3: { run: { font: DOCX_FONT, size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 80 } } }
      }
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: hanging } } }]
        },
        {
          reference: "ordered",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: hanging } } }]
        }
      ]
    },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 } } }, children }]
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function docxTable(headers: string[], rows: string[][]): Table {
  const columns = headers.length;
  const width = Math.floor(DOCX_CONTENT_WIDTH / columns);
  const cell = (text: string, header: boolean) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      ...(header ? { shading: { type: ShadingType.CLEAR, fill: "E7E7E7", color: "auto" } } : {}),
      children: [new Paragraph({ spacing: { after: 0 }, children: docxRuns(text, header) })]
    });

  return new Table({
    width: { size: width * columns, type: WidthType.DXA },
    columnWidths: Array<number>(columns).fill(width),
    borders: {
      top: DOCX_BORDER,
      bottom: DOCX_BORDER,
      left: DOCX_BORDER,
      right: DOCX_BORDER,
      insideHorizontal: DOCX_BORDER,
      insideVertical: DOCX_BORDER
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((text) => cell(text, true)) }),
      // Las filas más cortas que el encabezado se completan para que la grilla quede rectangular.
      ...rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: headers.map((_, index) => cell(row[index] ?? "", false))
          })
      )
    ]
  });
}

// ---------------------------------------------------------------- PDF

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// Debajo de este límite no se escribe contenido: queda el pie de página.
const BOTTOM = 62;
const BODY_SIZE = 10.5;
const CELL_SIZE = 9.5;
const CELL_PADDING = 4;
const LIST_INDENT = 20;
const HEADING_SIZES = { 1: 18, 2: 14, 3: 12 } as const;
const TITLE_SIZE = 22;
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.45, 0.45, 0.45);

// Reemplazos legibles para lo que Helvetica (WinAnsi) no puede codificar.
const SYMBOL_FALLBACKS: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2212": "-",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2260": "!=",
  "\u2713": "v",
  "\u2714": "v",
  "\u25CF": "\u2022",
  "\u25AA": "\u2022",
  "\u2023": "\u2022",
  "\u2009": " ",
  "\u202F": " ",
  "\u2003": " ",
  "\u2002": " ",
  "\t": "    ",
  "\n": "\n"
};
// Ceros de ancho (ZWJ, selectores de variación, marcas de dirección) y controles.
const INVISIBLE = /[\u200B-\u200F\u2060\uFE00-\uFE0F\u0000-\u0008\u000B-\u001F\u007F]/g;

type PdfRun = { text: string; bold: boolean };
type PdfLine = { runs: (PdfRun & { width: number })[]; width: number };

class PdfLayout {
  private pages: PDFPage[] = [];
  private page!: PDFPage;
  y = 0;
  private readonly supported: Set<number>;

  constructor(
    readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont
  ) {
    this.supported = new Set(regular.getCharacterSet());
    this.newPage();
  }

  get atTop() {
    return this.y >= PAGE_HEIGHT - MARGIN - 0.5;
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Salta de página si no entran `height` puntos. */
  ensure(height: number) {
    if (this.y - height < BOTTOM && !this.atTop) this.newPage();
  }

  /** Deja el texto codificable en WinAnsi: lo que no entra se aproxima o pasa a "?". */
  safe(text: string): string {
    let out = "";
    for (const char of text.normalize("NFC").replace(INVISIBLE, "")) {
      const code = char.codePointAt(0)!;
      if (this.supported.has(code)) {
        out += char;
        continue;
      }
      const fallback = SYMBOL_FALLBACKS[char];
      if (fallback) {
        out += fallback;
        continue;
      }
      // Letras con diacríticos fuera de WinAnsi (ć, ł...): se queda la base.
      const base = char.normalize("NFD")[0]!;
      out += base !== char && this.supported.has(base.codePointAt(0)!) ? base : "?";
    }
    return out;
  }

  private width(text: string, bold: boolean, size: number) {
    return (bold ? this.bold : this.regular).widthOfTextAtSize(text, size);
  }

  /** Corta el texto en líneas que entran en `maxWidth`; respeta \n y parte palabras gigantes. */
  wrap(text: string, maxWidth: number, size: number, forceBold = false): PdfLine[] {
    const lines: PdfLine[] = [];
    for (const paragraph of this.safe(text).split("\n")) {
      let current: PdfLine = { runs: [], width: 0 };
      const flush = () => {
        // Los espacios del final no cuentan para el ancho.
        const last = current.runs[current.runs.length - 1];
        if (last?.text.trim() === "") {
          current.width -= last.width;
          current.runs.pop();
        }
        lines.push(current);
        current = { runs: [], width: 0 };
      };
      const push = (run: PdfRun, width: number) => {
        current.runs.push({ ...run, width });
        current.width += width;
      };

      for (const run of parseInline(paragraph)) {
        const bold = forceBold || run.bold;
        for (const token of run.text.split(/( +)/)) {
          if (!token) continue;
          const isSpace = token.startsWith(" ");
          const part = isSpace ? " " : token;
          const width = this.width(part, bold, size);
          if (isSpace) {
            if (current.runs.length) push({ text: part, bold }, width);
            continue;
          }
          if (current.width + width > maxWidth && current.runs.length) flush();
          if (width <= maxWidth) {
            push({ text: part, bold }, width);
            continue;
          }
          // Palabra más ancha que la línea (una URL, por ejemplo): se parte por caracteres.
          let chunk = "";
          for (const char of part) {
            if (chunk && this.width(chunk + char, bold, size) > maxWidth) {
              push({ text: chunk, bold }, this.width(chunk, bold, size));
              flush();
              chunk = "";
            }
            chunk += char;
          }
          if (chunk) push({ text: chunk, bold }, this.width(chunk, bold, size));
        }
      }
      flush();
    }
    return lines;
  }

  drawLine(line: PdfLine, x: number, y: number, size: number) {
    let cursor = x;
    for (const run of line.runs) {
      this.page.drawText(run.text, { x: cursor, y, size, font: run.bold ? this.bold : this.regular, color: BLACK });
      cursor += run.width;
    }
  }

  /** Dibuja un texto que puede ocupar varias páginas, línea por línea. */
  textBlock(text: string, size: number, opts: { x?: number; width?: number; bold?: boolean; marker?: string } = {}) {
    const x = opts.x ?? MARGIN;
    const lineHeight = size * 1.35;
    const lines = this.wrap(text, opts.width ?? CONTENT_WIDTH - (x - MARGIN), size, opts.bold);
    lines.forEach((line, index) => {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      if (index === 0 && opts.marker) {
        this.page.drawText(opts.marker, { x: x - LIST_INDENT, y: this.y + size * 0.2, size, font: this.regular, color: BLACK });
      }
      this.drawLine(line, x, this.y + size * 0.2, size);
    });
  }

  gap(points: number) {
    if (!this.atTop) this.y -= points;
  }

  table(headers: string[], rows: string[][]) {
    const columnWidth = CONTENT_WIDTH / headers.length;
    const innerWidth = columnWidth - CELL_PADDING * 2;
    const lineHeight = CELL_SIZE * 1.3;
    const cellLines = (cells: string[], bold: boolean, maxLines: number) =>
      headers.map((_, index) => {
        const lines = this.wrap(cells[index] ?? "", innerWidth, CELL_SIZE, bold);
        return lines.length > maxLines ? lines.slice(0, maxLines) : lines;
      });

    const headerLines = cellLines(headers, true, 6);
    const drawHeader = () => this.tableRow(headerLines, 0, Math.max(...headerLines.map((l) => l.length)), true, columnWidth, lineHeight);
    // El encabezado no se parte entre páginas: tiene que entrar junto con la primera fila.
    this.ensure(Math.max(...headerLines.map((l) => l.length)) * lineHeight + CELL_PADDING * 2 + lineHeight * 2);
    drawHeader();

    for (const row of rows) {
      const lines = cellLines(row, false, Number.POSITIVE_INFINITY);
      const total = Math.max(...lines.map((l) => l.length), 1);
      const capacity = Math.floor((PAGE_HEIGHT - MARGIN - BOTTOM - headerLines.length * lineHeight) / lineHeight) - 2;
      let start = 0;
      while (start < total) {
        let available = Math.floor((this.y - BOTTOM - CELL_PADDING * 2) / lineHeight);
        // Una fila que entra en una página nueva no se parte; solo las gigantes se cortan.
        if (start === 0 && available < total && total <= capacity && !this.atTop) available = 0;
        if (available < 1) {
          this.newPage();
          drawHeader();
          continue;
        }
        const count = Math.min(available, total - start);
        this.tableRow(lines, start, count, false, columnWidth, lineHeight);
        start += count;
      }
    }
    this.y -= 10;
  }

  private tableRow(lines: PdfLine[][], start: number, count: number, header: boolean, columnWidth: number, lineHeight: number) {
    const height = count * lineHeight + CELL_PADDING * 2;
    const top = this.y;
    if (header) {
      this.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: rgb(0.91, 0.91, 0.91) });
      this.page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + CONTENT_WIDTH, y: top }, thickness: 0.6, color: GRAY });
    }
    lines.forEach((cell, column) => {
      cell.slice(start, start + count).forEach((line, index) => {
        const baseline = top - CELL_PADDING - (index + 1) * lineHeight + CELL_SIZE * 0.3;
        this.drawLine(line, MARGIN + column * columnWidth + CELL_PADDING, baseline, CELL_SIZE);
      });
    });
    this.page.drawLine({ start: { x: MARGIN, y: top - height }, end: { x: MARGIN + CONTENT_WIDTH, y: top - height }, thickness: 0.4, color: GRAY });
    this.y = top - height;
  }

  addPageNumbers() {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const label = `Página ${index + 1} de ${total}`;
      const size = 9;
      page.drawText(label, {
        x: (PAGE_WIDTH - this.regular.widthOfTextAtSize(label, size)) / 2,
        y: 30,
        size,
        font: this.regular,
        color: GRAY
      });
    });
  }
}

async function renderPdf(spec: DocumentSpec, blocks: DocumentBlock[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const layout = new PdfLayout(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));
  pdf.setTitle(layout.safe(spec.title ?? spec.filename));

  if (spec.title) {
    layout.textBlock(spec.title, TITLE_SIZE, { bold: true });
    layout.gap(10);
  }

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const size = HEADING_SIZES[block.level];
        layout.gap(size * 0.6);
        // Un título no queda solo al pie: se lleva consigo las dos líneas siguientes.
        layout.ensure(size * 1.35 + BODY_SIZE * 2.7);
        layout.textBlock(block.text, size, { bold: true });
        layout.gap(4);
        break;
      }
      case "paragraph":
        layout.textBlock(block.text, BODY_SIZE);
        layout.gap(8);
        break;
      case "list":
        block.items.forEach((item, index) => {
          layout.textBlock(item, BODY_SIZE, {
            x: MARGIN + LIST_INDENT,
            marker: block.ordered ? `${index + 1}.` : "•"
          });
          layout.gap(3);
        });
        layout.gap(6);
        break;
      case "table":
        layout.gap(2);
        layout.table(block.headers.map((header) => header), block.rows);
        break;
      case "page_break":
        if (!layout.atTop) layout.newPage();
        break;
    }
  }

  layout.addPageNumbers();
  return pdf.save();
}

// ---------------------------------------------------------------- XLSX

const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;

function sheetNames(sheets: SheetSpec[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet) => {
    const base = sheet.name.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim() || "Hoja";
    let name = base.slice(0, 31);
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

async function renderXlsx(sheets: SheetSpec[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const names = sheetNames(sheets);

  sheets.forEach((sheet, index) => {
    const worksheet = workbook.addWorksheet(names[index]);
    const columns = Math.max(sheet.headers.length, ...sheet.rows.map((row) => row.length), 1);
    const widths = Array<number>(columns).fill(MIN_COLUMN_WIDTH);
    const fit = (column: number, text: string) => {
      const longest = Math.max(...text.split("\n").map((line) => line.length));
      widths[column] = Math.min(MAX_COLUMN_WIDTH, Math.max(widths[column]!, longest + 2));
    };

    if (sheet.headers.length) {
      const header = worksheet.addRow(sheet.headers);
      header.font = { bold: true };
      header.alignment = { vertical: "middle" };
      header.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E7E7" } };
        cell.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
      });
      sheet.headers.forEach((text, column) => fit(column, text));
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.headers.length } };
    }

    for (const row of sheet.rows) {
      const values = row.map((value) => (typeof value === "boolean" ? (value ? "Sí" : "No") : value));
      worksheet.addRow(values);
      values.forEach((value, column) => {
        if (value !== null) fit(column, String(value));
      });
    }
    widths.forEach((width, column) => (worksheet.getColumn(column + 1).width = width));
  });

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
