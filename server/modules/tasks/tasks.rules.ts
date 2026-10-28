// Reglas de transición de estado de una tarea.
//
// Flujo: pendiente -> en_proceso -> revision -> finalizado ("archivada").
//
//   Desde \ Hacia | pendiente | en_proceso | revision | finalizado
//   pendiente     |     —     |   todos    |  todos   | solo productor
//   en_proceso    |   todos   |     —      |  todos   | solo productor
//   revision      | productor | productor  |    —     | solo productor
//   finalizado    | productor | productor  | productor|      —
//
// Un asesor NO puede sacar una tarea de 'revision', ni siquiera devolviéndola a
// 'pendiente': si pudiera, el gate de revisión sería decorativo (mando a
// revisión -> me arrepiento -> la saco -> la vuelvo a mandar cuando quiera). Si
// mandó algo por error, lo comenta en la Actividad y el productor la rechaza.
//
// Archivo puro y sin dependencias del servidor a propósito: la misma función se
// replica en frontend/lib/tasks.ts y se testea en tasks-rules.spec.ts.

import type { TaskStatus } from "./schemas";

export function canTransitionStatus(
  from: TaskStatus,
  to: TaskStatus,
  canModerate: boolean
): boolean {
  if (from === to) return false;
  if (canModerate) return true; // productor | platform_admin
  if (from === "revision" || from === "finalizado") return false; // sacar de revisión / desarchivar
  return to !== "finalizado"; // aprobar
}

// Mensaje concreto por caso: "no tenés permiso" no le dice al asesor qué pasó ni
// qué hacer al respecto.
export function transitionErrorMessage(from: TaskStatus, to: TaskStatus): string {
  if (to === "finalizado") {
    return "Solo un productor puede aprobar y archivar una tarea.";
  }
  if (from === "finalizado") {
    return "Solo un productor puede desarchivar una tarea.";
  }
  if (from === "revision") {
    return "La tarea está esperando aprobación: solo un productor puede sacarla de revisión.";
  }
  return "No tenés permiso para hacer este cambio de estado.";
}
