import { describe, expect, it } from "vitest";
import {
  UnsupportedDocumentError,
  detectDocumentKind,
  extractDocument
} from "@/server/modules/gesti/documents/extract";
import { renderDocument } from "@/server/modules/gesti/documents/render";
import { DOCUMENT_MIME, MAX_EXTRACTED_CHARS, type DocumentSpec } from "@/server/modules/gesti/documents/spec";

const encode = (text: string) => new TextEncoder().encode(text);

async function roundTrip(spec: DocumentSpec) {
  const file = await renderDocument(spec);
  return { file, extracted: await extractDocument(file.bytes, file.mime, file.filename) };
}

const blocksSpec = (format: "docx" | "pdf", blocks: NonNullable<DocumentSpec["blocks"]>): DocumentSpec => ({
  format,
  filename: "informe",
  blocks
});

describe("renderDocument + extractDocument", () => {
  it("docx: conserva títulos, negrita, listas y celdas de tabla", async () => {
    const { file, extracted } = await roundTrip({
      format: "docx",
      filename: "Informe de siniestros",
      title: "Informe mensual",
      blocks: [
        { type: "heading", text: "Resumen", level: 1 },
        { type: "paragraph", text: "La cobertura es **responsabilidad civil** vigente." },
        { type: "list", items: ["Primer punto", "Segundo punto"] },
        { type: "list", items: ["Paso uno", "Paso dos"], ordered: true },
        { type: "table", headers: ["Póliza", "Prima"], rows: [["A-100", "1500"], ["B-200", "2300"]] },
        { type: "page_break" },
        { type: "heading", text: "Anexo", level: 2 }
      ]
    });

    expect(file.mime).toBe(DOCUMENT_MIME.docx);
    expect(file.filename).toBe("Informe de siniestros.docx");
    expect(extracted.pages).toBeNull();
    for (const expected of [
      "Informe mensual",
      "Resumen",
      "responsabilidad civil",
      "Primer punto",
      "Segundo punto",
      "Paso dos",
      "Póliza",
      "A-100",
      "2300",
      "Anexo"
    ]) {
      expect(extracted.text).toContain(expected);
    }
    // El marcador de negrita no debe llegar al archivo.
    expect(extracted.text).not.toContain("**");
  });

  it("xlsx: una hoja por spec, con números y TSV", async () => {
    const { file, extracted } = await roundTrip({
      format: "xlsx",
      filename: "cartera",
      sheets: [
        {
          name: "Pólizas",
          headers: ["Cliente", "Prima", "Activa"],
          rows: [
            ["Ana", 1500.5, true],
            ["Luis", 2300, false],
            ["Sin dato", null, "texto"]
          ]
        },
        { name: "Pólizas", headers: ["Total"], rows: [[3800.5]] }
      ]
    });

    expect(file.filename).toBe("cartera.xlsx");
    expect(extracted.text).toContain("## Hoja: Pólizas");
    // El nombre repetido se vuelve único.
    expect(extracted.text).toContain("## Hoja: Pólizas (2)");
    expect(extracted.text).toContain("Cliente\tPrima\tActiva");
    expect(extracted.text).toContain("Ana\t1500.5\tSí");
    expect(extracted.text).toContain("Luis\t2300\tNo");
    expect(extracted.text).toContain("Sin dato\t\ttexto");
    expect(extracted.text).toContain("3800.5");
  });

  it("xlsx: nombres de hoja inválidos se corrigen", async () => {
    const { extracted } = await roundTrip({
      format: "xlsx",
      filename: "x",
      sheets: [{ name: "a/b:c*d?e[f]\\g", headers: ["H"], rows: [["v"]] }]
    });
    expect(extracted.text).toMatch(/^## Hoja: a b c d e f g\nH\nv$/);
  });

  it("pdf: conserva tildes y ñ, numera las páginas", async () => {
    const { file, extracted } = await roundTrip(
      blocksSpec("pdf", [
        { type: "heading", text: "Cobertura de accidentes", level: 1 },
        { type: "paragraph", text: "Señor asegurado: ¿cuál es su póliza? ¡Atención! Ü **Ñandú** áéíóú" },
        { type: "list", items: ["Primero", "Segundo"], ordered: true },
        { type: "table", headers: ["Año", "Número"], rows: [["2026", "A-1"]] }
      ])
    );

    expect(file.mime).toBe(DOCUMENT_MIME.pdf);
    expect(file.filename).toBe("informe.pdf");
    expect(extracted.pages).toBe(1);
    expect(extracted.text).toContain("--- Página 1 ---");
    expect(extracted.text).toContain("Página 1 de 1");
    expect(extracted.text).toContain("Cobertura de accidentes");
    expect(extracted.text).toContain("Señor asegurado: ¿cuál es su póliza? ¡Atención!");
    expect(extracted.text).toContain("Ñandú");
    expect(extracted.text).toContain("áéíóú");
    expect(extracted.text).toContain("Segundo");
    expect(extracted.text).toContain("2026");
  });

  it("pdf: un contenido largo ocupa varias páginas y repite el encabezado de la tabla", async () => {
    const paragraph = "Texto de relleno para forzar el salto de página en el documento generado. ".repeat(8);
    const { extracted } = await roundTrip(
      blocksSpec("pdf", [
        ...Array.from({ length: 30 }, () => ({ type: "paragraph" as const, text: paragraph })),
        {
          type: "table",
          headers: ["Columna uno", "Columna dos"],
          rows: Array.from({ length: 120 }, (_, i) => [`fila ${i}`, `valor ${i}`])
        }
      ])
    );

    expect(extracted.pages).toBeGreaterThan(2);
    expect(extracted.text).toContain(`Página 1 de ${extracted.pages}`);
    expect(extracted.text).toContain(`Página ${extracted.pages} de ${extracted.pages}`);
    expect(extracted.text).toContain("fila 119");
    // Encabezado en la primera página de tabla y al menos una repetición.
    expect(extracted.text.split("Columna uno").length - 1).toBeGreaterThan(1);
  });

  it("pdf: emojis, CJK y símbolos fuera de WinAnsi no tiran error", async () => {
    const { extracted } = await roundTrip(
      blocksSpec("pdf", [
        { type: "paragraph", text: "Listo 🚗💥 日本語 → ok ≥ 3 ✓ ćł\u200d fin" },
        { type: "table", headers: ["Estado 😀"], rows: [["✔ pagado"]] }
      ])
    );
    expect(extracted.text).toContain("Listo");
    expect(extracted.text).toContain("fin");
    expect(extracted.text).toContain("pagado");
  });

  it("pdf: una palabra más ancha que la línea se parte", async () => {
    const { extracted } = await roundTrip(blocksSpec("pdf", [{ type: "paragraph", text: `${"x".repeat(400)} fin` }]));
    expect(extracted.text.replace(/\s/g, "")).toContain("x".repeat(400));
  });

  it("sanea el nombre del archivo", async () => {
    const make = async (filename: string, format: DocumentSpec["format"] = "docx") =>
      (
        await renderDocument(
          format === "xlsx"
            ? { format, filename, sheets: [{ name: "H", headers: ["a"], rows: [] }] }
            : { format, filename, blocks: [{ type: "paragraph", text: "x" }] }
        )
      ).filename;

    expect(await make("../../etc/pasw<d>:*?\"|x")).toBe("etc pasw d x.docx");
    expect(await make("a   b\t\nc")).toBe("a b c.docx");
    expect(await make("///", "pdf")).toBe("documento.pdf");
    expect(await make("...", "xlsx")).toBe("documento.xlsx");
    expect(await make("n".repeat(80))).toBe(`${"n".repeat(80)}.docx`);
  });

  it("rechaza specs inválidos", async () => {
    await expect(renderDocument({ format: "docx", filename: "x" } as DocumentSpec)).rejects.toThrow();
    await expect(renderDocument({ format: "xlsx", filename: "x", blocks: [] } as unknown as DocumentSpec)).rejects.toThrow();
    await expect(
      renderDocument({ format: "pdf", filename: "x", blocks: [{ type: "code", text: "x" }] } as unknown as DocumentSpec)
    ).rejects.toThrow();
  });
});

describe("extractDocument", () => {
  it("csv y txt: decodifica UTF-8 y quita el BOM", async () => {
    const csv = await extractDocument(encode("\ufeffnombre,edad\r\nMaría,30\r\n"), "text/csv", "datos.csv");
    expect(csv).toEqual({ text: "nombre,edad\nMaría,30", pages: null, truncated: false });

    const txt = await extractDocument(encode("\ufeffHola\n\n\n\n\nmundo   \n"), "text/plain", "nota.txt");
    expect(txt.text).toBe("Hola\n\nmundo");
  });

  it("detecta el tipo por extensión cuando el mime es genérico o vacío", async () => {
    expect(detectDocumentKind("application/octet-stream", "Reporte.PDF")).toBe("pdf");
    expect(detectDocumentKind("", "a.docx")).toBe("docx");
    expect(detectDocumentKind("application/vnd.ms-excel", "datos.csv")).toBe("csv");
    expect(detectDocumentKind("text/plain; charset=utf-8", "sin-extension")).toBe("txt");
    expect(detectDocumentKind("application/octet-stream", "foto.png")).toBeNull();
    expect(detectDocumentKind("", "sin-extension")).toBeNull();

    const extracted = await extractDocument(encode("hola;mundo"), "application/octet-stream", "datos.csv");
    expect(extracted.text).toBe("hola;mundo");

    const file = await renderDocument(blocksSpec("pdf", [{ type: "paragraph", text: "Contenido PDF" }]));
    const viaExtension = await extractDocument(file.bytes, "application/octet-stream", "doc.pdf");
    expect(viaExtension.pages).toBe(1);
    expect(viaExtension.text).toContain("Contenido PDF");
  });

  it("tipo no soportado: UnsupportedDocumentError con mensaje en español", async () => {
    const error = await extractDocument(new Uint8Array([1, 2, 3]), "image/png", "foto.png").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedDocumentError);
    expect((error as Error).message).toContain("No pude leer «foto.png»");
  });

  it.each([
    ["application/pdf", "roto.pdf"],
    [DOCUMENT_MIME.docx, "roto.docx"],
    [DOCUMENT_MIME.xlsx, "roto.xlsx"]
  ])("archivo corrupto (%s): UnsupportedDocumentError sin detalles internos", async (mime, name) => {
    const error = await extractDocument(encode("esto no es un archivo real"), mime, name).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedDocumentError);
    const message = (error as Error).message;
    expect(message).toContain(`No pude leer «${name}»`);
    expect(message).not.toMatch(/at |Error:|zip|pdf\.js|Invalid/i);
  });

  it("corta en MAX_EXTRACTED_CHARS y marca truncated", async () => {
    const big = await extractDocument(encode("a".repeat(MAX_EXTRACTED_CHARS + 500)), "text/plain", "grande.txt");
    expect(big.truncated).toBe(true);
    expect(big.text).toHaveLength(MAX_EXTRACTED_CHARS);

    const exact = await extractDocument(encode("a".repeat(MAX_EXTRACTED_CHARS)), "text/plain", "justo.txt");
    expect(exact.truncated).toBe(false);
  });
});
