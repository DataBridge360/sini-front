import { describe, expect, it } from "vitest";
import {
  MAX_STORED_CHATS,
  deriveChatTitle,
  findMatch,
  formatMessageTime,
  groupChats,
  historyStorageKey,
  parseStoredChats,
  searchChats,
  serializeChats,
  type StoredChat
} from "@/lib/gesti-history";

function chat(overrides: Partial<StoredChat> & { id: string }): StoredChat {
  return {
    title: `Chat ${overrides.id}`,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    messages: [],
    ...overrides
  };
}

// Fechas locales: los grupos se calculan con el calendario del usuario.
const NOW = new Date(2026, 9, 27, 15, 30).getTime();
const at = (day: number, hour = 10, month = 9) => new Date(2026, month, day, hour).getTime();

describe("deriveChatTitle", () => {
  it("uses the first line of the first message, with collapsed spaces", () => {
    expect(deriveChatTitle("  ¿Qué pólizas   vencen\testa semana?\nGracias")).toBe("¿Qué pólizas vencen esta semana?");
  });

  it("cuts long titles on a word boundary with an ellipsis", () => {
    const title = deriveChatTitle(
      "Redactá un mensaje para pedir documentación de un siniestro de auto con lesionados"
    );
    expect(title).toBe("Redactá un mensaje para pedir documentación de…");
    expect(title.length).toBeLessThanOrEqual(48);
  });

  it("falls back to a generic title when there is no text", () => {
    expect(deriveChatTitle("   \n ")).toBe("Chat nuevo");
  });
});

describe("groupChats", () => {
  it("puts pinned chats first and the rest by calendar day, newest first", () => {
    const chats = [
      chat({ id: "older", updatedAt: at(2, 10, 7) }),
      chat({ id: "today-early", updatedAt: at(27, 8) }),
      chat({ id: "yesterday", updatedAt: at(26, 23) }),
      chat({ id: "pinned-old", updatedAt: at(1, 10, 5), pinned: true }),
      chat({ id: "week", updatedAt: at(22) }),
      chat({ id: "today-late", updatedAt: at(27, 14) }),
      chat({ id: "month", updatedAt: at(5) })
    ];

    const groups = groupChats(chats, NOW);

    expect(groups.map((group) => [group.key, group.label, group.chats.map((item) => item.id)])).toEqual([
      ["pinned", "Fijados", ["pinned-old"]],
      ["today", "Hoy", ["today-late", "today-early"]],
      ["yesterday", "Ayer", ["yesterday"]],
      ["week", "Últimos 7 días", ["week"]],
      ["month", "Últimos 30 días", ["month"]],
      ["older", "Anteriores", ["older"]]
    ]);
  });

  it("omits empty groups", () => {
    expect(groupChats([], NOW)).toEqual([]);
    expect(groupChats([chat({ id: "a", updatedAt: at(27) })], NOW).map((group) => group.key)).toEqual(["today"]);
  });
});

describe("searchChats", () => {
  const chats = [
    chat({
      id: "coverage",
      title: "Diferencia entre coberturas",
      updatedAt: at(20),
      messages: [
        { id: "m1", role: "user", text: "¿Qué diferencia hay entre terceros completo y todo riesgo?", attachments: [] },
        {
          id: "m2",
          role: "assistant",
          text: "Todo riesgo cubre además los daños propios por choque o vuelco, normalmente con una franquicia.",
          reasoning: false,
          sources: [],
          followUps: []
        }
      ]
    }),
    chat({ id: "renewal", title: "Recordatorio de vencimiento", updatedAt: at(25) })
  ];

  it("returns every chat for an empty query, newest first", () => {
    expect(searchChats(chats, "   ").map((result) => result.chat.id)).toEqual(["renewal", "coverage"]);
  });

  it("matches the title ignoring case and accents", () => {
    const results = searchChats(chats, "RECORDATORIO de VENCIMIENTO");
    expect(results.map((result) => result.chat.id)).toEqual(["renewal"]);
    expect(results[0]?.snippet).toBeNull();
  });

  it("matches the message text and returns a snippet around the match", () => {
    const results = searchChats(chats, "franquicia");
    expect(results.map((result) => result.chat.id)).toEqual(["coverage"]);
    expect(results[0]?.snippet).toContain("franquicia");
    expect(results[0]?.snippet?.startsWith("…")).toBe(true);
  });

  it("cuts the snippet on word boundaries", () => {
    const answer = chats[0]?.messages[1]?.text ?? "";
    const snippet = searchChats(chats, "franquicia")[0]?.snippet ?? "";
    const words = snippet.replace(/^…|…$/g, "").split(" ");
    expect(words.every((word) => answer.split(/\s+/).includes(word))).toBe(true);
  });

  it("matches accented text from an unaccented query", () => {
    expect(searchChats(chats, "polizas").length).toBe(0);
    expect(searchChats(chats, "danos propios").map((result) => result.chat.id)).toEqual(["coverage"]);
  });
});

describe("findMatch", () => {
  it("locates the query in the original text, ignoring case and accents", () => {
    const text = "Pólizas que VENCEN pronto";
    const match = findMatch(text, "polizas que vencen");
    expect(match).toEqual({ start: 0, end: 18 });
    expect(text.slice(match?.start, match?.end)).toBe("Pólizas que VENCEN");
  });

  it("returns null without a match or without a query", () => {
    expect(findMatch("Cobranzas del mes", "siniestro")).toBeNull();
    expect(findMatch("Cobranzas del mes", "  ")).toBeNull();
  });
});

describe("storage", () => {
  it("scopes the key to the user", () => {
    expect(historyStorageKey("user-1")).toBe("gesti.history.v1:user-1");
  });

  it("round-trips chats and drops image preview URLs", () => {
    const stored = [
      chat({
        id: "a",
        updatedAt: at(27),
        messages: [
          {
            id: "m1",
            role: "user",
            text: "Mirá esta foto",
            attachments: [{ id: "f1", name: "choque.jpg", size: 2048, previewUrl: "blob:local" }]
          }
        ]
      })
    ];

    const parsed = parseStoredChats(serializeChats(stored));

    expect(parsed).toEqual([
      {
        ...stored[0],
        messages: [
          {
            id: "m1",
            role: "user",
            text: "Mirá esta foto",
            attachments: [{ id: "f1", name: "choque.jpg", size: 2048, previewUrl: null }]
          }
        ]
      }
    ]);
  });

  it("stores only the known fields of live messages", () => {
    const live = {
      ...chat({ id: "a" }),
      messages: [
        { id: "m1", role: "user", text: "Hola", attachments: [], file: {} },
        {
          id: "m2",
          role: "assistant",
          text: "Hola, soy Gesti",
          reasoning: true,
          sources: ["policies"],
          followUps: [],
          ready: false,
          tokens: [{ text: "Hola" }]
        }
      ]
    } as unknown as StoredChat;

    const stored = JSON.parse(serializeChats([live])) as { chats: StoredChat[] };

    expect(stored.chats[0]?.messages).toEqual([
      { id: "m1", role: "user", text: "Hola", attachments: [] },
      { id: "m2", role: "assistant", text: "Hola, soy Gesti", reasoning: true, sources: ["policies"], followUps: [] }
    ]);
  });

  it("keeps the send time of assistant messages", () => {
    const sentAt = at(27, 14);
    const live = {
      ...chat({ id: "a" }),
      messages: [
        { id: "m1", role: "user", text: "Hola", attachments: [] },
        {
          id: "m2",
          role: "assistant",
          text: "Hola, soy Gesti",
          reasoning: false,
          sources: [],
          followUps: [],
          sentAt
        }
      ]
    } as unknown as StoredChat;

    const [parsed] = parseStoredChats(serializeChats([live]));

    expect(parsed?.messages[1]).toMatchObject({ role: "assistant", sentAt });
  });

  it("still parses stored messages saved without a send time", () => {
    const raw = JSON.stringify({
      version: 1,
      chats: [
        chat({
          id: "old",
          messages: [
            { id: "m1", role: "assistant", text: "Hola", reasoning: false, sources: [], followUps: [] }
          ]
        })
      ]
    });

    const [parsed] = parseStoredChats(raw);

    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]).not.toHaveProperty("sentAt");
  });

  it("keeps the draft block of assistant messages", () => {
    const draft = "Hola [Nombre], tu póliza [número] vence el [fecha].";
    const live = {
      ...chat({ id: "a" }),
      messages: [
        { id: "m1", role: "user", text: "Redactá un recordatorio", attachments: [] },
        {
          id: "m2",
          role: "assistant",
          text: `Te dejo un borrador:\n\n${draft}\n\nCompletá los datos.`,
          reasoning: false,
          sources: [],
          followUps: [],
          draft
        }
      ]
    } as unknown as StoredChat;

    const [parsed] = parseStoredChats(serializeChats([live]));

    expect(parsed?.messages[1]).toMatchObject({ role: "assistant", draft });
  });

  it("does not store a draft for replies without one", () => {
    const live = {
      ...chat({ id: "a" }),
      messages: [
        { id: "m1", role: "assistant", text: "Hola", reasoning: false, sources: [], followUps: [], draft: undefined }
      ]
    } as unknown as StoredChat;

    const [parsed] = parseStoredChats(serializeChats([live]));

    expect(parsed?.messages[0]).not.toHaveProperty("draft");
    expect(serializeChats([live])).not.toContain("draft");
  });

  it("still parses stored messages saved before drafts existed", () => {
    const raw = JSON.stringify({
      version: 1,
      chats: [
        chat({
          id: "old",
          messages: [
            { id: "m1", role: "assistant", text: "Te dejo un borrador", reasoning: false, sources: [], followUps: [] }
          ]
        })
      ]
    });

    const [parsed] = parseStoredChats(raw);

    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]).not.toHaveProperty("draft");
  });

  it("returns an empty history for missing or corrupt data", () => {
    expect(parseStoredChats(null)).toEqual([]);
    expect(parseStoredChats("{no es json")).toEqual([]);
    expect(parseStoredChats(JSON.stringify({ chats: "nope" }))).toEqual([]);
  });

  it("keeps the valid chats when some entries are broken", () => {
    const raw = JSON.stringify({
      version: 1,
      chats: [chat({ id: "ok", updatedAt: 5 }), { id: 3, title: null }]
    });
    expect(parseStoredChats(raw).map((item) => item.id)).toEqual(["ok"]);
  });

  it(`keeps at most ${MAX_STORED_CHATS} chats, dropping the oldest unpinned ones`, () => {
    const many = Array.from({ length: MAX_STORED_CHATS + 2 }, (_, index) =>
      chat({ id: `c${index}`, updatedAt: index + 10, pinned: index === 0 })
    );

    const kept = parseStoredChats(serializeChats(many)).map((item) => item.id);

    expect(kept).toHaveLength(MAX_STORED_CHATS);
    expect(kept).toContain("c0");
    expect(kept).not.toContain("c1");
    expect(kept).not.toContain("c2");
  });
});

describe("formatMessageTime", () => {
  it("formats the local time as HH:mm with zero padding", () => {
    expect(formatMessageTime(new Date(2026, 9, 27, 14, 51).getTime())).toBe("14:51");
    expect(formatMessageTime(new Date(2026, 9, 27, 9, 5).getTime())).toBe("09:05");
    expect(formatMessageTime(new Date(2026, 9, 27, 0, 0).getTime())).toBe("00:00");
  });
});
