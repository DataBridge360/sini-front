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

// Un tramo de la frase de resumen. `count` y `overdue` se resaltan (el segundo
// en rojo); el resto es texto corrido.
export type SummarySegment = { text: string; tone?: "count" | "overdue" };

const plain = (text: string): SummarySegment => ({ text });
const counted = (text: string): SummarySegment => ({ text, tone: "count" });
const overdueTone = (text: string): SummarySegment => ({ text, tone: "overdue" });

// Una línea con lo que hay para hoy, armada con el recuento real y partida en
// tramos para poder resaltar los números. Sin nada urgente, mira un poco más
// adelante antes de decir que no hay nada.
export function buildDaySegments(groups: WorkGroup[]): SummarySegment[] {
  const overdue = count(groups, "overdue");
  const today = count(groups, "today");
  const tomorrow = count(groups, "tomorrow");
  const review = count(groups, "review");
  const later = count(groups, "later");

  const parts: SummarySegment[][] = [];
  if (today > 0) parts.push([counted(plural(today, "tarea", "tareas")), plain(" para hoy")]);
  if (overdue > 0) {
    parts.push([overdueTone(today > 0 ? plural(overdue, "vencida", "vencidas") : plural(overdue, "tarea vencida", "tareas vencidas"))]);
  }
  if (review > 0) parts.push([counted(plural(review, "tarea", "tareas")), plain(" esperando tu aprobación")]);

  if (parts.length > 0) {
    const segments: SummarySegment[] = [plain("Tenés ")];
    parts.forEach((part, index) => {
      if (index > 0) segments.push(plain(index === parts.length - 1 ? " y " : ", "));
      segments.push(...part);
    });
    segments.push(plain("."));
    return segments;
  }
  if (tomorrow > 0) {
    return [plain("Hoy no hay nada urgente. Mañana tenés "), counted(plural(tomorrow, "tarea", "tareas")), plain(".")];
  }
  if (later > 0) {
    return [plain("Nada urgente por hoy. Tenés "), counted(plural(later, "tarea", "tareas")), plain(" más adelante.")];
  }
  return [plain("Estás al día: no tenés tareas pendientes. ¡Buen momento para adelantar avisos!")];
}

export function buildDaySummary(groups: WorkGroup[]) {
  return buildDaySegments(groups)
    .map((segment) => segment.text)
    .join("");
}

export type AgendaState = "overdue" | "today" | "tomorrow";

export type AgendaRow = { item: WorkItem; state: AgendaState; dueLabel: string };

const AGENDA_STATES: AgendaState[] = ["overdue", "today", "tomorrow"];

// "Para hoy": vencidas, luego hoy, luego mañana, en una sola lista. `total` es
// todo lo que hay; `rows` lo que entra en pantalla.
export function buildAgenda(groups: WorkGroup[], limit: number): { rows: AgendaRow[]; total: number } {
  const all: AgendaRow[] = [];
  for (const state of AGENDA_STATES) {
    const group = groups.find((candidate) => candidate.key === state);
    for (const item of group?.items ?? []) {
      all.push({
        item,
        state,
        dueLabel: state === "overdue" ? (item.dueText ?? "Vencida") : state === "today" ? "Hoy" : "Mañana"
      });
    }
  }
  return { rows: all.slice(0, limit), total: all.length };
}

export function clientNameOf(task: Task) {
  return task.clients?.full_name ?? task.policies?.clients?.full_name ?? null;
}

// "Cliente · póliza", lo que identifica la tarea sin abrirla.
export function taskContext(task: Task) {
  return [clientNameOf(task), task.policies?.policy_number].filter(Boolean).join(" · ");
}

export type Suggestion = { kind: "task"; taskId: string; label: string } | { kind: "gesti"; label: string };

// Hasta dos atajos sacados de los datos: arrancar por lo más urgente (abre esa
// tarea) y pedirle a Gesti un mensaje para el cliente de esa agenda.
export function buildSuggestions(groups: WorkGroup[]): Suggestion[] {
  const { rows } = buildAgenda(groups, Number.POSITIVE_INFINITY);
  const first = rows[0];
  if (!first) return [];

  const suggestions: Suggestion[] = [
    { kind: "task", taskId: first.item.task.id, label: `Empezá por “${first.item.task.title}”` }
  ];
  const client = rows.map((row) => clientNameOf(row.item.task)).find(Boolean);
  if (client) suggestions.push({ kind: "gesti", label: `Redactá un mensaje para ${client}` });
  return suggestions;
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// "Jue 29" para una fecha "YYYY-MM-DD".
export function shortDayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return `${WEEKDAYS[target.getDay()]} ${target.getDate()}`;
}

// Lo propio que vence dentro de la semana, después de mañana.
export function buildWeekList(groups: WorkGroup[], limit: number): WorkItem[] {
  const later = groups.find((group) => group.key === "later")?.items ?? [];
  return later.filter((item) => item.daysUntilDue !== null && item.daysUntilDue <= 7).slice(0, limit);
}
