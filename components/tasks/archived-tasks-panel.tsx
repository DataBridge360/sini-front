"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, RotateCcw, Search, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  apiRequest,
  type ApiCommonOptions,
  type Paginated,
  type TaskListItem
} from "@/lib/api";
import { formatDate } from "@/lib/format";
import { PriorityChip } from "@/components/tasks/shared";
import { ConfirmDialog } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const PAGE_SIZE = 20;

// Tareas aprobadas y archivadas. Viven en su propia pantalla para que el tablero
// muestre solo trabajo vivo: si no, en unos meses el equipo scrollea cientos de
// tarjetas terminadas para encontrar las tres que importan.
//
// Paginación server-side porque este listado crece sin techo.
export function ArchivedTasksPanel({
  common,
  canModerate,
  totalCount,
  isUnarchiving,
  onBack,
  onOpen,
  onUnarchive
}: {
  common: ApiCommonOptions;
  canModerate: boolean;
  // Total de finalizadas sin filtrar, del COUNT del servidor. `null` mientras
  // viaja. Con búsqueda activa manda el total de la búsqueda, que es lo que se
  // está mirando.
  totalCount: number | null;
  isUnarchiving: boolean;
  onBack: () => void;
  onOpen: (task: TaskListItem) => void;
  onUnarchive: (taskId: string) => Promise<unknown>;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirming, setConfirming] = useState<TaskListItem | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ["tasks-archived", common.organizationSlug ?? "", page, debouncedSearch],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({
        archived: "1",
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiRequest<Paginated<TaskListItem>>(`/tasks?${params.toString()}`, common);
    }
  });

  const result = query.data;
  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Con búsqueda, el número que importa es el de la búsqueda; sin ella, el
  // total de la organización que ya trajo el recuento del tablero.
  const badgeCount = debouncedSearch ? (result ? total : null) : totalCount ?? (result ? total : null);

  return (
    <div className="sp-archived">
      <div className="sp-archived-head">
        <button type="button" className="sp-archived-back" onClick={onBack}>
          <ArrowLeft size={15} />
          <span>Volver al tablero</span>
        </button>
        <div className="sp-archived-heading">
          <h2>Archivadas</h2>
          {badgeCount === null ? null : (
            <span className="sp-archived-count">
              {badgeCount.toLocaleString("es-AR")}{" "}
              {debouncedSearch
                ? badgeCount === 1
                  ? "resultado"
                  : "resultados"
                : badgeCount === 1
                  ? "finalizada"
                  : "finalizadas"}
            </span>
          )}
        </div>
        <div className="sp-search sp-task-search">
          <Search size={15} />
          <input
            placeholder="Buscar por título..."
            value={search}
            aria-label="Buscar tareas archivadas"
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              className="sp-task-search-clear"
              aria-label="Borrar búsqueda"
              onClick={() => setSearch("")}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {query.error ? <ErrorState text={query.error.message} /> : null}
      {query.isLoading ? <LoadingState text="Cargando archivadas" /> : null}

      {!query.isLoading && !query.error && items.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? "Sin resultados" : "Sin tareas archivadas"}
          text={
            debouncedSearch
              ? "Ninguna tarea archivada coincide con esa búsqueda."
              : "Las tareas que un productor aprueba se guardan acá."
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="sp-archived-list">
            {items.map((task) => (
              <article
                key={task.id}
                className="sp-archived-row"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(task)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(task);
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="sp-archived-title">
                    <strong className="truncate">{task.title}</strong>
                    <PriorityChip priority={task.priority} />
                  </div>
                  <p className="sp-archived-meta">
                    {task.archived_at ? `Finalizada el ${formatDate(task.archived_at)}` : "Finalizada"}
                    {task.approved_by ? ` · Aprobada por ${task.approved_by.full_name}` : ""}
                  </p>
                  {task.clients || task.policies ? (
                    <div className="sp-archived-chips">
                      {task.clients ? (
                        <span>
                          <User size={10.5} />
                          {task.clients.full_name}
                        </span>
                      ) : null}
                      {task.policies ? (
                        <span>
                          <FileText size={10.5} />#{task.policies.policy_number}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {canModerate ? (
                  <button
                    type="button"
                    className="sp-archived-restore"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirming(task);
                    }}
                  >
                    <RotateCcw size={13} />
                    Desarchivar
                  </button>
                ) : null}
              </article>
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            start={(page - 1) * PAGE_SIZE}
            count={items.length}
            total={total}
            onChange={setPage}
          />
        </>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(confirming)}
        tone="warning"
        title="Desarchivar tarea"
        message={`«${confirming?.title ?? ""}» vuelve al tablero en la etapa En proceso.`}
        confirmLabel="Desarchivar"
        isBusy={isUnarchiving}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          void onUnarchive(confirming.id)
            .catch(() => undefined)
            .finally(() => setConfirming(null));
        }}
      />
    </div>
  );
}
