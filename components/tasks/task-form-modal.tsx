"use client";

import type { JSONContent } from "@tiptap/react";
import { Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { Client, OrganizationMember, Policy, TaskFormPayload, TaskPriority } from "@/lib/api";
import { useDeferRealtime } from "@/lib/realtime";
import { TASK_PRIORITIES } from "@/lib/tasks";
import { FIELD_LABEL_CLASS } from "@/components/tasks/shared";
import { SearchSelect } from "@/components/tasks/search-select";
import { TaskEditor } from "@/components/tasks/task-editor";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";

// Crear una tarea tiene que ser rápido: título, prioridad, fecha y listo. Los
// vínculos a asegurado y póliza van plegados, porque en un celular seis campos
// abiertos son varias pantallas de scroll antes de ver el botón. La descripción
// sí está siempre montada: escribirla es parte de crear la tarea, no un extra.
//
// Toda tarea nace 'pendiente'; para arrancarla enseguida está "Empezar" en la
// tarjeta, que es un tap.
export function TaskFormModal({
  isOpen,
  members,
  clients,
  policies,
  currentUserId,
  isCreating,
  onClose,
  onCreate
}: {
  isOpen: boolean;
  members: OrganizationMember[];
  clients: Client[];
  policies: Policy[];
  currentUserId: string;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (payload: TaskFormPayload) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<JSONContent | null>(null);
  const [priority, setPriority] = useState<TaskPriority>("media");
  const [dueDate, setDueDate] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remonta el editor (y limpia el formulario) en cada apertura.
  const [formKey, setFormKey] = useState(0);

  // Mientras se está cargando una tarea nueva, los refrescos de tiempo real
  // esperan: nadie tiene por qué ver moverse el fondo mientras completa el
  // formulario. Al cerrarlo se aplican todos juntos.
  useDeferRealtime(isOpen);

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
    <Modal title="Nueva tarea" size="wide" isOpen={isOpen} onClose={close}>
      <form
        className="sp-task-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) {
            setError("Escribí un título para la tarea.");
            return;
          }
          setError(null);
          try {
            await onCreate({
              title: value,
              description,
              status: "pendiente",
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
        <div className="sp-task-form-title">
          <input
            value={title}
            autoFocus
            placeholder="¿Qué hay que hacer?"
            maxLength={200}
            aria-label="Título de la tarea"
            onChange={(event) => setTitle(event.target.value)}
            disabled={isCreating}
          />
          {title.length > 150 ? <span>{title.length}/200</span> : null}
        </div>

        {/* Prioridad y vencimiento son los dos campos cortos: emparejados
            cuando hay ancho, apilados cuando no. */}
        <div className="sp-task-form-row">
          <div className="sp-task-form-field">
            <span className={FIELD_LABEL_CLASS}>Prioridad</span>
            <div className="sp-task-chip-group" role="group" aria-label="Prioridad">
              {TASK_PRIORITIES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="sp-task-chip"
                  aria-pressed={priority === item.key}
                  disabled={isCreating}
                  onClick={() => setPriority(item.key)}
                >
                  <i style={{ backgroundColor: item.dot }} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sp-task-form-field">
            <span className={FIELD_LABEL_CLASS}>Vencimiento</span>
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Sin fecha" ariaLabel="Vencimiento" />
          </div>
        </div>

        {/* Un selector de persona no gana nada con 800px de ancho: media
            columna, igual que los campos de arriba. */}
        <div className="sp-task-form-row">
          <div className="sp-task-form-field">
            <span className={FIELD_LABEL_CLASS}>Asignar a</span>
            <SearchSelect
              value={assignedToUserId}
              options={memberOptions}
              placeholder="Sin asignar"
              disabled={isCreating}
              onChange={setAssignedToUserId}
            />
            {assignedToUserId !== currentUserId ? (
              <button
                type="button"
                className="sp-task-chip mt-1.5 self-start"
                disabled={isCreating}
                onClick={() => setAssignedToUserId(currentUserId)}
              >
                Asignármela a mí
              </button>
            ) : null}
          </div>
        </div>

        {/* Vínculos y descripción son opcionales y poco frecuentes al crear:
            plegados, no compiten con lo que sí se completa siempre. */}
        <details className="sp-task-form-more">
          <summary>Vincular asegurado o póliza</summary>
          <div className="sp-task-form-more-fields">
            <div className="sp-task-form-field">
              <span className={FIELD_LABEL_CLASS}>Asegurado</span>
              <SearchSelect
                value={clientId}
                options={clientOptions}
                placeholder="Vincular asegurado"
                disabled={isCreating}
                onChange={setClientId}
              />
            </div>
            <div className="sp-task-form-field">
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
        </details>

        <div className="sp-task-form-field">
          <span className={FIELD_LABEL_CLASS}>Descripción</span>
          <TaskEditor
            key={formKey}
            value={null}
            minHeightClass="min-h-[140px]"
            placeholder="Detallá la tarea: objetivos, checklist, tablas..."
            onChange={setDescription}
          />
        </div>

        {error ? <div className="sp-task-form-error">{error}</div> : null}

        <div className="sp-modal-actions sp-task-form-actions">
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
