import { describe, expect, it } from "vitest";
import {
  contentTypeFor,
  createNdjsonParser,
  formatUsageMonth,
  formatUsd,
  usagePercent,
  uploadContentType,
  validateGestiFile
} from "@/lib/gesti-api";
import { MAX_GESTI_FILE_BYTES, type GestiStreamEvent } from "@/lib/gesti-contract";

function collect() {
  const events: GestiStreamEvent[] = [];
  return { events, parser: createNdjsonParser((event) => events.push(event)) };
}

const line = (event: GestiStreamEvent) => JSON.stringify(event);

describe("createNdjsonParser", () => {
  it("emits one event per complete line", () => {
    const { events, parser } = collect();
    parser.write(`${line({ type: "text", delta: "Hola" })}\n${line({ type: "status", label: null })}\n`);
    expect(events).toEqual([
      { type: "text", delta: "Hola" },
      { type: "status", label: null }
    ]);
  });

  it("joins a line split across chunks, even in the middle of a token", () => {
    const { events, parser } = collect();
    const full = `${line({ type: "text", delta: "palabra completa" })}\n`;
    parser.write(full.slice(0, 15));
    expect(events).toEqual([]);
    parser.write(full.slice(15, 31));
    expect(events).toEqual([]);
    parser.write(full.slice(31));
    expect(events).toEqual([{ type: "text", delta: "palabra completa" }]);
  });

  it("handles several lines and a partial one in the same chunk", () => {
    const { events, parser } = collect();
    const second = `${line({ type: "title", title: "Cobranzas" })}\n`;
    parser.write(`${line({ type: "text", delta: "a" })}\n${second.slice(0, 10)}`);
    expect(events).toHaveLength(1);
    parser.write(second.slice(10));
    expect(events.map((event) => event.type)).toEqual(["text", "title"]);
  });

  it("processes a last line without a trailing newline on end", () => {
    const { events, parser } = collect();
    parser.write(line({ type: "error", message: "No pude responder" }));
    expect(events).toEqual([]);
    parser.end();
    expect(events).toEqual([{ type: "error", message: "No pude responder" }]);
  });

  it("skips blank and invalid lines without losing the next ones", () => {
    const { events, parser } = collect();
    parser.write(`\n{no es json\n${JSON.stringify({ type: "nope" })}\n${line({ type: "text", delta: "ok" })}\n`);
    parser.end();
    expect(events).toEqual([{ type: "text", delta: "ok" }]);
  });

  it("handles CRLF line endings", () => {
    const { events, parser } = collect();
    parser.write(`${line({ type: "text", delta: "x" })}\r\n`);
    expect(events).toEqual([{ type: "text", delta: "x" }]);
  });
});

describe("validateGestiFile", () => {
  it("accepts the supported types", () => {
    expect(validateGestiFile({ name: "poliza.pdf", type: "application/pdf", size: 1000 })).toBeNull();
    expect(validateGestiFile({ name: "foto.png", type: "image/png", size: 1000 })).toBeNull();
  });

  it("falls back to the extension when the browser gives no type", () => {
    expect(validateGestiFile({ name: "cartera.CSV", type: "", size: 1000 })).toBeNull();
    expect(contentTypeFor("cartera.CSV")).toBe("text/csv");
  });

  it("rejects unsupported types", () => {
    expect(validateGestiFile({ name: "app.exe", type: "application/x-msdownload", size: 10 })).toContain("app.exe");
    expect(validateGestiFile({ name: "video.mp4", type: "", size: 10 })).toContain("no se puede adjuntar");
  });

  it("rejects empty and oversized files", () => {
    expect(validateGestiFile({ name: "a.pdf", type: "application/pdf", size: 0 })).toContain("vacío");
    expect(validateGestiFile({ name: "a.pdf", type: "application/pdf", size: MAX_GESTI_FILE_BYTES + 1 })).toContain("30 MB");
    expect(validateGestiFile({ name: "a.pdf", type: "application/pdf", size: MAX_GESTI_FILE_BYTES })).toBeNull();
  });
});

describe("usage formatting", () => {
  it("formats dollars with two decimals", () => {
    expect(formatUsd(12.5)).toMatch(/12,50/);
    expect(formatUsd(0)).toMatch(/0,00/);
  });

  it("names the month in Spanish", () => {
    expect(formatUsageMonth("2026-10")).toBe("octubre de 2026");
    expect(formatUsageMonth("2026-01")).toBe("enero de 2026");
    expect(formatUsageMonth("nope")).toBe("nope");
  });

  it("clamps the spent percentage", () => {
    expect(usagePercent(25, 100)).toBe(25);
    expect(usagePercent(150, 100)).toBe(100);
    expect(usagePercent(-5, 100)).toBe(0);
    expect(usagePercent(10, 0)).toBe(0);
  });
});

describe("uploadContentType", () => {
  it("falls back to the extension when the browser reports a type Gesti does not take (Windows .csv)", () => {
    const file = { name: "cartera.csv", type: "application/vnd.ms-excel", size: 10 };
    expect(uploadContentType(file)).toBe("text/csv");
    expect(validateGestiFile(file)).toBeNull();
  });

  it("keeps an allowed browser type and still rejects unknown files", () => {
    expect(uploadContentType({ name: "poliza.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(validateGestiFile({ name: "virus.exe", type: "application/x-msdownload", size: 10 })).toMatch(/no se puede adjuntar/);
  });
});
