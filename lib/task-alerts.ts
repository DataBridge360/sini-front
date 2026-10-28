// Alertas de tareas: se calculan en el front a partir del listado de tareas que
// ya trae la app (no hay tabla de notificaciones). Las usan la campana del
// header y el dashboard. Qué está leído lo guarda cada navegador.

import type { TaskListItem } from "@/lib/api";

export type TaskAlertKind = "overdue" | "due_today" | "due_tomorrow" | "review" | "assigned";

export type TaskAlert = {
  // Cambia cuando cambia lo que se avisa (otro tipo u otra fecha), así una
  // tarea que pasa de "vence mañana" a "vence hoy" vuelve a aparecer sin leer.
  id: string;
  kind: TaskAlertKind;
  task: TaskListItem;
  // Días hasta el vencimiento (negativo si ya venció); null sin fecha.
  daysUntilDue: number | null;
};

// Cuánto tiempo una asignación hecha por otra persona cuenta como novedad.
const ASSIGNED_WINDOW_MS = 3 * 86_400_000;

const KIND_ORDER: Record<TaskAlertKind, number> = {
  overdue: 0,
  due_today: 1,
  due_tomorrow: 2,
  review: 3,
  assigned: 4
};

// Días de calendario entre hoy y una fecha "YYYY-MM-DD", en hora local: las
// fechas del backend son `date`, sin hora.
export function daysUntilDate(date: string, now: Date = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function isOpen(task: TaskListItem) {
  return task.status !== "finalizado" && !task.archived_at;
}

// Una tarea es "mía" si me la asignaron, o si la creé y todavía no tiene a nadie.
function isMine(task: TaskListItem, currentUserId: string) {
  if (task.assigned_to_user_id) return task.assigned_to_user_id === currentUserId;
  return task.created_by_user_id === currentUserId;
}

function dueKind(days: number): TaskAlertKind | null {
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days === 1) return "due_tomorrow";
  return null;
}

export function buildTaskAlerts(
  tasks: TaskListItem[],
  { currentUserId, canModerate, now = new Date() }: { currentUserId: string; canModerate: boolean; now?: Date }
): TaskAlert[] {
  const alerts: TaskAlert[] = [];

  for (const task of tasks) {
    if (!isOpen(task)) continue;
    const daysUntilDue = task.due_date ? daysUntilDate(task.due_date, now) : null;
    const mine = isMine(task, currentUserId);

    // En revisión la tarea ya no depende de quien la hace: el vencimiento se
    // avisa a quien la tiene en curso, la aprobación a quien modera.
    if (mine && task.status !== "revision" && daysUntilDue !== null) {
      const kind = dueKind(daysUntilDue);
      if (kind) alerts.push({ id: `${kind}:${task.id}:${task.due_date}`, kind, task, daysUntilDue });
    }

    if (canModerate && task.status === "revision") {
      alerts.push({ id: `review:${task.id}:${task.updated_at}`, kind: "review", task, daysUntilDue });
    }

    const assignedByOther =
      task.assigned_to_user_id === currentUserId && task.created_by_user_id !== currentUserId;
    if (assignedByOther && now.getTime() - new Date(task.created_at).getTime() <= ASSIGNED_WINDOW_MS) {
      alerts.push({ id: `assigned:${task.id}`, kind: "assigned", task, daysUntilDue });
    }
  }

  return alerts.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.daysUntilDue ?? Number.POSITIVE_INFINITY) - (b.daysUntilDue ?? Number.POSITIVE_INFINITY)
  );
}

export function countUnreadAlerts(alerts: TaskAlert[], readIds: ReadonlySet<string>) {
  return alerts.reduce((count, alert) => (readIds.has(alert.id) ? count : count + 1), 0);
}

// Texto corto para el estado de una alerta ("Venció hace 2 días", "Vence hoy").
export function taskAlertLabel(alert: TaskAlert) {
  const days = alert.daysUntilDue;
  switch (alert.kind) {
    case "overdue":
      return days === -1 ? "Venció ayer" : `Venció hace ${Math.abs(days ?? 0)} días`;
    case "due_today":
      return "Vence hoy";
    case "due_tomorrow":
      return "Vence mañana";
    case "review":
      return "Espera tu aprobación";
    case "assigned":
      return "Te la asignaron";
  }
}

// Leídas: un set de ids por usuario y organización en localStorage. Se poda a
// las alertas vigentes para que no crezca sin techo.
export function taskAlertsStorageKey(userId: string, organizationSlug: string) {
  return `sinipro2.task-alerts.read.${userId}.${organizationSlug}`;
}

export function readTaskAlertIds(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeTaskAlertIds(storageKey: string, ids: Iterable<string>, alerts: TaskAlert[]) {
  const current = new Set(alerts.map((alert) => alert.id));
  const kept = [...ids].filter((id) => current.has(id));
  window.localStorage.setItem(storageKey, JSON.stringify(kept));
}
