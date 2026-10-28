import type { GestiConversationSummary } from "@/lib/gesti-contract";

// Historial de chats de Gesti. Los chats viven en el server (API de Gesti); acá
// está la lógica pura (títulos, grupos por fecha y búsqueda) que usa la UI de
// components/ui/gesti-history-panel.tsx.

const MAX_TITLE_LENGTH = 48;
const SNIPPET_RADIUS = 36;

/** Un chat de la lista. `messages` solo está en los chats cuyos mensajes ya se cargaron: la búsqueda por contenido llega hasta ahí. */
export type HistoryChat = {
  id: string;
  title: string;
  pinned: boolean;
  /** Milisegundos desde epoch. */
  createdAt: number;
  updatedAt: number;
  messages?: Array<{ text: string }> | undefined;
};

/** Un chat del server (fechas ISO) a la forma de la lista. */
export function toHistoryChat(summary: GestiConversationSummary): HistoryChat {
  return {
    id: summary.id,
    title: summary.title,
    pinned: summary.pinned,
    createdAt: Date.parse(summary.createdAt),
    updatedAt: Date.parse(summary.updatedAt)
  };
}

export function deriveChatTitle(text: string) {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const title = firstLine.replace(/\s+/g, " ").trim();
  if (!title) return "Chat nuevo";
  if (title.length <= MAX_TITLE_LENGTH) return title;
  const cut = title.slice(0, MAX_TITLE_LENGTH - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Hora local "HH:mm" de un mensaje, igual en servidor y cliente. */
export function formatMessageTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ---------- Grupos por fecha ----------

export type ChatGroupKey = "pinned" | "today" | "yesterday" | "week" | "month" | "older";

export type ChatGroup = { key: ChatGroupKey; label: string; chats: HistoryChat[] };

const GROUP_LABELS: Record<ChatGroupKey, string> = {
  pinned: "Fijados",
  today: "Hoy",
  yesterday: "Ayer",
  week: "Últimos 7 días",
  month: "Últimos 30 días",
  older: "Anteriores"
};

const GROUP_ORDER: ChatGroupKey[] = ["pinned", "today", "yesterday", "week", "month", "older"];

// Inicio del día local `daysAgo` días antes de `now` (setDate respeta los cambios de horario).
function startOfDay(now: number, daysAgo: number) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

function newestFirst(a: HistoryChat, b: HistoryChat) {
  return b.updatedAt - a.updatedAt;
}

export function groupChats(chats: HistoryChat[], now: number): ChatGroup[] {
  const today = startOfDay(now, 0);
  const yesterday = startOfDay(now, 1);
  const week = startOfDay(now, 6);
  const month = startOfDay(now, 29);

  const keyFor = (chat: HistoryChat): ChatGroupKey => {
    if (chat.pinned) return "pinned";
    if (chat.updatedAt >= today) return "today";
    if (chat.updatedAt >= yesterday) return "yesterday";
    if (chat.updatedAt >= week) return "week";
    if (chat.updatedAt >= month) return "month";
    return "older";
  };

  const buckets = new Map<ChatGroupKey, HistoryChat[]>();
  for (const chat of [...chats].sort(newestFirst)) {
    const key = keyFor(chat);
    buckets.set(key, [...(buckets.get(key) ?? []), chat]);
  }
  return GROUP_ORDER.flatMap((key) => {
    const items = buckets.get(key);
    return items ? [{ key, label: GROUP_LABELS[key], chats: items }] : [];
  });
}

// ---------- Búsqueda ----------

export type ChatSearchResult = {
  chat: HistoryChat;
  /** Fragmento del mensaje que coincide; null si coincide el título. */
  snippet: string | null;
};

// Minúsculas y sin tildes, con el índice original de cada carácter para poder
// recortar el fragmento sobre el texto tal como se escribió.
function fold(text: string) {
  let folded = "";
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const plain = (text[index] ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (const char of plain) {
      folded += char;
      origin.push(index);
    }
  }
  return { folded, origin };
}

function foldQuery(query: string) {
  return fold(query.replace(/\s+/g, " ").trim()).folded;
}

export type TextMatch = { start: number; end: number };

/** Primera coincidencia de `query` en `text`, en índices del texto original. */
export function findMatch(text: string, query: string): TextMatch | null {
  const needle = foldQuery(query);
  if (!needle) return null;
  const { folded, origin } = fold(text);
  const position = folded.indexOf(needle);
  if (position < 0) return null;
  const start = origin[position] ?? 0;
  return { start, end: (origin[position + needle.length - 1] ?? start) + 1 };
}

function snippetAround(text: string, query: string): string | null {
  const flat = text.replace(/\s+/g, " ");
  const match = findMatch(flat, query);
  if (!match) return null;
  // Los bordes se corren hasta un espacio para no cortar palabras a la mitad.
  let start = Math.max(0, match.start - SNIPPET_RADIUS);
  if (start > 0) {
    const space = flat.indexOf(" ", start - 1);
    start = space >= 0 && space < match.start ? space + 1 : match.start;
  }
  let end = Math.min(flat.length, match.end + SNIPPET_RADIUS);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    end = space >= match.end ? space : match.end;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

export function searchChats(chats: HistoryChat[], query: string): ChatSearchResult[] {
  const sorted = [...chats].sort(newestFirst);
  const needle = foldQuery(query);
  if (!needle) return sorted.map((chat) => ({ chat, snippet: null }));

  return sorted.flatMap((chat): ChatSearchResult[] => {
    if (fold(chat.title).folded.includes(needle)) return [{ chat, snippet: null }];
    for (const message of chat.messages ?? []) {
      const snippet = snippetAround(message.text, query);
      if (snippet) return [{ chat, snippet }];
    }
    return [];
  });
}
