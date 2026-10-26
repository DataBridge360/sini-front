"use client";

import type { Notice } from "@/lib/api";
import {
  clientNameOf,
  shortDayLabel,
  taskContext,
  type WorkItem
} from "@/components/dashboard/dashboard-helpers";

// Esperan la aprobación de quien modera. Cada fila abre la tarea: aprobar se
// hace desde Tareas, con sus permisos.
export function ApprovalsCard({
  items,
  total,
  onOpenTask,
  onOpenTasks
}: {
  items: WorkItem[];
  total: number;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
}) {
  return (
    <section className="db-card" aria-labelledby="db-approvals-title">
      <header className="db-card-head">
        <h2 id="db-approvals-title">
          Esperan tu aprobación <b data-tone="review">{total}</b>
        </h2>
        {total > items.length ? (
          <button type="button" className="db-link" onClick={onOpenTasks}>
            Ver todas
          </button>
        ) : null}
      </header>
      <ul className="db-list">
        {items.map(({ task }) => {
          const context = [...new Set([task.assigned_to?.full_name, clientNameOf(task)])].filter(Boolean).join(" · ");
          return (
            <li key={task.id}>
              <button type="button" className="db-row db-row-stacked" onClick={() => onOpenTask(task.id)}>
                <span className="db-row-text">
                  <strong>{task.title}</strong>
                  {context ? <span>{context}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Cobranza de un vistazo: tres números, la barra y la puerta a Avisos.
export function NoticesCard({ notices, onOpenNotices }: { notices: Notice[]; onOpenNotices: () => void }) {
  const toContact = notices.filter((notice) => notice.status === "avisar").length;
  const contacted = notices.filter((notice) => notice.status === "avisado").length;
  const paid = notices.filter((notice) => notice.status === "pagado").length;
  const paidRatio = notices.length ? Math.round((paid / notices.length) * 100) : 0;

  return (
    <section className="db-card" aria-labelledby="db-notices-title">
      <header className="db-card-head">
        <h2 id="db-notices-title">Avisos de cuotas</h2>
        <button type="button" className="db-link" onClick={onOpenNotices}>
          Ir a avisos
        </button>
      </header>
      <dl className="db-figures">
        <div>
          <dt>a contactar</dt>
          <dd>{toContact}</dd>
        </div>
        <div>
          <dt>contactados</dt>
          <dd>{contacted}</dd>
        </div>
        <div>
          <dt>pagados</dt>
          <dd>{paid}</dd>
        </div>
      </dl>
      <div className="db-progress" role="img" aria-label={`Cobranza registrada: ${paidRatio}%`}>
        <span style={{ width: `${paidRatio}%` }} />
      </div>
      <p className="db-progress-note">Cobranza · {paidRatio}%</p>
    </section>
  );
}

// Lo que viene en la semana, para cuando no hay nada que aprobar.
export function UpcomingCard({
  items,
  onOpenTask,
  onOpenTasks
}: {
  items: WorkItem[];
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
}) {
  return (
    <section className="db-card" aria-labelledby="db-upcoming-title">
      <header className="db-card-head">
        <h2 id="db-upcoming-title">Próximas tareas</h2>
        <button type="button" className="db-link" onClick={onOpenTasks}>
          Ver todas
        </button>
      </header>
      {items.length > 0 ? (
        <ul className="db-list">
          {items.map(({ task }) => {
            const context = taskContext(task);
            return (
              <li key={task.id}>
                <button type="button" className="db-row db-row-week db-row-stacked-text" onClick={() => onOpenTask(task.id)}>
                  <span className="db-row-text">
                    <strong>{task.title}</strong>
                    {context ? <span>{context}</span> : null}
                  </span>
                  <span className="db-due">{task.due_date ? shortDayLabel(task.due_date) : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="db-card-empty">No tenés tareas con fecha más adelante.</p>
      )}
    </section>
  );
}
