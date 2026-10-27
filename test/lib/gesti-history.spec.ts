import { describe, expect, it } from "vitest";
import {
  deriveChatTitle,
  findMatch,
  formatMessageTime,
  groupChats,
  searchChats,
  toHistoryChat,
  type HistoryChat
} from "@/lib/gesti-history";

function chat(overrides: Partial<HistoryChat> & { id: string }): HistoryChat {
  return {
    title: `Chat ${overrides.id}`,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    ...overrides
  };
}

// Fechas locales: los grupos se calculan con el calendario del usuario.
const NOW = new Date(2026, 9, 27, 15, 30).getTime();
const at = (day: number, hour = 10, month = 9) => new Date(2026, month, day, hour).getTime();

describe("toHistoryChat", () => {
  it("turns the ISO dates of a server chat into timestamps", () => {
    expect(
      toHistoryChat({
        id: "c1",
        title: "Cobranzas",
        pinned: true,
        createdAt: "2026-10-27T15:00:00.000Z",
        updatedAt: "2026-10-27T16:30:00.000Z"
      })
    ).toEqual({
      id: "c1",
      title: "Cobranzas",
      pinned: true,
      createdAt: Date.UTC(2026, 9, 27, 15),
      updatedAt: Date.UTC(2026, 9, 27, 16, 30)
    });
  });
});

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
        { text: "¿Qué diferencia hay entre terceros completo y todo riesgo?" },
        { text: "Todo riesgo cubre además los daños propios por choque o vuelco, normalmente con una franquicia." }
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
    const answer = chats[0]?.messages?.[1]?.text ?? "";
    const snippet = searchChats(chats, "franquicia")[0]?.snippet ?? "";
    const words = snippet.replace(/^…|…$/g, "").split(" ");
    expect(words.every((word) => answer.split(/\s+/).includes(word))).toBe(true);
  });

  it("searches only the title in chats whose messages are not loaded", () => {
    expect(searchChats([chat({ id: "x", title: "Sin mensajes", updatedAt: at(1) })], "franquicia")).toEqual([]);
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

describe("formatMessageTime", () => {
  it("formats the local time as HH:mm with zero padding", () => {
    expect(formatMessageTime(new Date(2026, 9, 27, 14, 51).getTime())).toBe("14:51");
    expect(formatMessageTime(new Date(2026, 9, 27, 9, 5).getTime())).toBe("09:05");
    expect(formatMessageTime(new Date(2026, 9, 27, 0, 0).getTime())).toBe("00:00");
  });
});
