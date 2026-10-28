import { z } from "zod";
import {
  APP_SOURCES,
  chartSpecSchema,
  fileRefSchema,
  messagePartsSchema,
  questionSchema,
  webSourceSchema
} from "./gesti-parts";

// Contrato entre la API de Gesti (server/modules/gesti) y el chat. Las rutas
// viven bajo /api/v1/gesti; acá están las formas que viajan. Respuestas, JSON
// sin envoltorio:
//   GET   /gesti/conversations      -> GestiConversationSummary[]
//   GET   /gesti/conversations/:id  -> GestiConversation
//   PATCH /gesti/conversations/:id  -> GestiConversationSummary
//   POST  /gesti/files/uploads      -> GestiSignedUpload[]
//   POST  /gesti/files              -> GestiUploadedFile[]
//   GET   /gesti/files/:id/url      -> GestiFileUrl
//   GET   /gesti/usage              -> GestiUsageSummary
//   POST  /gesti/chat               -> NDJSON de GestiStreamEvent

export type GestiConversationSummary = {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export const storedMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  /** Texto visible. En las respuestas, `[[n]]` marca la cita de `parts.sources[n-1]`. */
  content: z.string(),
  parts: messagePartsSchema,
  createdAt: z.string()
});

export type StoredGestiMessage = z.infer<typeof storedMessageSchema>;

export type GestiConversation = GestiConversationSummary & { messages: StoredGestiMessage[] };

/** PATCH /gesti/conversations/:id — no hay DELETE: los chats no se borran. */
export type UpdateConversationPayload = { title?: string; pinned?: boolean };

/** POST /gesti/files/uploads */
export type SignGestiUploadsPayload = { files: Array<{ name: string; size: number; contentType: string }> };

export type GestiSignedUpload = {
  name: string;
  path: string;
  contentType: string;
  signedUrl: string;
  token: string;
};

/** POST /gesti/files: confirma lo subido; el server lo verifica y lo lee. */
export type ConfirmGestiUploadsPayload = { uploads: Array<{ path: string; name: string }> };

export type GestiUploadedFile = z.infer<typeof fileRefSchema> & { pages: number | null };

export type GestiFileUrl = { url: string };

/** POST /gesti/chat (respuesta: NDJSON con GestiStreamEvent, uno por línea). */
export type GestiChatPayload = {
  conversationId: string | null;
  message: string;
  fileIds: string[];
};

export const MAX_GESTI_MESSAGE_CHARS = 20000;
export const MAX_GESTI_FILES_PER_MESSAGE = 6;
export const MAX_GESTI_FILE_BYTES = 30 * 1024 * 1024;

/** Tipos que se pueden adjuntar (coincide con el bucket gesti-files). */
export const GESTI_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
] as const;

export const GESTI_UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif";

export const gestiStreamEventSchema = z.discriminatedUnion("type", [
  /** Primer evento: el chat (nuevo o existente) y el mensaje del usuario ya guardado. */
  z.object({ type: z.literal("meta"), conversationId: z.string(), userMessage: storedMessageSchema }),
  /** Título que puso Haiku al primer mensaje. */
  z.object({ type: z.literal("title"), title: z.string() }),
  /** Qué está haciendo ("Buscando en internet…"); null cuando vuelve a escribir. */
  z.object({ type: z.literal("status"), label: z.string().nullable() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  /** Lista completa de fuentes web hasta ahora (reemplaza la anterior). */
  z.object({ type: z.literal("sources"), sources: z.array(webSourceSchema) }),
  z.object({ type: z.literal("app_sources"), appSources: z.array(z.enum(APP_SOURCES)) }),
  z.object({ type: z.literal("chart"), chart: chartSpecSchema }),
  z.object({ type: z.literal("question"), question: questionSchema }),
  z.object({ type: z.literal("document"), file: fileRefSchema }),
  /** Último evento: la respuesta tal como quedó guardada. */
  z.object({ type: z.literal("done"), message: storedMessageSchema }),
  /** Falla antes de poder guardar una respuesta (p. ej. el chat no existe). */
  z.object({ type: z.literal("error"), message: z.string() })
]);

export type GestiStreamEvent = z.infer<typeof gestiStreamEventSchema>;

/** Una línea NDJSON → evento; null si la línea está vacía o no es un evento válido. */
export function parseStreamLine(line: string): GestiStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = gestiStreamEventSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** GET /gesti/usage (solo productor o admin de plataforma). */
export type GestiUsageSummary = {
  /** "2026-10": mes calendario en hora de Argentina. */
  month: string;
  budgetUsd: number;
  /** Gastado en el mes por toda la cuenta de la API (el tope es global). */
  spentUsd: number;
  remainingUsd: number;
  /** Gastado en el mes por esta organización. */
  organizationSpentUsd: number;
  users: Array<{ userId: string; fullName: string; email: string; spentUsd: number; requests: number }>;
};
