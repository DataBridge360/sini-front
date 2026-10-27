import { z } from "zod";

// Historial de chats de Gesti. Por ahora es solo frontend: los chats viven en
// localStorage, separados por usuario. Acá está la lógica pura (títulos,
// grupos por fecha, búsqueda y formato guardado); la UI está en
// components/ui/gesti-history-panel.tsx.

export const MAX_STORED_CHATS = 50;
const MAX_TITLE_LENGTH = 48;
const SNIPPET_RADIUS = 36;
const STORAGE_VERSION = 1;

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  /** URL local (blob:) de una imagen; no sobrevive a la recarga y no se guarda. */
  previewUrl: z.string().nullable()
});

const messageSchema = z.discriminatedUnion("role", [
  z.object({
    id: z.string(),
    role: z.literal("user"),
    text: z.string(),
    attachments: z.array(attachmentSchema)
  }),
  z.object({
    id: z.string(),
    role: z.literal("assistant"),
    text: z.string(),
    reasoning: z.boolean(),
    sources: z.array(z.string()),
    followUps: z.array(z.string()),
    /** Hora en que respondió Gesti; los chats guardados antes no la tienen. */
    sentAt: z.number().optional(),
    /** Cuerpo del borrador de la respuesta (el bloque copiable); ausente si no lo tiene. */
    draft: z.string().optional()
  })
]);

const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pinned: z.boolean(),
  messages: z.array(messageSchema)
});

export type StoredAttachment = z.infer<typeof attachmentSchema>;
export type StoredMessage = z.infer<typeof messageSchema>;
export type StoredChat = z.infer<typeof chatSchema>;

export function historyStorageKey(userKey: string) {
  return `gesti.history.v${STORAGE_VERSION}:${userKey}`;
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

export type ChatGroup = { key: ChatGroupKey; label: string; chats: StoredChat[] };

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

function newestFirst(a: StoredChat, b: StoredChat) {
  return b.updatedAt - a.updatedAt;
}

export function groupChats(chats: StoredChat[], now: number): ChatGroup[] {
  const today = startOfDay(now, 0);
  const yesterday = startOfDay(now, 1);
  const week = startOfDay(now, 6);
  const month = startOfDay(now, 29);

  const keyFor = (chat: StoredChat): ChatGroupKey => {
    if (chat.pinned) return "pinned";
    if (chat.updatedAt >= today) return "today";
    if (chat.updatedAt >= yesterday) return "yesterday";
    if (chat.updatedAt >= week) return "week";
    if (chat.updatedAt >= month) return "month";
    return "older";
  };

  const buckets = new Map<ChatGroupKey, StoredChat[]>();
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
  chat: StoredChat;
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

export function searchChats(chats: StoredChat[], query: string): ChatSearchResult[] {
  const sorted = [...chats].sort(newestFirst);
  const needle = foldQuery(query);
  if (!needle) return sorted.map((chat) => ({ chat, snippet: null }));

  return sorted.flatMap((chat): ChatSearchResult[] => {
    if (fold(chat.title).folded.includes(needle)) return [{ chat, snippet: null }];
    for (const message of chat.messages) {
      const snippet = snippetAround(message.text, query);
      if (snippet) return [{ chat, snippet }];
    }
    return [];
  });
}

// ---------- Persistencia ----------

// Los fijados nunca se descartan; del resto quedan los más recientes.
function prune(chats: StoredChat[]) {
  if (chats.length <= MAX_STORED_CHATS) return chats;
  const pinned = chats.filter((chat) => chat.pinned).length;
  const room = Math.max(0, MAX_STORED_CHATS - pinned);
  const keep = new Set(
    chats
      .filter((chat) => !chat.pinned)
      .sort(newestFirst)
      .slice(0, room)
      .map((chat) => chat.id)
  );
  return chats.filter((chat) => chat.pinned || keep.has(chat.id));
}

// Campo por campo: los mensajes vivos traen además el `File`, los tokens y el
// estado de la animación, que no se guardan.
function storedMessage(message: StoredMessage): StoredMessage {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      text: message.text,
      attachments: message.attachments.map(({ id, name, size }) => ({ id, name, size, previewUrl: null }))
    };
  }
  const { id, text, reasoning, sources, followUps, sentAt, draft } = message;
  return {
    id,
    role: "assistant",
    text,
    reasoning,
    sources,
    followUps,
    ...(sentAt === undefined ? {} : { sentAt }),
    ...(draft === undefined ? {} : { draft })
  };
}

export function serializeChats(chats: StoredChat[]) {
  const stored = prune(chats).map(({ id, title, createdAt, updatedAt, pinned, messages }) => ({
    id,
    title,
    createdAt,
    updatedAt,
    pinned,
    messages: messages.map(storedMessage)
  }));
  return JSON.stringify({ version: STORAGE_VERSION, chats: stored });
}

export function parseStoredChats(raw: string | null): StoredChat[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const entries = (data as { chats?: unknown } | null)?.chats;
  if (!Array.isArray(entries)) return [];
  // Un chat roto no se lleva puesto al resto del historial.
  const chats = entries.flatMap((entry) => {
    const parsed = chatSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return prune(chats);
}
