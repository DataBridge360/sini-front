"use client";

import { AlertCircle, CalendarDays, CheckCircle2, Clock, ShieldCheck, type LucideIcon } from "lucide-react";
import { taskContext, type FeedRow, type FeedSection, type FeedState } from "@/components/dashboard/dashboard-helpers";
import { LoadingState } from "@/components/ui/states";

const STATE_ICON: Record<FeedState, LucideIcon> = {
  overdue: AlertCircle,
  today: Clock,
  tomorrow: CalendarDays,
  upcoming: CalendarDays,
  review: ShieldCheck
};

function FeedItem({ row, onOpenTask }: { row: FeedRow; onOpenTask: (taskId: string) => void }) {
  const { task, state } = row;
  const Icon = STATE_ICON[state];
  return (
    <li>
      <button type="button" className="db-row" onClick={() => onOpenTask(task.id)}>
        <span className="db-row-icon" data-state={state} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="db-row-text">
          <strong>{task.title}</strong>
          <span>{taskContext(task) || "Sin cliente"}</span>
        </span>
        <span className="db-row-end">
          <b data-state={state}>{row.dueLabel}</b>
          <span>{row.statusLabel}</span>
        </span>
      </button>
    </li>
  );
}

// "Tus tareas": el listado principal, agrupado por fecha como los movimientos
// de una billetera. Las filas abren la tarea; no se completa nada desde acá.
export function TaskFeed({
  sections,
  shown,
  total,
  isLoading,
  error,
  onOpenTask,
  onOpenTasks
}: {
  sections: FeedSection[];
  shown: number;
  total: number;
  isLoading: boolean;
  error: string | null;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
}) {
  return (
    <section className="db-feed" aria-labelledby="db-feed-title">
      <header className="db-feed-head">
        <h2 id="db-feed-title">Tus tareas</h2>
        <button type="button" className="db-link" onClick={onOpenTasks}>
          Ver todas
        </button>
      </header>

      {/* Mientras carga, Gesti pensando sobre el fondo, sin la tarjeta. */}
      {isLoading && !error ? (
        <LoadingState text="Cargando tus tareas" />
      ) : (
      <div className="db-card">
        {error ? (
          <p className="db-note" role="alert">
            {error}
          </p>
        ) : sections.length === 0 ? (
          <div className="db-empty">
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Estás al día, no tenés tareas con fecha pendientes.</span>
          </div>
        ) : (
          <>
            {sections.map((section) => (
              <div key={section.state} className="db-section">
                <h3>{section.title}</h3>
                <ul>
                  {section.rows.map((row) => (
                    <FeedItem key={row.task.id} row={row} onOpenTask={onOpenTask} />
                  ))}
                </ul>
              </div>
            ))}
            {total > shown ? (
              <button type="button" className="db-more" onClick={onOpenTasks}>
                Ver todas ({total})
              </button>
            ) : null}
          </>
        )}
      </div>
      )}
    </section>
  );
}
