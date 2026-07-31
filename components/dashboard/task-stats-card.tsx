"use client";

import { useQuery } from "@tanstack/react-query";
import { ListTodo } from "lucide-react";
import { useState } from "react";
import {
  apiRequest,
  type ApiCommonOptions,
  type OrganizationMember,
  type TaskStats,
  type TaskStatus
} from "@/lib/api";
import { TASK_STATUS_META } from "@/lib/tasks";

const NO_MEMBERS: OrganizationMember[] = [];

// Las cuatro etapas del flujo, en orden. Las tres primeras son trabajo vivo; la
// última es el acumulado histórico, que es justamente el que no se puede contar
// trayendo filas.
const TILE_STATUSES: TaskStatus[] = ["pendiente", "en_proceso", "revision", "finalizado"];

// "me" | "all" | id de la persona (solo productores).
type Scope = string;

// Recuento de tareas por etapa.
//
// Los números vienen de GET /tasks/stats (COUNT en el servidor), nunca de
// contar el listado: las finalizadas crecen sin techo y el tablero solo trae
// las activas. Cambiar de alcance es otro request de cuatro COUNT, no una
// descarga más grande.
export function TaskStatsCard({
  common,
  currentUserId,
  canModerate,
  onOpenTasks
}: {
  common: ApiCommonOptions;
  currentUserId: string;
  canModerate: boolean;
  // `archived` abre directamente la vista Archivadas en lugar del tablero.
  onOpenTasks: (archived: boolean) => void;
}) {
  const slug = common.organizationSlug ?? "";
  const [scope, setScope] = useState<Scope>("me");
  const isEnabled = Boolean(common.token && slug);

  // Solo un productor puede mirar la carga de otra persona; el resto ve lo suyo
  // o el total del equipo.
  const members = useQuery({
    queryKey: ["organization-members", slug],
    enabled: isEnabled && canModerate,
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiRequest<OrganizationMember[]>("/organizations/current/members", common)
  });
  const allMembers = members.data ?? NO_MEMBERS;

  const assignedTo = scope === "all" ? null : scope === "me" ? currentUserId : scope;
  const personScope = scope !== "all" && scope !== "me" ? scope : null;

  // La clave usa el id real y no el alias "me": así "Mis tareas" y elegirse a
  // uno mismo en la lista comparten caché en lugar de pedir lo mismo dos veces.
  const stats = useQuery({
    queryKey: ["task-stats", slug, assignedTo ?? "all"],
    enabled: isEnabled,
    staleTime: 60_000,
    queryFn: () => {
      const query = assignedTo ? `?assignedTo=${encodeURIComponent(assignedTo)}` : "";
      return apiRequest<TaskStats>(`/tasks/stats${query}`, common);
    }
  });

  // Solo cuando se está mirando a otra persona: "Mis tareas" y "Todas" ya se
  // leen en el segmentado, y repetirlas debajo del título no agrega nada. El
  // nombre sí, porque con una persona elegida el segmentado no marca ninguna.
  const personLabel = personScope
    ? allMembers.find((member) => member.id === personScope)?.full_name ?? "Persona del equipo"
    : null;

  return (
    <article className="sp-task-stats">
      <header className="sp-task-stats-head">
        <div className="sp-task-stats-title">
          <span className="sp-task-stats-icon">
            <ListTodo size={15} />
          </span>
          <div className="min-w-0">
            <h2>Tareas</h2>
            {personLabel ? <span className="truncate">{personLabel}</span> : null}
          </div>
        </div>

        <div className="sp-task-stats-scope">
          <div className="sp-task-chip-group">
            <button
              type="button"
              className="sp-task-chip"
              aria-pressed={scope === "me"}
              onClick={() => setScope("me")}
            >
              Mis tareas
            </button>
            <button
              type="button"
              className="sp-task-chip"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              Todas
            </button>
          </div>

          {canModerate ? (
            <select
              className="sp-task-stats-person"
              aria-label="Ver las tareas de una persona"
              value={personScope ?? ""}
              // Elegirse a uno mismo en la lista es "Mis tareas": se normaliza
              // para que el segmentado no quede sin ninguna opción marcada
              // mostrando exactamente lo mismo.
              onChange={(event) => {
                const value = event.target.value;
                setScope(!value || value === currentUserId ? "me" : value);
              }}
            >
              <option value="">Por persona…</option>
              {allMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {stats.error ? (
        <p className="sp-task-stats-error" role="alert">
          {stats.error.message}
        </p>
      ) : null}

      <div className="sp-task-stats-grid">
        {TILE_STATUSES.map((status) => {
          const meta = TASK_STATUS_META[status];
          const value = stats.data?.[status];
          const isArchived = status === "finalizado";

          return (
            <button
              key={status}
              type="button"
              className="sp-task-stat"
              onClick={() => onOpenTasks(isArchived)}
            >
              <span className="sp-task-stat-label">
                <i style={{ backgroundColor: meta.dot }} />
                {isArchived ? "Finalizadas" : meta.label}
              </span>
              {value === undefined ? (
                <span className="sp-task-stat-skeleton" aria-hidden="true" />
              ) : (
                <strong>{value.toLocaleString("es-AR")}</strong>
              )}
            </button>
          );
        })}
      </div>

      <p className="sp-task-stats-foot">
        {stats.data
          ? `${stats.data.activas.toLocaleString("es-AR")} ${
              stats.data.activas === 1 ? "tarea abierta" : "tareas abiertas"
            } entre pendientes, en proceso y en revisión.`
          : "Cargando recuentos…"}
      </p>
    </article>
  );
}
