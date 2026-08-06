// Reglas de dominio del módulo Tareas: estados del flujo, transiciones,
// prioridades y filtros.

import type { TaskListItem, TaskPriority, TaskStatus } from "@/lib/api";

// Lo que se ve en el tablero. 'finalizado' queda afuera: al aprobarse la tarea
// se archiva y solo aparece en la vista Archivadas.
export const TASK_BOARD_STATUSES = ["pendiente", "en_proceso", "revision"] as const;
export type TaskBoardStatus = (typeof TASK_BOARD_STATUSES)[number];

type TaskStatusMeta = {
  label: string;
  // Etiqueta corta para las pestañas de mobile, donde entran 3 en una fila.
  short: string;
  hint: string;
  dot: string;
  chip: string;
};

// El violeta de 'revision' no compite con el semáforo de cobranza
// (verde/ámbar/rojo): es un estado de flujo de trabajo, no de vencimiento.
export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  pendiente: {
    label: "Pendiente",
    short: "Pendiente",
    hint: "Todavía sin arrancar",
    dot: "#b54708",
    chip: "bg-amber-50 text-amber-700"
  },
  en_proceso: {
    label: "En proceso",
    short: "En curso",
    hint: "Se está trabajando",
    dot: "#175cd3",
    chip: "bg-blue-50 text-blue-700"
  },
  revision: {
    label: "En revisión",
    short: "Revisión",
    hint: "Esperando aprobación del productor",
    dot: "#6941c6",
    chip: "bg-violet-50 text-violet-700"
  },
  finalizado: {
    label: "Finalizada",
    short: "Archivada",
    hint: "Aprobada y archivada",
    dot: "#067647",
    chip: "bg-emerald-50 text-emerald-700"
  }
};

export const TASK_PRIORITIES: Array<{ key: TaskPriority; label: string; chip: string; dot: string }> = [
  { key: "alta", label: "Alta", chip: "bg-red-50 text-red-700", dot: "#ef4444" },
  { key: "media", label: "Media", chip: "bg-amber-50 text-amber-700", dot: "#f59e0b" },
  { key: "baja", label: "Baja", chip: "bg-sky-50 text-sky-700", dot: "#0ea5e9" }
];

export function taskPriorityMeta(priority: TaskPriority) {
  return TASK_PRIORITIES.find((item) => item.key === priority) ?? TASK_PRIORITIES[1]!;
}

export function taskStatusLabel(status: TaskStatus) {
  return TASK_STATUS_META[status]?.label ?? status;
}

export function isArchived(task: Pick<TaskListItem, "status">) {
  return task.status === "finalizado";
}

// Espejo exacto de backend/src/tasks/tasks.rules.ts. Si cambia una, cambian las
// dos: acá decide qué botones se ven, allá decide qué se permite.
//
//   Desde \ Hacia | pendiente | en_proceso | revision | finalizado
//   pendiente     |     —     |   todos    |  todos   | solo productor
//   en_proceso    |   todos   |     —      |  todos   | solo productor
//   revision      | productor | productor  |    —     | solo productor
//   finalizado    | productor | productor  | productor|      —
export function canTransitionStatus(from: TaskStatus, to: TaskStatus, canModerate: boolean) {
  if (from === to) return false;
  if (canModerate) return true;
  if (from === "revision" || from === "finalizado") return false;
  return to !== "finalizado";
}

// Por qué el botón está deshabilitado. Un control apagado sin explicación se lee
// como que la app está rota.
export function transitionBlockedReason(from: TaskStatus, to: TaskStatus) {
  if (to === "finalizado") return "Solo un productor puede aprobar y archivar una tarea.";
  if (from === "finalizado") return "Solo un productor puede desarchivar una tarea.";
  if (from === "revision") return "Solo un productor puede sacar una tarea de revisión.";
  return "No tenés permiso para hacer este cambio.";
}

export type TaskStatusAction = {
  to: TaskStatus;
  label: string;
  // Acción destacada del estado actual; el resto va en el menú.
  primary: boolean;
  tone: "accent" | "neutral" | "danger";
  disabled: boolean;
  reason: string | null;
};

// Acciones ofrecidas según el estado actual, en orden de relevancia. La primera
// es la que se muestra directo en la card.
export function statusActions(status: TaskStatus, canModerate: boolean): TaskStatusAction[] {
  const build = (
    to: TaskStatus,
    label: string,
    primary: boolean,
    tone: TaskStatusAction["tone"]
  ): TaskStatusAction => {
    const allowed = canTransitionStatus(status, to, canModerate);
    return {
      to,
      label,
      primary,
      tone,
      disabled: !allowed,
      reason: allowed ? null : transitionBlockedReason(status, to)
    };
  };

  switch (status) {
    case "pendiente":
      return [build("en_proceso", "Empezar", true, "accent"), build("revision", "Enviar a revisión", false, "neutral")];
    case "en_proceso":
      return [
        build("revision", "Enviar a revisión", true, "accent"),
        build("pendiente", "Volver a pendiente", false, "neutral")
      ];
    case "revision":
      return [
        build("finalizado", "Aprobar y archivar", true, "accent"),
        build("en_proceso", "Rechazar", false, "danger")
      ];
    case "finalizado":
      return [build("en_proceso", "Desarchivar", true, "accent")];
  }
}

export type TaskDueFilter = "all" | "overdue" | "week" | "none";

export type TaskFilters = {
  search: string;
  priority: "all" | TaskPriority;
  // "all" | "me" | id de usuario asignado
  assignee: string;
  due: TaskDueFilter;
};

export const EMPTY_TASK_FILTERS: TaskFilters = {
  search: "",
  priority: "all",
  assignee: "all",
  due: "all"
};

// El atajo "Mis tareas" y elegirse a uno mismo en la lista de asignados son lo
// mismo filtro. Se pregunta por acá en todos lados para que el botón de la barra
// y el panel no puedan quedar contradiciéndose —uno apagado, el otro con tu
// nombre tildado— mostrando exactamente las mismas tareas.
export function isMineTaskAssignee(assignee: string, currentUserId: string) {
  return assignee === "me" || assignee === currentUserId;
}

export function hasActiveTaskFilters(filters: TaskFilters) {
  return (
    filters.search !== "" ||
    filters.priority !== "all" ||
    filters.assignee !== "all" ||
    filters.due !== "all"
  );
}

// Cuántos filtros hay puestos que no se ven en la barra. "Mis tareas" no cuenta:
// tiene su propio botón encendido al lado, y sumarlo al globo de Filtros dice
// que hay algo escondido adentro del panel cuando no hay nada.
export function countActiveTaskFilters(filters: TaskFilters, currentUserId: string) {
  const hasOtherAssignee =
    filters.assignee !== "all" && !isMineTaskAssignee(filters.assignee, currentUserId);

  return (
    (filters.priority !== "all" ? 1 : 0) +
    (hasOtherAssignee ? 1 : 0) +
    (filters.due !== "all" ? 1 : 0)
  );
}

function matchesDueFilter(dueDate: string | null, due: TaskDueFilter) {
  if (due === "all") return true;
  if (due === "none") return !dueDate;
  if (!dueDate) return false;

  // Comparación por día local: las fechas del backend son `date`, sin hora.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = dueDate.split("-").map(Number);
  const target = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (due === "overdue") return days < 0;
  return days >= 0 && days <= 7;
}

export function matchesTaskFilters(
  task: TaskListItem,
  filters: TaskFilters,
  currentUserId: string
) {
  const term = filters.search.toLowerCase();
  const matchesSearch =
    !term ||
    task.title.toLowerCase().includes(term) ||
    task.clients?.full_name?.toLowerCase().includes(term) ||
    task.policies?.policy_number?.toLowerCase().includes(term) ||
    task.assigned_to?.full_name?.toLowerCase().includes(term);
  const matchesPriority = filters.priority === "all" || task.priority === filters.priority;
  const assigneeTarget = filters.assignee === "me" ? currentUserId : filters.assignee;
  const matchesAssignee = filters.assignee === "all" || task.assigned_to_user_id === assigneeTarget;
  return (
    Boolean(matchesSearch) &&
    matchesPriority &&
    matchesAssignee &&
    matchesDueFilter(task.due_date, filters.due)
  );
}

// Más cerca de vencer primero (vencidas arriba). Sin fecha de vencimiento, al final.
// due_date llega como "YYYY-MM-DD": localeCompare ordena cronológicamente.
export function compareTasksByDueDate(a: TaskListItem, b: TaskListItem) {
  if (a.due_date === b.due_date) {
    return a.created_at.localeCompare(b.created_at);
  }
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

export function sortTasksByDueDate(tasks: TaskListItem[]) {
  return [...tasks].sort(compareTasksByDueDate);
}

// Solo quien creó la tarea puede eliminarla; el productor puede eliminar cualquiera.
export function canDeleteTask(
  task: Pick<TaskListItem, "created_by_user_id">,
  currentUserId: string,
  canModerate: boolean
) {
  return canModerate || task.created_by_user_id === currentUserId;
}
