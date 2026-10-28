import { describe, expect, it } from "vitest";
import { createDemoBackend, pickReply, replyContent, splitDeltas } from "@/lib/gesti-demo";
import type { GestiStreamEvent } from "@/lib/gesti-contract";
import { parseBlocks } from "@/lib/gesti-stream-text";

describe("pickReply", () => {
  it("gives drafts priority over the topic they mention", () => {
    expect(pickReply("Redactá un mensaje para recordar una cuota de pago").followUps).toContain(
      "Escribí un mensaje de bienvenida para un cliente nuevo"
    );
    expect(replyContent(pickReply("Redactá un recordatorio de vencimiento"))).toContain(":::borrador");
  });

  it("answers procedural questions with generic content", () => {
    expect(pickReply("¿Qué diferencia hay entre terceros completo y todo riesgo?").text).toContain("Todo riesgo");
    expect(pickReply("¿Qué documentación necesito para denunciar un siniestro?").text).toContain("DNI");
  });

  it("explains instead of inventing data for portfolio questions", () => {
    expect(pickReply("¿Qué pólizas vencen esta semana?").text).toContain("Todavía no tengo acceso");
    expect(pickReply("¿Quiénes tienen cuotas pendientes?").text).toContain("te voy a inventar");
  });

  it("falls back for anything else", () => {
    expect(pickReply("hola").sources).toEqual([]);
  });
});

describe("replyContent", () => {
  it("turns the citation marker into the numbered form the server sends", () => {
    const content = replyContent(pickReply("¿Qué diferencia hay entre coberturas?"));
    expect(content).toContain("[[1]]");
    expect(content).not.toContain("[cite]");
  });

  it("puts the draft in a closed :::borrador block", () => {
    const blocks = parseBlocks(replyContent(pickReply("Redactá un mensaje de bienvenida")));
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "draft", "paragraph"]);
    expect(blocks[1]).toMatchObject({ complete: true });
  });
});

describe("splitDeltas", () => {
  it("splits into words that rebuild the exact text", () => {
    const text = "Hola  que tal\n• Uno\n:::borrador\nChau";
    const deltas = splitDeltas(text);
    expect(deltas.length).toBeGreaterThan(5);
    expect(deltas.join("")).toBe(text);
  });
});

describe("demo backend", () => {
  it("streams meta, text and a final stored message, and remembers the chat", async () => {
    const backend = createDemoBackend();
    const events: GestiStreamEvent[] = [];
    const controller = new AbortController();
    // Sin ventana, el temporizador de la demo no existe: se simula con el global de Node.
    (globalThis as { window?: unknown }).window = globalThis;
    try {
      await backend.sendMessage(
        { conversationId: null, message: "Hola, ¿qué podés hacer?", fileIds: [] },
        (event) => events.push(event),
        controller.signal
      );
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }

    expect(events[0]?.type).toBe("meta");
    expect(events.at(-1)?.type).toBe("done");
    const text = events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");
    const done = events.at(-1);
    expect(done?.type === "done" && done.message.content).toBe(text);

    const [chat] = await backend.listConversations();
    expect(chat?.title).toBe("Hola, ¿qué podés hacer?");
    const stored = await backend.getConversation(chat?.id ?? "");
    expect(stored.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(await backend.updateConversation(stored.id, { pinned: true })).toMatchObject({ pinned: true });
  });
});
