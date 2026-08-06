"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type { OrganizationMember } from "@/lib/api";
import {
  EMPTY_TASK_FILTERS,
  isMineTaskAssignee,
  TASK_PRIORITIES,
  type TaskDueFilter,
  type TaskFilters
} from "@/lib/tasks";
import { Modal } from "@/components/ui/modal";

const DUE_OPTIONS: Array<{ key: TaskDueFilter; label: string }> = [
  { key: "all", label: "Cualquier fecha" },
  { key: "overdue", label: "Vencidas" },
  { key: "week", label: "Vencen esta semana" },
  { key: "none", label: "Sin fecha" }
];

// Panel de filtros.
//
// Sin comboboxes a propósito: un menú desplegable dentro de un panel con scroll
// se recorta contra el contenedor y en touch obliga a dos toques por opción.
// Con pocas opciones, mostrarlas todas es más rápido y no se rompe nunca.
export function TaskFilterSheet({
  isOpen,
  filters,
  members,
  currentUserId,
  onApply,
  onClose
}: {
  isOpen: boolean;
  filters: TaskFilters;
  members: OrganizationMember[];
  currentUserId: string;
  onApply: (filters: TaskFilters) => void;
  onClose: () => void;
}) {
  // Borrador local: los cambios se aplican al confirmar, así se puede armar la
  // combinación completa sin que la lista salte con cada toque.
  const [draft, setDraft] = useState(filters);

  // El panel se remonta en cada apertura (key en el padre), así que el borrador
  // arranca siempre con los filtros vigentes.
  const update = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const isMine = isMineTaskAssignee(draft.assignee, currentUserId);

  return (
    <Modal title="Filtrar tareas" isOpen={isOpen} onClose={onClose}>
      <div className="sp-filter-sheet">
        <section>
          <span className="sp-filter-sheet-label">Prioridad</span>
          <div className="sp-task-chip-group">
            <button
              type="button"
              className="sp-task-chip"
              aria-pressed={draft.priority === "all"}
              onClick={() => update("priority", "all")}
            >
              Todas
            </button>
            {TASK_PRIORITIES.map((priority) => (
              <button
                key={priority.key}
                type="button"
                className="sp-task-chip"
                aria-pressed={draft.priority === priority.key}
                onClick={() => update("priority", priority.key)}
              >
                <i style={{ backgroundColor: priority.dot }} />
                {priority.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <span className="sp-filter-sheet-label">Vencimiento</span>
          <div className="sp-task-chip-group">
            {DUE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="sp-task-chip"
                aria-pressed={draft.due === option.key}
                onClick={() => update("due", option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <span className="sp-filter-sheet-label">Asignado a</span>
          <div className="sp-filter-people">
            <button
              type="button"
              className="sp-filter-person"
              aria-pressed={draft.assignee === "all"}
              onClick={() => update("assignee", "all")}
            >
              <span>Todos</span>
              {draft.assignee === "all" ? <Check size={15} /> : null}
            </button>
            <button
              type="button"
              className="sp-filter-person"
              aria-pressed={isMine}
              onClick={() => update("assignee", "me")}
            >
              <span>Mis tareas</span>
              {isMine ? <Check size={15} /> : null}
            </button>
            {/* Uno mismo no se repite acá abajo: ya está arriba como "Mis
                tareas", y dos filas que filtran lo mismo obligan a mirar cuál
                quedó tildada. */}
            {members
              .filter((member) => member.id !== currentUserId)
              .map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="sp-filter-person"
                  aria-pressed={draft.assignee === member.id}
                  onClick={() => update("assignee", member.id)}
                >
                  <span className="truncate">{member.full_name}</span>
                  {draft.assignee === member.id ? <Check size={15} /> : null}
                </button>
              ))}
          </div>
        </section>

        <div className="sp-modal-actions sp-filter-sheet-actions">
          <button
            type="button"
            className="sp-secondary-action"
            onClick={() => setDraft({ ...EMPTY_TASK_FILTERS, search: draft.search })}
          >
            Limpiar
          </button>
          <button
            type="button"
            className="sp-primary-action"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Ver resultados
          </button>
        </div>
      </div>
    </Modal>
  );
}
