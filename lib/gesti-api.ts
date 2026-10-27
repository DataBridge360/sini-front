import { apiRequest, refreshStoredAuth, uploadToSignedUrl, type ApiCommonOptions } from "@/lib/api";
import {
  GESTI_UPLOAD_MIME_TYPES,
  MAX_GESTI_FILE_BYTES,
  parseStreamLine,
  type ConfirmGestiUploadsPayload,
  type GestiChatPayload,
  type GestiConversation,
  type GestiConversationSummary,
  type GestiFileUrl,
  type GestiSignedUpload,
  type GestiStreamEvent,
  type GestiUploadedFile,
  type GestiUsageSummary,
  type SignGestiUploadsPayload,
  type UpdateConversationPayload
} from "@/lib/gesti-contract";

// Cliente de la API de Gesti (/api/v1/gesti/*) y la forma del "backend" que usa
// el chat: el CRM lo conecta a esta API y la demo pública a respuestas guionadas
// en memoria (lib/gesti-demo.ts). También están acá los helpers puros del chat
// que tocan el contrato: lector NDJSON, validación de adjuntos y formato del consumo.

// Mismo origen que lib/api.ts (que no lo exporta).
const API_URL = "/api/v1";

export class GestiStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GestiStreamError";
  }
}

export type GestiAuth = ApiCommonOptions;

export type GestiBackend = {
  listConversations(): Promise<GestiConversationSummary[]>;
  getConversation(id: string): Promise<GestiConversation>;
  updateConversation(id: string, payload: UpdateConversationPayload): Promise<GestiConversationSummary>;
  /** Sube los archivos y devuelve sus referencias, en el mismo orden. */
  uploadFiles(files: File[], onProgress?: (fraction: number) => void): Promise<GestiUploadedFile[]>;
  /** URL temporal para abrir o descargar un archivo; la demo no guarda archivos y no la tiene. */
  fileUrl?: (fileId: string) => Promise<string>;
  /** Envía un mensaje y entrega los eventos de la respuesta. Termina al cerrar el stream. */
  sendMessage(payload: GestiChatPayload, onEvent: (event: GestiStreamEvent) => void, signal: AbortSignal): Promise<void>;
  /** Solo para productor y admin de plataforma; sin esto el chat no ofrece "Consumo". */
  usage?: () => Promise<GestiUsageSummary>;
  /** Preguntas de seguimiento de una respuesta (solo la demo; las respuestas reales no las traen). */
  followUps?: (messageId: string) => string[];
};

// ---------- Stream NDJSON ----------

/**
 * Arma líneas NDJSON a partir de trozos de texto que pueden cortar una línea a
 * la mitad. `write` entrega cada evento apenas se completa su línea; `end`
 * procesa lo que haya quedado sin salto final.
 */
export function createNdjsonParser(onEvent: (event: GestiStreamEvent) => void) {
  let pending = "";
  const emit = (line: string) => {
    const event = parseStreamLine(line);
    if (event) onEvent(event);
  };
  return {
    write(chunk: string) {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        emit(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    },
    end() {
      const rest = pending;
      pending = "";
      emit(rest);
    }
  };
}

const CHAT_ERROR = "No pude responder ahora. Probá de nuevo en un momento.";

function chatRequest(payload: GestiChatPayload, auth: GestiAuth, signal: AbortSignal, token = auth.token) {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/x-ndjson" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (auth.organizationSlug) headers.set("X-Organization-Slug", auth.organizationSlug);
  return fetch(`${API_URL}/gesti/chat`, { method: "POST", headers, body: JSON.stringify(payload), signal });
}

/** POST /gesti/chat: lee el NDJSON de la respuesta y entrega cada evento. Reintenta una vez si el token venció. */
export async function streamGestiChat(
  payload: GestiChatPayload,
  getAuth: () => GestiAuth,
  onEvent: (event: GestiStreamEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const auth = getAuth();
  let response = await chatRequest(payload, auth, signal);
  if (response.status === 401 && auth.token) {
    const refreshed = await refreshStoredAuth();
    if (refreshed?.accessToken) response = await chatRequest(payload, auth, signal, refreshed.accessToken);
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message : CHAT_ERROR;
    throw new GestiStreamError(message);
  }

  const parser = createNdjsonParser(onEvent);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.write(decoder.decode(value, { stream: true }));
  }
  parser.write(decoder.decode());
  parser.end();
}

// ---------- Backend de la API ----------

export function createGestiApiBackend({
  getAuth,
  canSeeUsage
}: {
  /** Se lee en cada pedido: el token cambia cuando se renueva la sesión. */
  getAuth: () => GestiAuth;
  canSeeUsage: boolean;
}): GestiBackend {
  const request = <T>(path: string, options: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}) =>
    apiRequest<T>(`/gesti${path}`, { ...getAuth(), ...options });

  return {
    listConversations: () => request<GestiConversationSummary[]>("/conversations"),
    getConversation: (id) => request<GestiConversation>(`/conversations/${encodeURIComponent(id)}`),
    updateConversation: (id, payload) =>
      request<GestiConversationSummary>(`/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload
      }),

    async uploadFiles(files, onProgress) {
      if (files.length === 0) return [];
      const signBody: SignGestiUploadsPayload = {
        files: files.map((file) => ({ name: file.name, size: file.size, contentType: file.type || contentTypeFor(file.name) }))
      };
      const signed = await request<GestiSignedUpload[]>("/files/uploads", { method: "POST", body: signBody });
      const total = files.reduce((sum, file) => sum + file.size, 0) || 1;
      const loaded = files.map(() => 0);
      await Promise.all(
        files.map((file, index) => {
          const upload = signed[index];
          if (!upload) throw new Error(`No se pudo preparar la subida de «${file.name}»`);
          return uploadToSignedUrl(upload, file, (bytes) => {
            loaded[index] = bytes;
            onProgress?.(Math.min(1, loaded.reduce((sum, value) => sum + value, 0) / total));
          });
        })
      );
      const confirmBody: ConfirmGestiUploadsPayload = {
        uploads: signed.map((upload) => ({ path: upload.path, name: upload.name }))
      };
      return request<GestiUploadedFile[]>("/files", { method: "POST", body: confirmBody });
    },

    fileUrl: async (fileId) => (await request<GestiFileUrl>(`/files/${encodeURIComponent(fileId)}/url`)).url,

    sendMessage: (payload, onEvent, signal) => streamGestiChat(payload, getAuth, onEvent, signal),

    ...(canSeeUsage ? { usage: () => request<GestiUsageSummary>("/usage") } : {})
  };
}

// ---------- Adjuntos ----------

const EXTENSION_TYPES: Record<string, (typeof GESTI_UPLOAD_MIME_TYPES)[number]> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif"
};

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Tipo del archivo cuando el navegador no lo informa (pasa con .csv en algunos sistemas). */
export function contentTypeFor(name: string): string {
  return EXTENSION_TYPES[extensionOf(name)] ?? "application/octet-stream";
}

const isAllowedType = (type: string): boolean => (GESTI_UPLOAD_MIME_TYPES as readonly string[]).includes(type);

/** Por qué un archivo no se puede adjuntar; null si está bien. */
export function validateGestiFile(file: { name: string; type: string; size: number }): string | null {
  const type = file.type || contentTypeFor(file.name);
  if (!isAllowedType(type)) {
    return `«${file.name}» no se puede adjuntar: Gesti lee PDF, Word, Excel, CSV, texto e imágenes.`;
  }
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (file.size > MAX_GESTI_FILE_BYTES) {
    return `«${file.name}» pesa más de ${Math.round(MAX_GESTI_FILE_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

// ---------- Consumo ----------

const usdFormat = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD" });

export function formatUsd(value: number): string {
  return usdFormat.format(value);
}

/** "2026-10" → "octubre de 2026". */
export function formatUsageMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Porcentaje gastado del presupuesto, entre 0 y 100. */
export function usagePercent(spentUsd: number, budgetUsd: number): number {
  if (!(budgetUsd > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((spentUsd / budgetUsd) * 100)));
}
