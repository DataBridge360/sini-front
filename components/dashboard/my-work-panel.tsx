"use client";

import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { Task } from "@/lib/api";
import { TASK_STATUS_META, taskPriorityMeta } from "@/lib/tasks";
import type { WorkGroup, WorkItem } from "@/components/dashboard/dashboard-helpers";

// Cuántas filas se ven por grupo antes de mandar a la vista de Tareas.
const VISIBLE_PER_GROUP = 5;

function contextOf(task: Task, showAssignee: boolean) {
  const client = task.clients?.full_name ?? task.policies?.clients?.full_name;
  const policy = task.policies ? `${task.policies.branch} · ${task.policies.policy_number}` : null;
  const parts = [showAssignee ? task.assigned_to?.full_name : null, client, policy].filter(Boolean);
  return parts.join(" · ");
}

function WorkRow({ item, group, onOpenTask }: { item: WorkItem; group: WorkGroup; onOpenTask: (taskId: string) => void }) {
  const { task } = item;
  const status = TASK_STATUS_META[task.status];
  const priority = taskPriorityMeta(task.priority);
  const context = contextOf(task, group.key === "review");

  return (
    <li>
      <button type="button" className="db-task" onClick={() => onOpenTask(task.id)}>
        <span className="db-task-main">
          <strong className="db-task-title">{task.title}</strong>
          {item.dueText ? (
            <span className="db-task-due" data-tone={group.key === "overdue" ? "overdue" : undefined}>
              {item.dueText}
            </span>
          ) : null}
        </span>
        <span className="db-task-meta">
          <span className={`db-chip ${status.chip}`}>{status.label}</span>
          <span className="db-priority">
            <i style={{ backgroundColor: priority.dot }} />
            {priority.label}
          </span>
          {context ? <span className="db-task-context">{context}</span> : null}
        </span>
      </button>
    </li>
  );
}

// Lo primero y lo más grande del dashboard: el trabajo propio, ordenado por
// urgencia, más lo que espera aprobación si quien mira es productor.
export function MyWorkPanel({
  groups,
  isLoading,
  error,
  onOpenTask,
  onOpenTasks
}: {
  groups: WorkGroup[];
  isLoading: boolean;
  error: string | null;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
}) {
  return (
    <section className="db-card db-work" aria-labelledby="db-work-title">
      <header className="db-card-head">
        <h2 id="db-work-title">Mi trabajo</h2>
        <button type="button" className="db-link" onClick={onOpenTasks}>
          Ver todas las tareas
          <ArrowUpRight size={13} />
        </button>
      </header>

      {error ? (
        <p className="db-note" role="alert" data-tone="error">
          {error}
        </p>
      ) : isLoading ? (
        <div className="db-skeleton-list" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : groups.length === 0 ? (
        <div className="db-empty">
          <CheckCircle2 size={22} />
          <strong>No tenés tareas pendientes</strong>
          <span>Cuando te asignen una o crees la tuya, aparece acá ordenada por vencimiento.</span>
        </div>
      ) : (
        groups.map((group) => {
          const visible = group.items.slice(0, VISIBLE_PER_GROUP);
          const hidden = group.items.length - visible.length;
          return (
            <div key={group.key} className="db-group" data-group={group.key}>
              <h3>
                {group.title}
                <b>{group.items.length}</b>
              </h3>
              <ul>
                {visible.map((item) => (
                  <WorkRow key={item.task.id} item={item} group={group} onOpenTask={onOpenTask} />
                ))}
              </ul>
              {hidden > 0 ? (
                <button type="button" className="db-link db-more" onClick={onOpenTasks}>
                  Ver {hidden} más en Tareas
                  <ArrowUpRight size={12} />
                </button>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
