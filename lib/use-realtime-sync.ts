"use client";

// Mantiene la app al día con lo que hacen los demás: escucha el canal privado de
// la organización y marca para recargar solo las consultas afectadas. Los datos
// se siguen pidiendo al backend; por el canal solo viaja el aviso de qué cambió.

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { refreshStoredAuth } from "@/lib/api";
import {
  getRealtimeClient,
  isRealtimeDeferred,
  ORG_CHANGE_EVENT,
  queryKeysForEvent,
  realtimeQueryKeys,
  setRealtimeStatus,
  subscribeToDeferRelease,
  type OrgChangeEvent
} from "@/lib/realtime";

// Agrupa las ráfagas: borrar una tarea con 40 mensajes dispara 41 avisos en una
// sola transacción y tiene que costar una recarga, no cuarenta.
const COALESCE_MS = 300;

// Volver a pedir todo tras una reconexión cuesta unas pocas requests. Con una
// red inestable que reconecta cada pocos segundos eso se multiplica, así que se
// hace como mucho una vez cada medio minuto.
const CATCH_UP_THROTTLE_MS = 30_000;

// Los navegadores de celular congelan el WebSocket al pasar la app a segundo
// plano y no siempre avisan que se cortó. Si estuvo oculta más que esto, se
// asume que se perdió algo y se vuelve a pedir.
const STALE_HIDDEN_MS = 5 * 60_000;

// El token de Supabase dura alrededor de una hora; se renueva un rato antes para
// que el canal no se caiga por vencimiento.
const TOKEN_REFRESH_MARGIN_MS = 120_000;

export function useRealtimeSync({
  organizationId,
  slug,
  accessToken,
  expiresAt,
  currentUserId
}: {
  organizationId: string | null;
  slug: string;
  accessToken: string | null;
  expiresAt: number | null | undefined;
  currentUserId: string | null;
}) {
  const queryClient = useQueryClient();

  // Referencias frescas: cambiar de organización o de usuario no tiene por qué
  // rearmar el canal.
  const slugRef = useRef(slug);
  const userRef = useRef(currentUserId);
  useEffect(() => {
    slugRef.current = slug;
    userRef.current = currentUserId;
  });

  const pendingRef = useRef(new Map<string, QueryKey>());
  const flushTimerRef = useRef<number | null>(null);
  const lastCatchUpRef = useRef(0);
  // Se marca cuando el canal se cae: al volver hay que recuperar lo perdido.
  const missedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const hiddenSinceRef = useRef<number | null>(null);

  const applyPending = useCallback(() => {
    const batch = [...pendingRef.current.values()];
    pendingRef.current.clear();
    for (const queryKey of batch) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      // Si hay una interacción en curso (un formulario abierto, una tarjeta
      // arrastrándose, texto sin guardar) los avisos quedan esperando. Al
      // soltarse el freno vuelve a agendarse este mismo flush.
      if (isRealtimeDeferred()) return;
      applyPending();
    }, COALESCE_MS);
  }, [applyPending]);

  const enqueue = useCallback(
    (keys: QueryKey[]) => {
      if (keys.length === 0) return;
      for (const key of keys) pendingRef.current.set(JSON.stringify(key), key);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  // Vuelve a pedir lo que cubre el tiempo real, no todas las consultas de la app.
  const catchUp = useCallback(() => {
    const now = Date.now();
    if (now - lastCatchUpRef.current < CATCH_UP_THROTTLE_MS) return;
    lastCatchUpRef.current = now;
    enqueue(realtimeQueryKeys(slugRef.current));
  }, [enqueue]);

  // Al soltarse el freno se aplica lo que quedó esperando.
  useEffect(() => subscribeToDeferRelease(scheduleFlush), [scheduleFlush]);

  // Renovación del token antes de que venza, para que el canal siga vivo.
  useEffect(() => {
    if (!expiresAt || !accessToken) return;
    const delay = Math.max(expiresAt * 1000 - Date.now() - TOKEN_REFRESH_MARGIN_MS, 5_000);
    const timer = window.setTimeout(() => void refreshStoredAuth(), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, accessToken]);

  // Canal. Depende del token a propósito: al renovarse se rearma con credenciales
  // frescas, y como eso cuenta como reconexión se vuelve a pedir lo que cubre el
  // canal (una vez por hora, acotado por el throttle).
  useEffect(() => {
    const client = getRealtimeClient();
    if (!client || !organizationId || !accessToken) {
      setRealtimeStatus("disabled");
      return;
    }

    const topic = `org:${organizationId}`;
    // En desarrollo React monta dos veces: si quedó un canal viejo con el mismo
    // topic se descarta antes de crear el nuevo.
    for (const existing of client.getChannels()) {
      if (existing.topic === `realtime:${topic}`) void client.removeChannel(existing);
    }

    let cancelled = false;
    const pending = pendingRef.current;
    const channel = client.channel(topic, { config: { private: true } });

    channel.on("broadcast", { event: ORG_CHANGE_EVENT }, ({ payload }) => {
      const event = payload as OrgChangeEvent;
      // El que hizo el cambio ya recargó lo suyo al mutar.
      if (event.actor_id && event.actor_id === userRef.current) return;
      enqueue(queryKeysForEvent(event, slugRef.current));
    });

    void (async () => {
      // El token que emite el backend al iniciar sesión es un JWT de Supabase
      // Auth, así que sirve tal cual para autorizar el canal privado.
      await client.realtime.setAuth(accessToken);
      if (cancelled) return;

      channel.subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          setRealtimeStatus("connected");
          // En la primera conexión no hay nada que recuperar: las consultas
          // acaban de cargarse.
          if (hasConnectedRef.current && missedRef.current) catchUp();
          hasConnectedRef.current = true;
          missedRef.current = false;
          return;
        }
        if (
          subscribeStatus === "CHANNEL_ERROR" ||
          subscribeStatus === "TIMED_OUT" ||
          subscribeStatus === "CLOSED"
        ) {
          missedRef.current = true;
          setRealtimeStatus("disconnected");
        }
      });
    })();

    return () => {
      cancelled = true;
      setRealtimeStatus("disabled");
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      pending.clear();
      void client.removeChannel(channel);
    };
  }, [organizationId, accessToken, enqueue, catchUp]);

  // Volver a la app. Si el canal siguió conectado no se hace nada: no se perdió
  // ningún aviso y no tiene sentido gastar requests. Solo se recupera si el canal
  // se cayó o si la app estuvo tanto tiempo en segundo plano que el WebSocket
  // pudo haberse congelado sin avisar.
  useEffect(() => {
    if (!organizationId || !accessToken) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        return;
      }

      const hiddenFor = hiddenSinceRef.current ? Date.now() - hiddenSinceRef.current : 0;
      hiddenSinceRef.current = null;
      if (missedRef.current || hiddenFor > STALE_HIDDEN_MS) catchUp();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [organizationId, accessToken, catchUp]);
}
