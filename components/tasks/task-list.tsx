"use client";

import type { TaskListItem, TaskStatus } from "@/lib/api";
import { TASK_STATUS_META } from "@/lib/tasks";
import { TaskCard } from "@/components/tasks/task-card";

// Lista de tareas del estado activo (mobile). El empty state explica qué es ese
// estado, no solo que está vacío.
export function TaskList({
  tasks,
  status,
  canModerate,
  movingTaskId,
  hasFilters,
  onOpen,
  onMove,
  onClearFilters
}: {
  tasks: TaskListItem[];
  status: TaskStatus;
  canModerate: boolean;
  movingTaskId: string | null;
  hasFilters: boolean;
  onOpen: (task: TaskListItem) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  onClearFilters: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div
        className="sp-task-empty"
        id="task-tabpanel"
        role="tabpanel"
        aria-labelledby={`task-tab-${status}`}
      >
        {hasFilters ? (
          <>
            <strong>Ninguna tarea coincide</strong>
            <span>Probá con otros filtros o limpialos para ver todo.</span>
            <button type="button" className="sp-secondary-action mt-1" onClick={onClearFilters}>
              Limpiar filtros
            </button>
          </>
        ) : (
          <>
            <strong>Nada en {TASK_STATUS_META[status].label.toLowerCase()}</strong>
            <span>{TASK_STATUS_META[status].hint}.</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="sp-task-list"
      id="task-tabpanel"
      role="tabpanel"
      aria-labelledby={`task-tab-${status}`}
    >
      <div className="sp-task-list-scroll">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            canModerate={canModerate}
            isMoving={movingTaskId === task.id}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))}
      </div>
    </div>
  );
}
