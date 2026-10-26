import type { TaskListItem } from "@/lib/api";

const MAX_BADGE_COUNT = 99;

// Contador del globo rojo: tope en "99+" para que nunca desborde la pastilla.
export function formatBadgeCount(count: number) {
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);
}

// Nombre accesible del botón: incluye cuántas alertas faltan leer.
export function bellAriaLabel(unreadCount: number) {
  return unreadCount > 0 ? `Notificaciones, ${unreadCount} sin leer` : "Notificaciones";
}

// Cliente y póliza de una tarea en una sola línea ("Ana Pérez · Póliza 123").
// Vacío si la tarea no está vinculada a nada.
export function taskAlertContext(task: TaskListItem) {
  const client = task.clients?.full_name ?? task.policies?.clients?.full_name ?? null;
  const policy = task.policies?.policy_number ? `Póliza ${task.policies.policy_number}` : null;
  return [client, policy].filter(Boolean).join(" · ");
}
