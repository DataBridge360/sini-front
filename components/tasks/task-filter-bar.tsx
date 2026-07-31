"use client";

import { Archive, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { OrganizationMember } from "@/lib/api";
import {
  countActiveTaskFilters,
  EMPTY_TASK_FILTERS,
  hasActiveTaskFilters,
  taskPriorityMeta,
  type TaskDueFilter,
  type TaskFilters
} from "@/lib/tasks";
import { TaskFilterSheet } from "@/components/tasks/task-filter-sheet";

const DUE_LABELS: Record<TaskDueFilter, string> = {
  all: "",
  overdue: "Vencidas",
  week: "Vencen esta semana",
  none: "Sin fecha"
};

type ActiveChip = { key: keyof TaskFilters; label: string; dot?: string };

// Traduce los filtros vigentes a etiquetas legibles. Solo se muestra lo que está
// puesto: un panel con todos los campos vacíos ocupa media pantalla para no
// decir nada.
function activeChips(
  filters: TaskFilters,
  members: OrganizationMember[],
  currentUserId: string
): ActiveChip[] {
  const chips: ActiveChip[] = [];

  if (filters.priority !== "all") {
    const meta = taskPriorityMeta(filters.priority);
    chips.push({ key: "priority", label: `Prioridad ${meta.label.toLowerCase()}`, dot: meta.dot });
  }

  if (filters.assignee !== "all") {
    const label =
      filters.assignee === "me" || filters.assignee === currentUserId
        ? "Mis tareas"
        : members.find((member) => member.id === filters.assignee)?.full_name ?? "Asignada";
    chips.push({ key: "assignee", label });
  }

  if (filters.due !== "all") {
    chips.push({ key: "due", label: DUE_LABELS[filters.due] });
  }

  return chips;
}

export function TaskFilterBar({
  filters,
  members,
  currentUserId,
  resultCount,
  archivedCount,
  onChange,
  onCreate,
  onOpenArchived
}: {
  filters: TaskFilters;
  members: OrganizationMember[];
  currentUserId: string;
  resultCount: number;
  // Total de finalizadas de la organización (COUNT del servidor). `null`
  // mientras se está pidiendo: se muestra el acceso sin número, nunca un 0
  // provisorio que después salta.
  archivedCount: number | null;
  onChange: (filters: TaskFilters) => void;
  onCreate: () => void;
  onOpenArchived: () => void;
}) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // Remonta el panel en cada apertura para que su borrador parta de los filtros
  // vigentes.
  const [sheetKey, setSheetKey] = useState(0);

  const activeCount = countActiveTaskFilters(filters);
  const chips = activeChips(filters, members, currentUserId);

  const openSheet = () => {
    setSheetKey((current) => current + 1);
    setIsSheetOpen(true);
  };

  const clearChip = (key: keyof TaskFilters) => {
    onChange({ ...filters, [key]: EMPTY_TASK_FILTERS[key] });
  };

  return (
    <div className="sp-task-command-area">
      <div className="sp-task-command">
        <div className="sp-search sp-task-search">
          <Search size={15} />
          <input
            placeholder="Buscar tarea, asegurado o póliza"
            value={filters.search}
            aria-label="Buscar tareas"
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
          />
          {filters.search ? (
            <button
              type="button"
              className="sp-task-search-clear"
              aria-label="Borrar búsqueda"
              onClick={() => onChange({ ...filters, search: "" })}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="sp-task-filter-button"
          aria-pressed={activeCount > 0}
          onClick={openSheet}
        >
          <SlidersHorizontal size={15} />
          <span>Filtros</span>
          {activeCount > 0 ? <b>{activeCount}</b> : null}
        </button>

        <button type="button" className="sp-primary-action sp-task-create" onClick={onCreate}>
          <Plus size={15} />
          <span>Nueva tarea</span>
        </button>
      </div>

      {chips.length > 0 ? (
        <div className="sp-task-active-filters">
          {chips.map((chip) => (
            <span key={chip.key} className="sp-task-active-chip">
              {chip.dot ? <i style={{ backgroundColor: chip.dot }} /> : null}
              {chip.label}
              <button type="button" aria-label={`Quitar filtro ${chip.label}`} onClick={() => clearChip(chip.key)}>
                <X size={12} />
              </button>
            </span>
          ))}
          <button type="button" className="sp-task-edit-filters" onClick={openSheet}>
            Editar
          </button>
        </div>
      ) : null}

      <div className="sp-task-resultbar">
        <span>
          {resultCount} {resultCount === 1 ? "tarea" : "tareas"}
        </span>
        {hasActiveTaskFilters(filters) ? (
          <button type="button" className="sp-clear-filter" onClick={() => onChange(EMPTY_TASK_FILTERS)}>
            <X size={13} />
            Limpiar
          </button>
        ) : null}
        <button
          type="button"
          className="sp-task-archived-link"
          onClick={onOpenArchived}
          aria-label={
            archivedCount === null
              ? "Ver tareas archivadas"
              : `Ver tareas archivadas (${archivedCount} finalizadas)`
          }
        >
          <Archive size={13} />
          Archivadas
          {archivedCount !== null ? <b>{archivedCount.toLocaleString("es-AR")}</b> : null}
        </button>
      </div>

      <TaskFilterSheet
        key={sheetKey}
        isOpen={isSheetOpen}
        filters={filters}
        members={members}
        onApply={onChange}
        onClose={() => setIsSheetOpen(false)}
      />
    </div>
  );
}
