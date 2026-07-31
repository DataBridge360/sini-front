"use client";

import { CalendarDays, FileText, User } from "lucide-react";
import type { TaskDetail } from "@/lib/api";
import { formatDate, getDaysUntilDue, initials } from "@/lib/format";
import { taskPriorityMeta } from "@/lib/tasks";

// Datos de la tarea en modo lectura.
//
// Abrir una tarea es, casi siempre, para mirarla: leer de qué se trata y seguir
// la conversación. Editar es la excepción y vive detrás del menú del encabezado.
// Mostrar cinco controles editables de entrada convierte una lectura rápida en
// un formulario, y hace fácil cambiar algo sin querer.
//
// Los datos van como chips en una fila que envuelve: el ícono ya dice qué es
// cada uno, así que el rótulo se reserva para lectores de pantalla. Ocupa un
// tercio del alto que ocupaba la grilla de pares etiqueta-sobre-valor.
export function TaskDetailSummary({ task }: { task: TaskDetail }) {
  const priority = taskPriorityMeta(task.priority);
  const days = task.due_date ? getDaysUntilDue(task.due_date) : null;
  const isOverdue = days !== null && days < 0 && task.status !== "finalizado";

  return (
    <dl className="sp-task-summary">
      <div className="sp-task-summary-item">
        <dt>Prioridad</dt>
        <dd>
          <i className="sp-task-summary-dot" style={{ backgroundColor: priority.dot }} />
          {priority.label}
        </dd>
      </div>

      <div className="sp-task-summary-item">
        <dt>Asignado a</dt>
        <dd>
          {task.assigned_to ? (
            <>
              <span className="sp-task-summary-avatar">{initials(task.assigned_to.full_name)}</span>
              <span className="truncate">{task.assigned_to.full_name}</span>
            </>
          ) : (
            <span className="sp-task-summary-empty">Sin asignar</span>
          )}
        </dd>
      </div>

      <div className="sp-task-summary-item">
        <dt>Vencimiento</dt>
        <dd>
          {task.due_date ? (
            <>
              <CalendarDays size={12} className="shrink-0 text-slate-400" />
              <span className={isOverdue ? "sp-task-summary-overdue" : ""}>
                {isOverdue ? "Venció el " : ""}
                {formatDate(task.due_date)}
              </span>
            </>
          ) : (
            <span className="sp-task-summary-empty">Sin fecha</span>
          )}
        </dd>
      </div>

      {/* Los vínculos solo ocupan lugar cuando existen: en una tarea sin póliza,
          un chip que dice "sin póliza" no aporta nada. */}
      {task.clients ? (
        <div className="sp-task-summary-item">
          <dt>Asegurado</dt>
          <dd>
            <User size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">{task.clients.full_name}</span>
          </dd>
        </div>
      ) : null}

      {task.policies ? (
        <div className="sp-task-summary-item">
          <dt>Póliza</dt>
          <dd>
            <FileText size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">#{task.policies.policy_number}</span>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
