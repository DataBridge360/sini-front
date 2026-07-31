"use client";

import type { TaskStatus } from "@/lib/api";
import { TASK_BOARD_STATUSES, TASK_STATUS_META } from "@/lib/tasks";

// Navegación por estado para mobile: los tres estados del tablero en una fila,
// cada uno con su conteo. El activo se marca con superficie blanca + borde
// fuerte, nunca con un relleno de color (regla del sistema: activo = card
// bordeada).
export function TaskStatusTabs({
  value,
  counts,
  canModerate,
  onChange
}: {
  value: TaskStatus;
  counts: Record<TaskStatus, number>;
  canModerate: boolean;
  onChange: (status: TaskStatus) => void;
}) {
  return (
    <div className="sp-task-tabs" role="tablist" aria-label="Estado de las tareas">
      {TASK_BOARD_STATUSES.map((status) => {
        const meta = TASK_STATUS_META[status];
        const isActive = value === status;
        // Para un productor, tener algo esperando aprobación es una tarea
        // pendiente propia: el punto lo señala sin agregar otro color al resto.
        const needsAttention = status === "revision" && canModerate && counts.revision > 0;

        return (
          <button
            key={status}
            type="button"
            role="tab"
            id={`task-tab-${status}`}
            aria-selected={isActive}
            aria-controls="task-tabpanel"
            className="sp-task-tab"
            onClick={() => onChange(status)}
          >
            <span className="sp-task-tab-label">
              <i style={{ backgroundColor: meta.dot }} />
              {meta.short}
              {needsAttention ? <em aria-label="Esperando tu aprobación" /> : null}
            </span>
            <span className="sp-task-tab-count">{counts[status]}</span>
          </button>
        );
      })}
    </div>
  );
}
