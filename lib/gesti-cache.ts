// Caché del chat de Gesti en el navegador. Salir de la pestaña desmonta el
// chat: sin esto, volver pedía de nuevo la lista de chats y perdía el chat
// abierto, y cada cambio de chat volvía a bajar la conversación entera.
//
// La lista y los mensajes viven en el caché de React Query, separados por
// `scope` (usuario + organización). Cerrar sesión limpia ese caché; el chat
// abierto se recuerda aparte y solo es un id (el server valida que sea tuyo).

/** Lista de chats: se vuelve a pedir en segundo plano después de este tiempo. */
export const GESTI_LIST_STALE_MS = 5 * 60_000;
/** Mensajes de un chat: el propio chat los mantiene al día; esto cubre otros dispositivos. */
export const GESTI_CHAT_STALE_MS = 5 * 60_000;
/** Cuánto sobreviven en el caché sin la pestaña abierta. */
export const GESTI_CACHE_GC_MS = 30 * 60_000;

export function gestiCacheScope(userId: string, organizationSlug: string | undefined) {
  return `${userId}:${organizationSlug ?? "none"}`;
}

export const gestiQueryKeys = {
  all: (scope: string) => ["gesti", scope] as const,
  list: (scope: string) => ["gesti", scope, "conversations"] as const,
  chat: (scope: string, chatId: string) => ["gesti", scope, "conversation", chatId] as const
};

/** Si un dato cacheado a las `updatedAt` todavía sirve sin volver a pedirlo. */
export function isCacheFresh(updatedAt: number, now: number, staleMs: number) {
  return updatedAt > 0 && now - updatedAt < staleMs;
}

const openChats = new Map<string, string>();

/** Recuerda el chat abierto para mostrarlo al volver a la pestaña; null es "chat nuevo". */
export function rememberOpenChat(scope: string, chatId: string | null) {
  if (chatId) openChats.set(scope, chatId);
  else openChats.delete(scope);
}

export function recallOpenChat(scope: string): string | null {
  return openChats.get(scope) ?? null;
}
