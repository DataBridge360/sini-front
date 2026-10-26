"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { Task } from "@/lib/api";
import { taskContext, type AgendaRow, type AgendaState } from "@/components/dashboard/dashboard-helpers";

const STATE_LABEL: Record<AgendaState, string> = { overdue: "Vencidas", today: "Hoy", tomorrow: "Mañana" };

// El círculo informa, no se toca: vacío = pendiente, mitad = en proceso. Cambiar
// el estado pasa por el flujo de Tareas y sus permisos.
function StatusDot({ status }: { status: Task["status"] }) {
  return <span className="db-dot" data-status={status} role="img" aria-label={status === "en_proceso" ? "En proceso" : "Pendiente"} />;
}

// "Para hoy": vencidas, hoy y mañana en una sola lista corta.
export function TodayList({
  rows,
  total,
  isLoading,
  error,
  onOpenTask,
  onOpenTasks
}: {
  rows: AgendaRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
}) {
  // Con más de un tramo en pantalla, una etiqueta mínima los separa.
  const showLabels = new Set(rows.map((row) => row.state)).size > 1;

  return (
    <section className="db-card" aria-labelledby="db-today-title">
      <header className="db-card-head">
        <h2 id="db-today-title">Para hoy</h2>
        {total > rows.length ? (
          <button type="button" className="db-link" onClick={onOpenTasks}>
            Ver todas ({total})
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="db-note" role="alert">
          {error}
        </p>
      ) : isLoading ? (
        <div className="db-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : rows.length === 0 ? (
        <div className="db-empty">
          <CheckCircle2 size={20} />
          <strong>Estás al día</strong>
          <span>No tenés tareas vencidas ni para hoy o mañana.</span>
          <button type="button" className="db-link" onClick={onOpenTasks}>
            Ver todas las tareas
            <ArrowRight size={12} />
          </button>
        </div>
      ) : (
        <ul className="db-list">
          {rows.map((row, index) => {
            const { task } = row.item;
            const context = taskContext(task);
            return (
              <li key={task.id}>
                {showLabels && row.state !== rows[index - 1]?.state ? (
                  <span className="db-divider" data-state={row.state}>
                    {STATE_LABEL[row.state]}
                  </span>
                ) : null}
                <button type="button" className="db-row db-row-task" onClick={() => onOpenTask(task.id)}>
                  <StatusDot status={task.status} />
                  <span className="db-row-text">
                    <strong>{task.title}</strong>
                    {context ? <span>{context}</span> : null}
                  </span>
                  <span className="db-due" data-state={row.state}>
                    {row.dueLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
