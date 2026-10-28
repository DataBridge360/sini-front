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

export function clientNameOf(task: Task) {
  return task.clients?.full_name ?? task.policies?.clients?.full_name ?? null;
}

// "Cliente · póliza", lo que identifica la tarea sin abrirla.
export function taskContext(task: Task) {
  return [clientNameOf(task), task.policies?.policy_number].filter(Boolean).join(" · ");
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// "Jue 29" para una fecha "YYYY-MM-DD".
export function shortDayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return `${WEEKDAYS[target.getDay()]} ${target.getDate()}`;
}

// Lo propio que vence después de mañana, lo más cercano primero. Las tareas
// sin fecha quedan afuera: no son "próximas".
export function buildUpcomingList(groups: WorkGroup[], limit: number): WorkItem[] {
  const later = groups.find((group) => group.key === "later")?.items ?? [];
  return later
    .filter((item) => item.daysUntilDue !== null)
    .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))
    .slice(0, limit);
}

export type FeedState = "overdue" | "today" | "tomorrow" | "upcoming" | "review";

export type FeedRow = {
  task: Task;
  state: FeedState;
  // Lo que se lee a la derecha, como un monto: "Hace 2 días", "Hoy", "Jue 29".
  dueLabel: string;
  statusLabel: string;
};

export type FeedSection = { state: FeedState; title: string; rows: FeedRow[] };

const FEED_TITLES: Record<FeedState, string> = {
  overdue: "Vencidas",
  today: "Hoy",
  tomorrow: "Mañana",
  upcoming: "Próximas",
  review: "Esperan tu aprobación"
};

// Del grupo de trabajo al tramo del listado; "later" son las próximas.
const FEED_ORDER: [WorkGroupKey, FeedState][] = [
  ["overdue", "overdue"],
  ["today", "today"],
  ["tomorrow", "tomorrow"],
  ["later", "upcoming"],
  ["review", "review"]
];

const STATUS_LABELS: Partial<Record<Task["status"], string>> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  revision: "En revisión"
};

export function taskStatusLabel(status: Task["status"]) {
  return STATUS_LABELS[status] ?? "Pendiente";
}

function feedDueLabel(item: WorkItem) {
  const days = item.daysUntilDue;
  const date = item.task.due_date;
  if (days === null || !date) return null;
  if (days < 0) return days === -1 ? "Ayer" : `Hace ${Math.abs(days)} días`;
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  return shortDayLabel(date);
}

// El listado del inicio, como los movimientos de una billetera: tramos por
// fecha (vencidas, hoy, mañana, próximas y, para quien modera, lo que espera
// aprobación) con hasta `limit` filas entre todos. Lo que no tiene fecha no
// entra: vive en Tareas. `total` es todo lo que cabría; `shown`, lo listado.
export function buildTaskFeed(
  groups: WorkGroup[],
  limit: number
): { sections: FeedSection[]; shown: number; total: number } {
  const sections: FeedSection[] = [];
  let total = 0;
  let room = limit;

  for (const [groupKey, state] of FEED_ORDER) {
    const items =
      state === "upcoming"
        ? buildUpcomingList(groups, Number.POSITIVE_INFINITY)
        : (groups.find((group) => group.key === groupKey)?.items ?? []);
    total += items.length;
    if (room <= 0 || items.length === 0) continue;

    const rows = items.slice(0, room).map((item): FeedRow => ({
      task: item.task,
      state,
      dueLabel: feedDueLabel(item) ?? "Por aprobar",
      statusLabel: taskStatusLabel(item.task.status)
    }));
    room -= rows.length;
    sections.push({ state, title: FEED_TITLES[state], rows });
  }

  return { sections, shown: limit - Math.max(room, 0), total };
}

export type HeroChip = { tone: "overdue" | "tomorrow" | "calm"; text: string };

export type HeroSummary = {
  // Lo que hay que atender hoy: vencidas + las de hoy.
  count: number;
  label: string;
  // Las pastillas de la tarjeta y la misma información en una frase.
  detail: string;
  chips: HeroChip[];
};

// El "saldo" de la tarjeta principal: cuántas tareas piden atención hoy y, en
// pastillas, lo vencido y lo de mañana (sin las partes en cero).
export function buildHeroSummary(groups: WorkGroup[]): HeroSummary {
  const overdue = count(groups, "overdue");
  const today = count(groups, "today");
  const tomorrow = count(groups, "tomorrow");
  const total = overdue + today;

  const chips: HeroChip[] = [];
  if (total === 0) chips.push({ tone: "calm", text: "Estás al día" });
  if (overdue > 0) chips.push({ tone: "overdue", text: plural(overdue, "vencida", "vencidas") });
  if (tomorrow > 0) chips.push({ tone: "tomorrow", text: `${tomorrow} para mañana` });
  if (chips.length === 0) chips.push({ tone: "calm", text: "Nada vencido" });

  return {
    count: total,
    label: total === 1 ? "tarea para hoy" : "tareas para hoy",
    detail: chips.map((chip) => chip.text).join(" · "),
    chips
  };
}

export type HeroPose = "think" | "review" | "celebrate" | "wave";

// Qué pose de Gesti acompaña la tarjeta principal: pensando mientras carga,
// revisando si hay algo vencido, festejando si no queda nada para hoy y
// saludando el resto de los días.
export function heroPose({
  isLoading,
  overdue,
  today
}: {
  isLoading: boolean;
  overdue: number;
  today: number;
}): HeroPose {
  if (isLoading) return "think";
  if (overdue > 0) return "review";
  if (today === 0) return "celebrate";
  return "wave";
}

export const HERO_POSES: Record<HeroPose, { src: string; alt: string }> = {
  wave: { src: "/gesti/poses/gesti-wave.webp", alt: "Gesti saludando" },
  review: { src: "/gesti/poses/gesti-review.webp", alt: "Gesti revisando tus tareas" },
  celebrate: { src: "/gesti/poses/gesti-celebrate.webp", alt: "Gesti festejando" },
  think: { src: "/gesti/poses/gesti-think.webp", alt: "Gesti pensando" }
};

export function heroPoseOf(groups: WorkGroup[], isLoading: boolean): HeroPose {
  return heroPose({ isLoading, overdue: count(groups, "overdue"), today: count(groups, "today") });
}

export type NoticeSummary = {
  toContact: number;
  // Porcentaje pagado sobre el total; null si no hay avisos.
  collectionPct: number | null;
};

export function buildNoticeSummary(notices: { status: string }[]): NoticeSummary {
  const toContact = notices.filter((notice) => notice.status === "avisar").length;
  const paid = notices.filter((notice) => notice.status === "pagado").length;
  return {
    toContact,
    collectionPct: notices.length > 0 ? Math.round((paid / notices.length) * 100) : null
  };
}
