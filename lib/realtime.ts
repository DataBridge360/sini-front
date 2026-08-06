"use client";

// Tiempo real por organización. El backend sigue siendo la única fuente de
// datos: por el WebSocket viaja un aviso de "esto cambió" y el frontend le
// vuelve a pedir la información al backend, con el mismo JWT y la misma
// organización de siempre.
//
// Los avisos los emiten triggers de Postgres (ver la migración
// 20260803120000_realtime_org_broadcast.sql), no el backend, porque los avisos
// de cobranza cambian por RPC y no todos los caminos de escritura pasan por un
// endpoint.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { QueryKey } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

// Sin las variables de entorno el módulo queda inerte y la app funciona como
// antes (el detalle de tarea vuelve a su refresco periódico). Nada rompe.
export const isRealtimeConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const ORG_CHANGE_EVENT = "org_change";

// Colgado de globalThis y no de una variable del módulo: en desarrollo el
// recargado en caliente vuelve a evaluar el archivo, y con una variable suelta se
// crearía un cliente nuevo por cada recarga (además de la queja de Supabase por
// tener varias instancias abiertas contra el mismo almacenamiento).
const CLIENT_KEY = Symbol.for("sinipro2.realtime.client");
type ClientHolder = { [CLIENT_KEY]?: SupabaseClient };

// Cliente exclusivo para el WebSocket de Realtime: no maneja sesión (el login es
// del backend), no persiste nada y nunca se usa para consultar tablas, RPCs ni
// Storage. El token se empuja a mano con realtime.setAuth() desde el hook.
export function getRealtimeClient() {
  if (!isRealtimeConfigured) return null;

  const holder = globalThis as ClientHolder;
  if (!holder[CLIENT_KEY]) {
    holder[CLIENT_KEY] = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } }
    });
  }
  return holder[CLIENT_KEY];
}

export type OrgChangeEntity =
  | "task"
  | "task_message"
  | "task_attachment"
  | "policy_notice"
  | "notice_note";

export type OrgChangeEvent = {
  entity: OrgChangeEntity;
  entity_id: string;
  action: "insert" | "update" | "delete";
  organization_id: string;
  // Id de la fila padre: la tarea de un mensaje, la póliza de un aviso.
  parent_id?: string;
  // Quién originó el cambio. Solo viene en altas (ver la migración).
  actor_id?: string;
  // Qué columnas cambiaron, en los UPDATE.
  fields?: string[];
};

// Columnas que solo se ven dentro del detalle de la tarea. Sin esta distinción,
// el autoguardado de la descripción (cada 1200 ms mientras alguien escribe) haría
// recargar el tablero y los contadores a toda la organización.
const TASK_DETAIL_ONLY_FIELDS = new Set(["description"]);

// Las claves que este módulo puede llegar a invalidar. Se usa para acotar la
// puesta al día tras una reconexión: recargar solo esto en vez de todas las
// consultas de la app (que son una docena) mantiene el tráfico a raya.
export function realtimeQueryKeys(slug: string): QueryKey[] {
  return [
    ["tasks", slug],
    ["task-stats", slug],
    ["tasks-archived", slug],
    ["task", slug],
    ["notices", slug],
    ["policy-notices"]
  ];
}

export function queryKeysForEvent(event: OrgChangeEvent, slug: string): QueryKey[] {
  switch (event.entity) {
    case "task": {
      // Escribir la descripción no mueve el tablero de los demás.
      const detailOnly =
        event.action === "update" &&
        Array.isArray(event.fields) &&
        event.fields.length > 0 &&
        event.fields.every((field) => TASK_DETAIL_ONLY_FIELDS.has(field));

      const keys: QueryKey[] = [["task", slug, event.entity_id]];
      if (!detailOnly) {
        keys.push(["tasks", slug], ["task-stats", slug], ["tasks-archived", slug]);
      }
      return keys;
    }

    case "task_message":
    case "task_attachment": {
      // El tablero muestra la cantidad de mensajes y adjuntos de cada tarjeta,
      // así que también se refresca.
      const keys: QueryKey[] = [["tasks", slug]];
      if (event.parent_id) keys.push(["task", slug, event.parent_id]);
      return keys;
    }

    case "policy_notice":
      return [
        ["notices", slug],
        // El historial por póliza usa una clave sin slug (client-detail-screen).
        event.parent_id ? ["policy-notices", event.parent_id] : ["policy-notices"]
      ];

    case "notice_note":
      // Acá parent_id es el id del aviso, no el de la póliza: se invalida el
      // prefijo. Solo se recargan las consultas activas, así que si el historial
      // está cerrado no cuesta nada.
      return [["notices", slug], ["policy-notices"]];

    default:
      return [];
  }
}

// --- Estado del canal --------------------------------------------------------
// Lo lee el detalle de tarea para decidir si necesita su refresco periódico de
// respaldo. Mismo patrón de store externo que usa lib/browser.ts.

export type RealtimeStatus = "disabled" | "connected" | "disconnected";

let status: RealtimeStatus = "disabled";
const statusListeners = new Set<() => void>();

export function setRealtimeStatus(next: RealtimeStatus) {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener();
}

export function getRealtimeStatus() {
  return status;
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    (onChange) => {
      statusListeners.add(onChange);
      return () => {
        statusListeners.delete(onChange);
      };
    },
    () => status,
    () => "disabled" as const
  );
}

// --- Freno por interacción ---------------------------------------------------
// Mientras alguien está creando una tarea, arrastrando una tarjeta o escribiendo
// algo sin guardar, los avisos se siguen acumulando pero no se aplican: nadie
// pierde el hilo por un refresco que llegó en mal momento. Al soltar el freno se
// aplican todos juntos.

let deferCount = 0;
const deferListeners = new Set<() => void>();

export function isRealtimeDeferred() {
  return deferCount > 0;
}

function notifyDeferListeners() {
  for (const listener of deferListeners) listener();
}

// Lo usa el hook de sincronización para enterarse de cuándo se soltó el freno.
export function subscribeToDeferRelease(listener: () => void) {
  deferListeners.add(listener);
  return () => {
    deferListeners.delete(listener);
  };
}

export function useDeferRealtime(active: boolean) {
  useEffect(() => {
    if (!active) return;
    deferCount += 1;
    return () => {
      deferCount -= 1;
      if (deferCount === 0) notifyDeferListeners();
    };
  }, [active]);
}
