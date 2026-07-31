"use client";

import { CalendarDays, FileText, MessageSquare, Paperclip, User } from "lucide-react";
import type { TaskListItem, TaskStatus } from "@/lib/api";
import { formatDate, getDaysUntilDue, initials } from "@/lib/format";
import { PriorityChip } from "@/components/tasks/shared";
import { TaskStatusControl } from "@/components/tasks/task-status-control";

// Contenido de la tarjeta. Se comparte con el overlay de arrastre del kanban,
// que necesita el mismo cuerpo sin el contenedor interactivo.
export function TaskCardContent({
  task,
  canModerate,
  isMoving,
  onMove
}: {
  task: TaskListItem;
  canModerate: boolean;
  isMoving: boolean;
  onMove?: (status: TaskStatus) => void;
}) {
  const days = task.due_date ? getDaysUntilDue(task.due_date) : null;
  const isOverdue = days !== null && days < 0;
  // Color solo cuando comunica urgencia real: vencida o vence en 3 días.
  const dueChip = isOverdue
    ? "bg-red-50 text-red-700"
    : days !== null && days <= 3
      ? "bg-amber-50 text-amber-700"
      : "bg-slate-100 text-slate-500";

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h4 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-slate-900">{task.title}</h4>
        <PriorityChip priority={task.priority} />
      </div>

      {task.due_date || task.clients || task.policies ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {task.due_date ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${dueChip}`}>
              <CalendarDays size={10.5} className="shrink-0" />
              {isOverdue ? "Venció el " : ""}
              {formatDate(task.due_date)}
            </span>
          ) : null}
          {task.clients ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[color:var(--org-primary-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--org-primary)]">
              <User size={10.5} className="shrink-0" />
              <span className="truncate">{task.clients.full_name}</span>
            </span>
          ) : null}
          {task.policies ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">
              <FileText size={10.5} className="shrink-0" />
              <span className="truncate">#{task.policies.policy_number}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
        {task.assigned_to ? (
          <span className="flex min-w-0 items-center gap-1.5" title={`Asignada a ${task.assigned_to.full_name}`}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--org-primary)] text-[10.5px] font-bold text-white">
              {initials(task.assigned_to.full_name)}
            </span>
            <span className="truncate text-[11px] font-medium text-slate-600">{task.assigned_to.full_name}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300">
              <User size={11} />
            </span>
            Sin asignar
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] font-medium text-slate-400">
          {task.messages_count > 0 ? (
            <span className="flex items-center gap-0.5" title={`${task.messages_count} actividades`}>
              <MessageSquare size={11} />
              {task.messages_count}
            </span>
          ) : null}
          {task.attachments_count > 0 ? (
            <span className="flex items-center gap-0.5" title={`${task.attachments_count} archivos`}>
              <Paperclip size={11} />
              {task.attachments_count}
            </span>
          ) : null}
        </span>
      </div>

      {onMove ? (
        <div className="mt-2.5">
          <TaskStatusControl
            status={task.status}
            canModerate={canModerate}
            isBusy={isMoving}
            onMove={onMove}
          />
        </div>
      ) : null}
    </>
  );
}

// Tarjeta de la lista (mobile y Archivadas). El kanban usa su propio contenedor
// arrastrable con el mismo contenido.
export function TaskCard({
  task,
  canModerate,
  isMoving,
  onOpen,
  onMove
}: {
  task: TaskListItem;
  canModerate: boolean;
  isMoving: boolean;
  onOpen: (task: TaskListItem) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
}) {
  return (
    <article
      className="sp-task-card"
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(task);
        }
      }}
    >
      <TaskCardContent
        task={task}
        canModerate={canModerate}
        isMoving={isMoving}
        onMove={(status) => onMove(task.id, status)}
      />
    </article>
  );
}
