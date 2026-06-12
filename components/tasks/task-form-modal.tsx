"use client";

import type { JSONContent } from "@tiptap/react";
import { Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { Client, OrganizationMember, Policy, TaskFormPayload, TaskPriority, TaskStatus } from "@/lib/api";
import { TASK_COLUMNS, TASK_PRIORITIES } from "@/lib/tasks";
import { FIELD_LABEL_CLASS, FIELD_SELECT_CLASS } from "@/components/tasks/shared";
import { SearchSelect } from "@/components/tasks/search-select";
import { TaskEditor } from "@/components/tasks/task-editor";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";

export function TaskFormModal({
  isOpen,
  members,
  clients,
  policies,
  isCreating,
  onClose,
  onCreate
}: {
  isOpen: boolean;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  isCreating: boolean;
  onClose: () => void;
  onCreate: (payload: TaskFormPayload) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<JSONContent | null>(null);
  const [status, setStatus] = useState<TaskStatus>("pendiente");
  const [priority, setPriority] = useState<TaskPriority>("media");
  const [dueDate, setDueDate] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remonta el editor (y limpia el formulario) en cada apertura.
  const [formKey, setFormKey] = useState(0);

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

  const reset = () => {
    setTitle("");
    setDescription(null);
    setStatus("pendiente");
    setPriority("media");
    setDueDate("");
    setAssignedToUserId(null);
    setClientId(null);
    setPolicyId(null);
    setError(null);
    setFormKey((current) => current + 1);
  };

  const close = () => {
    if (isCreating) return;
    reset();
    onClose();
  };

  return (
    <Modal title="Nueva tarea" isOpen={isOpen} onClose={close}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) {
            setError("El título es obligatorio.");
            return;
          }
          setError(null);
          try {
            await onCreate({
              title: value,
              description,
              status,
              priority,
              dueDate: dueDate || null,
              assignedToUserId,
              clientId,
              policyId
            });
            reset();
            onClose();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo crear la tarea.");
          }
        }}
      >
        <input
          value={title}
          autoFocus
          placeholder="Título de la tarea"
          maxLength={200}
          className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[15px] font-semibold text-slate-900 outline-none transition-colors focus:border-[color:var(--org-primary)]"
          onChange={(event) => setTitle(event.target.value)}
          disabled={isCreating}
        />

        <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
          <label className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Etapa</span>
            <select
              className={FIELD_SELECT_CLASS}
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
              disabled={isCreating}
            >
              {TASK_COLUMNS.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Prioridad</span>
            <select
              className={FIELD_SELECT_CLASS}
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
              disabled={isCreating}
            >
              {TASK_PRIORITIES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Asignar a</span>
            <SearchSelect
              value={assignedToUserId}
              options={memberOptions}
              placeholder="Sin asignar"
              disabled={isCreating}
              onChange={setAssignedToUserId}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Vencimiento</span>
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Sin fecha" ariaLabel="Vencimiento" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Asegurado</span>
            <SearchSelect
              value={clientId}
              options={clientOptions}
              placeholder="Vincular asegurado"
              disabled={isCreating}
              onChange={setClientId}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>Póliza</span>
            <SearchSelect
              value={policyId}
              options={policyOptions}
              placeholder="Vincular póliza"
              disabled={isCreating}
              onChange={setPolicyId}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>Descripción</span>
          <TaskEditor
            key={formKey}
            value={null}
            minHeightClass="min-h-[140px]"
            placeholder="Detallá la tarea: objetivos, checklist, tablas..."
            onChange={setDescription}
          />
        </div>

        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">{error}</div> : null}

        <div className="sp-modal-actions">
          <button type="button" className="sp-secondary-action" onClick={close} disabled={isCreating}>
            Cancelar
          </button>
          <button type="submit" className="sp-primary-action" disabled={isCreating}>
            {isCreating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {isCreating ? "Creando..." : "Crear tarea"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
