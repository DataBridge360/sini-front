import { describe, expect, it } from "vitest";
import {
  INITIAL_REVEAL,
  blockRanges,
  embedRevealed,
  embedSlots,
  MAX_LAG_MS,
  WORD_MS,
  parseBlocks,
  isSafeSourceUrl,
  parseInline,
  sourceDomain,
  stepReveal,
  toPlainText,
  wordEnds
} from "@/lib/gesti-stream-text";

describe("wordEnds", () => {
  it("returns the end of every word", () => {
    const text = "Hola  que tal\nbien";
    expect(wordEnds(text, true).map((end) => text.slice(0, end).split(/\s+/).length)).toEqual([1, 2, 3, 4]);
    expect(wordEnds(text, true)).toEqual([4, 9, 13, 18]);
  });

  it("holds back the last word while the stream may still extend it", () => {
    expect(wordEnds("Hola que ta", false)).toEqual([4, 8]);
    expect(wordEnds("Hola que ta", true)).toEqual([4, 8, 11]);
  });

  it("counts the last word once whitespace follows it", () => {
    expect(wordEnds("Hola que ", false)).toEqual([4, 8]);
    expect(wordEnds("", false)).toEqual([]);
  });
});

describe("stepReveal", () => {
  it("shows one word per WORD_MS and keeps the leftover time", () => {
    const first = stepReveal(INITIAL_REVEAL, 6, WORD_MS * 2.5);
    expect(first).toEqual({ shown: 2, credit: WORD_MS * 0.5 });
    expect(stepReveal(first, 6, WORD_MS * 0.5)).toEqual({ shown: 3, credit: 0 });
  });

  it("catches up when it is further behind the stream than MAX_LAG_MS", () => {
    const backlog = Math.floor(MAX_LAG_MS / WORD_MS);
    const next = stepReveal(INITIAL_REVEAL, 500, 16);
    expect(500 - next.shown).toBe(backlog);
    // Desde ahí sigue a su ritmo normal.
    expect(stepReveal(next, 500, WORD_MS).shown).toBe(next.shown + 1);
  });

  it("does not exceed what was received and does not bank time once caught up", () => {
    const caughtUp = stepReveal({ shown: 4, credit: 10 }, 5, 10_000);
    expect(caughtUp).toEqual({ shown: 5, credit: 0 });
    // Llega más texto: no sale de golpe por el tiempo que pasó esperando.
    expect(stepReveal(caughtUp, 6, 16)).toEqual({ shown: 5, credit: 16 });
  });

  it("returns the same state when nothing changes", () => {
    const idle = { shown: 5, credit: 0 };
    expect(stepReveal(idle, 5, 16)).toBe(idle);
    expect(stepReveal(INITIAL_REVEAL, 0, 16)).toBe(INITIAL_REVEAL);
  });

  it("ignores negative time deltas", () => {
    expect(stepReveal({ shown: 1, credit: 5 }, 6, -100)).toEqual({ shown: 1, credit: 5 });
  });
});

describe("parseInline", () => {
  it("splits bold runs and citations", () => {
    expect(parseInline("Es **muy importante** según [[2]] y más")).toEqual([
      { kind: "text", text: "Es ", bold: false },
      { kind: "text", text: "muy importante", bold: true },
      { kind: "text", text: " según ", bold: false },
      { kind: "cite", n: 2 },
      { kind: "text", text: " y más", bold: false }
    ]);
  });

  it("keeps bold open to the end while an unclosed ** is still streaming", () => {
    expect(parseInline("Ojo con **la fran", false)).toEqual([
      { kind: "text", text: "Ojo con ", bold: false },
      { kind: "text", text: "la fran", bold: true }
    ]);
  });

  it("treats an unclosed ** as literal text once the reply is complete", () => {
    expect(parseInline("Ojo con **la franquicia")).toEqual([{ kind: "text", text: "Ojo con **la franquicia", bold: false }]);
  });

  it("leaves malformed citations as text", () => {
    expect(parseInline("ver [[x]] y [1]")).toEqual([{ kind: "text", text: "ver [[x]] y [1]", bold: false }]);
  });
});

describe("parseBlocks", () => {
  it("groups consecutive lines in a paragraph and splits paragraphs on blank lines", () => {
    const blocks = parseBlocks("Primera línea\nsegunda línea\n\nOtro párrafo");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
    expect(blocks[0]?.kind === "paragraph" && blocks[0].lines).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
  });

  it("reads • and - bullets as one list", () => {
    const blocks = parseBlocks("Pasos:\n• Uno\n- Dos **fuerte**\n* Tres");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "bullets"]);
    const list = blocks[1];
    expect(list?.kind === "bullets" && list.items).toHaveLength(3);
  });

  it("reads numbered lines and keeps the starting number", () => {
    const blocks = parseBlocks("1. Denunciar\n2) Juntar fotos\n\n3. Esperar");
    expect(blocks).toMatchObject([
      { kind: "numbered", start: 1 },
      { kind: "numbered", start: 3 }
    ]);
    expect(blocks[0]?.kind === "numbered" && blocks[0].items).toHaveLength(2);
  });

  it("does not take **bold** at the start of a line for a bullet", () => {
    expect(parseBlocks("**Ojo** con esto")).toMatchObject([{ kind: "paragraph" }]);
  });

  it("reads a closed :::borrador block between paragraphs", () => {
    const text = "Te dejo un borrador:\n:::borrador\nHola [Nombre],\nte escribo por tu póliza.\n:::\nCompletá los datos.";
    expect(parseBlocks(text)).toMatchObject([
      { kind: "paragraph" },
      { kind: "draft", body: "Hola [Nombre],\nte escribo por tu póliza.", complete: true },
      { kind: "paragraph" }
    ]);
  });

  it("keeps an unterminated :::borrador block open while streaming", () => {
    const blocks = parseBlocks("Borrador:\n\n:::borrador\nHola [Nombre], te recuerdo que", { complete: false });
    expect(blocks).toMatchObject([
      { kind: "paragraph" },
      { kind: "draft", body: "Hola [Nombre], te recuerdo que", complete: false }
    ]);
  });

  it("shows an empty open block right after the opening line", () => {
    expect(parseBlocks(":::borrador\n", { complete: false })).toEqual([{ kind: "draft", body: "", complete: false }]);
  });

  it("does not format markdown inside a draft", () => {
    const [block] = parseBlocks(":::borrador\n- gracias **ya**\n:::");
    expect(block).toEqual({ kind: "draft", body: "- gracias **ya**", complete: true });
  });

  it("returns nothing for empty text", () => {
    expect(parseBlocks("")).toEqual([]);
  });

  it("parses every prefix of a reply cut on word boundaries without throwing", () => {
    const reply =
      "Estos son los pasos:\n1. Denunciar **hoy** [[1]]\n2. Juntar fotos\n• Aparte\n\n:::borrador\nHola [Nombre]\n:::\nListo.";
    for (const end of wordEnds(reply, true)) {
      expect(() => parseBlocks(reply.slice(0, end), { complete: false })).not.toThrow();
    }
  });
});

describe("toPlainText", () => {
  it("drops citations, bold marks and draft delimiters", () => {
    const text = "Es **clave** [[1]].\n\n:::borrador\nHola [Nombre]\n:::\n\nChau";
    expect(toPlainText(text)).toBe("Es clave.\n\nHola [Nombre]\n\nChau");
  });
});

describe("sources", () => {
  it("shows the domain without www", () => {
    expect(sourceDomain("https://www.argentina.gob.ar/seguridad-vial?x=1")).toBe("argentina.gob.ar");
    expect(sourceDomain("no es una url")).toBe("no es una url");
  });

  it("only opens http(s) links", () => {
    expect(isSafeSourceUrl("https://www.argentina.gob.ar")).toBe(true);
    expect(isSafeSourceUrl("http://example.com/a")).toBe(true);
    expect(isSafeSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSourceUrl("data:text/html,hola")).toBe(false);
    expect(isSafeSourceUrl("nada")).toBe(false);
  });
});

describe("blockRanges", () => {
  it("returns where every block starts and ends in the original text", () => {
    const text = "Intro\n\n• a\n• b\n\nCierre";
    expect(blockRanges(text)).toEqual([
      { start: 0, end: 5 },
      { start: 7, end: 14 },
      { start: 16, end: 22 }
    ]);
    expect(blockRanges(text).map(({ start, end }) => text.slice(start, end))).toEqual(["Intro", "• a\n• b", "Cierre"]);
  });

  it("matches parseBlocks one to one, drafts included", () => {
    const text = "Antes\n\n:::borrador\nHola Ana\n\nSaludos\n:::\n\n1. uno\n2. dos\n\nDespués";
    const ranges = blockRanges(text);
    expect(ranges).toHaveLength(parseBlocks(text).length);
    expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toBe(":::borrador\nHola Ana\n\nSaludos\n:::");
  });

  it("takes an unclosed draft to the end of the text", () => {
    const text = "Antes\n\n:::borrador\nHola";
    expect(blockRanges(text)[1]).toEqual({ start: 7, end: text.length });
  });

  it("counts offsets in the original text when it has CRLF line breaks", () => {
    const text = "Uno\r\n\r\nDos";
    expect(blockRanges(text).map(({ start, end }) => text.slice(start, end))).toEqual(["Uno", "Dos"]);
  });

  it("ignores blank text", () => {
    expect(blockRanges("")).toEqual([]);
    expect(blockRanges("  \n\n ")).toEqual([]);
  });
});

describe("embedSlots", () => {
  const text = "Intro\n\n• a\n• b\n\nCierre";
  const ranges = blockRanges(text);

  it("puts the chart after the block that was being written, never inside it", () => {
    // 0: antes de todo · 5: justo al terminar "Intro" · 6 y 7: en el hueco · 8 y 14: dentro de la lista · 15 y 99: después.
    expect(embedSlots(ranges, [0, 5, 6, 7, 8, 14, 15, 17, 22, 99], text.length)).toEqual([0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it("clamps positions to the text, and sends old messages (no position) after the text", () => {
    expect(embedSlots(ranges, [undefined, -5, Number.NaN, 1_000_000], text.length)).toEqual([3, 0, 3, 3]);
  });

  it("keeps charts in the order they were shown", () => {
    const slots = embedSlots(ranges, [5, 5, 16], text.length);
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
  });

  it("handles a reply with no blocks", () => {
    expect(embedSlots([], [0, 10, undefined], 0)).toEqual([0, 0, 0]);
  });
});

describe("embedRevealed", () => {
  it("shows a chart once the revealed text reaches its position", () => {
    expect(embedRevealed(40, 100, 39, false)).toBe(false);
    expect(embedRevealed(40, 100, 40, false)).toBe(true);
    expect(embedRevealed(0, 100, 0, false)).toBe(true);
  });

  it("clamps the position to the text and shows everything once the text is complete", () => {
    expect(embedRevealed(500, 100, 99, false)).toBe(false);
    expect(embedRevealed(500, 100, 100, false)).toBe(true);
    expect(embedRevealed(500, 100, 20, true)).toBe(true);
  });

  it("shows charts without a position only when the text is complete", () => {
    expect(embedRevealed(undefined, 100, 100, false)).toBe(false);
    expect(embedRevealed(undefined, 100, 100, true)).toBe(true);
  });
});
