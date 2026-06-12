// Reglas de dominio del módulo Tareas (columnas del tablero, prioridades, filtros).

import type { Task, TaskPriority, TaskStatus } from "@/lib/api";

export const TASK_COLUMNS = [
  { key: "pendiente" as const, label: "Pendiente", hint: "Todavía sin arrancar", dot: "#f59e0b" },
  { key: "en_proceso" as const, label: "En proceso", hint: "Se está trabajando", dot: "#4d8eff" },
  { key: "finalizado" as const, label: "Finalizado", hint: "Trabajo terminado", dot: "#4ae176" }
];

export const TASK_PRIORITIES: Array<{ key: TaskPriority; label: string; chip: string; dot: string }> = [
  { key: "alta", label: "Alta", chip: "bg-red-50 text-red-700", dot: "#ef4444" },
  { key: "media", label: "Media", chip: "bg-amber-50 text-amber-700", dot: "#f59e0b" },
  { key: "baja", label: "Baja", chip: "bg-sky-50 text-sky-700", dot: "#0ea5e9" }
];

export function taskPriorityMeta(priority: TaskPriority) {
  return TASK_PRIORITIES.find((item) => item.key === priority) ?? TASK_PRIORITIES[1]!;
}

export function taskStatusLabel(status: TaskStatus) {
  return TASK_COLUMNS.find((column) => column.key === status)?.label ?? status;
}

export type TaskFilters = {
  search: string;
  priority: "all" | TaskPriority;
  // "all" | "me" | id de usuario asignado
  assignee: string;
};

export const EMPTY_TASK_FILTERS: TaskFilters = {
  search: "",
  priority: "all",
  assignee: "all"
};

export function matchesTaskFilters(task: Task, filters: TaskFilters, currentUserId: string) {
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
  return Boolean(matchesSearch) && matchesPriority && matchesAssignee;
}

// Solo quien creó la tarea puede eliminarla; el productor puede eliminar cualquiera.
export function canDeleteTask(task: Task, currentUserId: string, canModerate: boolean) {
  return canModerate || task.created_by_user_id === currentUserId;
}
