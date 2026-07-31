"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import type { Client, OrganizationMember, Policy, TaskDetail, TaskPriority } from "@/lib/api";
import { TASK_PRIORITIES } from "@/lib/tasks";
import { FIELD_LABEL_CLASS, type TaskApi } from "@/components/tasks/shared";
import { SearchSelect } from "@/components/tasks/search-select";
import { DatePicker } from "@/components/ui/date-picker";

// Campos editables de la tarea. La etapa NO está acá: se cambia con
// TaskStatusControl, que es el único camino que valida el permiso de aprobación.
export function TaskDetailFields({
  task,
  members,
  clients,
  policies,
  onUpdate
}: {
  task: TaskDetail;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  onUpdate: (patch: Parameters<TaskApi["onUpdate"]>[1]) => void;
}) {
  const memberOptions = useMemo(
    () => members.map((member) => ({ id: member.id, label: member.full_name })),
    [members]
  );
  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        id: client.id,
        label: client.full_name,
        hint: client.phone ?? client.locality ?? undefined
      })),
    [clients]
  );
  const policyOptions = useMemo(
    () =>
      policies.map((policy) => ({
        id: policy.id,
        label: `#${policy.policy_number} · ${policy.clients?.full_name ?? "Sin cliente"}`,
        hint: `${policy.branch}${policy.vehicle_plate ? ` · ${policy.vehicle_plate}` : ""}`
      })),
    [policies]
  );

  return (
    <div className="sp-task-fields">
      <div className="sp-task-field">
        <span className={FIELD_LABEL_CLASS}>Prioridad</span>
        <div className="sp-task-chip-group" role="group" aria-label="Prioridad">
          {TASK_PRIORITIES.map((priority) => (
            <button
              key={priority.key}
              type="button"
              className="sp-task-chip"
              aria-pressed={task.priority === priority.key}
              onClick={() => onUpdate({ priority: priority.key as TaskPriority })}
            >
              <i style={{ backgroundColor: priority.dot }} />
              {priority.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sp-task-field">
        <span className={FIELD_LABEL_CLASS}>Asignado a</span>
        <SearchSelect
          value={task.assigned_to_user_id}
          options={memberOptions}
          placeholder="Sin asignar"
          onChange={(id) => onUpdate({ assignedToUserId: id })}
        />
      </div>

      <div className="sp-task-field">
        <span className={FIELD_LABEL_CLASS}>Vencimiento</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <DatePicker
              value={task.due_date ?? ""}
              onChange={(value) => onUpdate({ dueDate: value || null })}
              placeholder="Sin fecha"
              ariaLabel="Vencimiento"
            />
          </div>
          {task.due_date ? (
            <button
              type="button"
              className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500"
              aria-label="Quitar fecha"
              onClick={() => onUpdate({ dueDate: null })}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sp-task-field">
        <span className={FIELD_LABEL_CLASS}>Asegurado</span>
        <SearchSelect
          value={task.clients?.id ?? null}
          options={clientOptions}
          placeholder="Vincular asegurado"
          onChange={(id) => onUpdate({ clientId: id })}
        />
      </div>

      <div className="sp-task-field sp-task-field-wide">
        <span className={FIELD_LABEL_CLASS}>Póliza</span>
        <SearchSelect
          value={task.policies?.id ?? null}
          options={policyOptions}
          placeholder="Vincular póliza"
          onChange={(id) => onUpdate({ policyId: id })}
        />
      </div>
    </div>
  );
}
