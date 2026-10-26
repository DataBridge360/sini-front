// Derivaciones puras del dashboard: saludo, agrupación del trabajo propio y la
// frase de resumen. Sin React ni fetch, para poder probarlas en node.

import type { Task } from "@/lib/api";
import { buildTaskAlerts, daysUntilDate, taskAlertLabel, type TaskAlert } from "@/lib/task-alerts";

export type WorkGroupKey = "overdue" | "today" | "tomorrow" | "review" | "later";

export type WorkItem = {
  task: Task;
  // Días hasta el vencimiento (negativo si ya venció); null sin fecha.
  daysUntilDue: number | null;
  // Texto de vencimiento a mostrar en la fila; null cuando el título del grupo
  // ya lo dice ("Hoy", "Mañana").
  dueText: string | null;
};

export type WorkGroup = { key: WorkGroupKey; title: string; items: WorkItem[] };

const GROUP_TITLES: Record<WorkGroupKey, string> = {
  overdue: "Vencidas",
  today: "Para hoy",
  tomorrow: "Para mañana",
  review: "Esperan tu aprobación",
  later: "Más adelante"
};

const GROUP_ORDER: WorkGroupKey[] = ["overdue", "today", "tomorrow", "review", "later"];

const PRIORITY_RANK: Record<Task["priority"], number> = { alta: 0, media: 1, baja: 2 };

export function firstNameOf(fullName: string) {
  return (fullName || "").trim().split(/\s+/)[0] || "equipo";
}

// Buen día hasta el mediodía, tardes hasta las 20, noches el resto (y la madrugada).
export function greetingForHour(hour: number) {
  if (hour >= 6 && hour < 13) return "Buen día";
  if (hour >= 13 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function byDueThenPriority(a: WorkItem, b: WorkItem) {
  return (
    (a.daysUntilDue ?? Number.POSITIVE_INFINITY) - (b.daysUntilDue ?? Number.POSITIVE_INFINITY) ||
    PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
    a.task.title.localeCompare(b.task.title, "es")
  );
}

// Espejo de lo que cuenta `lib/task-alerts.ts` como "mía": asignada a mí, o
// creada por mí y sin nadie asignado.
function isMine(task: Task, currentUserId: string) {
  if (task.assigned_to_user_id) return task.assigned_to_user_id === currentUserId;
  return task.created_by_user_id === currentUserId;
}

function dueText(daysUntilDue: number | null) {
  if (daysUntilDue === null) return "Sin fecha";
  if (daysUntilDue < 0) return daysUntilDue === -1 ? "Venció ayer" : `Venció hace ${Math.abs(daysUntilDue)} días`;
  if (daysUntilDue === 0) return "Vence hoy";
  if (daysUntilDue === 1) return "Vence mañana";
  return `En ${daysUntilDue} días`;
}

// Las alertas ya resuelven vencidas / hoy / mañana / en revisión; lo que falta
// es el resto del trabajo propio (vence más adelante o no tiene fecha).
export function buildWorkGroups(
  tasks: Task[],
  { currentUserId, canModerate, now = new Date() }: { currentUserId: string; canModerate: boolean; now?: Date }
): WorkGroup[] {
  const buckets: Record<WorkGroupKey, WorkItem[]> = { overdue: [], today: [], tomorrow: [], review: [], later: [] };

  const fromAlert = (alert: TaskAlert): WorkItem => ({
    task: alert.task,
    daysUntilDue: alert.daysUntilDue,
    // Hoy y mañana ya están en el título del grupo; en revisión se muestra la
    // fecha solo si la tarea la tiene.
    dueText:
      alert.kind === "overdue"
        ? taskAlertLabel(alert)
        : alert.kind === "review" && alert.daysUntilDue !== null
          ? dueText(alert.daysUntilDue)
          : null
  });

  for (const alert of buildTaskAlerts(tasks, { currentUserId, canModerate, now })) {
    if (alert.kind === "overdue") buckets.overdue.push(fromAlert(alert));
    else if (alert.kind === "due_today") buckets.today.push(fromAlert(alert));
    else if (alert.kind === "due_tomorrow") buckets.tomorrow.push(fromAlert(alert));
    else if (alert.kind === "review") buckets.review.push(fromAlert(alert));
  }

  for (const task of tasks) {
    if (task.status === "finalizado" || task.status === "revision" || task.archived_at) continue;
    if (!isMine(task, currentUserId)) continue;
    const days = task.due_date ? daysUntilDate(task.due_date, now) : null;
    if (days !== null && days < 2) continue;
    buckets.later.push({ task, daysUntilDue: days, dueText: dueText(days) });
  }

  return GROUP_ORDER.map((key) => ({ key, title: GROUP_TITLES[key], items: buckets[key].sort(byDueThenPriority) })).filter(
    (group) => group.items.length > 0
  );
}

function count(groups: WorkGroup[], key: WorkGroupKey) {
  return groups.find((group) => group.key === key)?.items.length ?? 0;
}

function plural(amount: number, singular: string, many: string) {
  return `${amount} ${amount === 1 ? singular : many}`;
}

// Una línea con lo que hay para hoy, armada con el recuento real. Sin nada
// urgente, mira un poco más adelante antes de decir que no hay nada.
export function buildDaySummary(groups: WorkGroup[]) {
  const overdue = count(groups, "overdue");
  const today = count(groups, "today");
  const tomorrow = count(groups, "tomorrow");
  const review = count(groups, "review");
  const later = count(groups, "later");

  const parts: string[] = [];
  if (today > 0) parts.push(`${plural(today, "tarea", "tareas")} para hoy`);
  if (overdue > 0) {
    parts.push(today > 0 ? plural(overdue, "vencida", "vencidas") : `${plural(overdue, "tarea vencida", "tareas vencidas")}`);
  }
  if (review > 0) parts.push(`${plural(review, "tarea", "tareas")} esperando tu aprobación`);

  if (parts.length > 0) {
    const head = parts.slice(0, -1).join(", ");
    return `Tenés ${head ? `${head} y ${parts[parts.length - 1]}` : parts[0]}.`;
  }
  if (tomorrow > 0) return `Hoy no hay nada urgente. Mañana tenés ${plural(tomorrow, "tarea", "tareas")}.`;
  if (later > 0) return `Nada urgente por hoy. Tenés ${plural(later, "tarea", "tareas")} más adelante.`;
  return "Estás al día: no tenés tareas pendientes. ¡Buen momento para adelantar avisos!";
}
