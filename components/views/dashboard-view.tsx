"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, Users } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import {
  apiRequest,
  type ApiCommonOptions,
  type Client,
  type InsuranceCompany,
  type Notice,
  type Task
} from "@/lib/api";
import { capitalizeFirst } from "@/lib/format";
import type { PolicyFormValues, Tab } from "@/lib/shell-types";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { buildDaySummary, buildWorkGroups, firstNameOf, greetingForHour } from "@/components/dashboard/dashboard-helpers";
import { MyWorkPanel } from "@/components/dashboard/my-work-panel";
import { NoticesSummary } from "@/components/dashboard/notices-summary";
import { TaskCalendar } from "@/components/dashboard/task-calendar";
import { TaskStatsCard } from "@/components/dashboard/task-stats-card";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { ErrorState, LoadingState } from "@/components/ui/states";

const NO_TASKS: Task[] = [];

export function DashboardView({
  userName,
  common,
  currentUserId,
  canModerate,
  notices,
  clients,
  companies,
  isLoading,
  isCreatingClient,
  isCreatingPolicy,
  error,
  setTab,
  onOpenTask,
  onOpenTasks,
  onCreateClient,
  onCreatePolicy
}: {
  userName: string;
  common: ApiCommonOptions;
  currentUserId: string;
  // Productor: puede mirar la carga de cualquier persona del equipo.
  canModerate: boolean;
  notices: Notice[];
  clients: Client[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  isCreatingClient: boolean;
  isCreatingPolicy: boolean;
  error: string | null;
  setTab: (tab: Tab) => void;
  // Abre Tareas con el detalle de esa tarea.
  onOpenTask: (taskId: string) => void;
  onOpenTasks: (archived: boolean) => void;
  onCreateClient: (body: Record<string, FormDataEntryValue>) => Promise<Client>;
  onCreatePolicy: (values: PolicyFormValues) => Promise<unknown>;
}) {
  const [createOpen, setCreateOpen] = useState<"client" | "policy" | null>(null);
  const firstName = firstNameOf(userName);
  const todayLabel = capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())
  );

  // Misma queryKey que la vista de tareas: comparten caché y no se duplica el fetch.
  const tasksQuery = useQuery({
    queryKey: ["tasks", common.organizationSlug ?? ""],
    enabled: Boolean(common.token && common.organizationSlug),
    staleTime: 60_000,
    retry: 1,
    queryFn: () => apiRequest<Task[]>("/tasks", common)
  });
  const tasks = tasksQuery.data ?? NO_TASKS;

  const groups = useMemo(
    () => buildWorkGroups(tasks, { currentUserId, canModerate }),
    [tasks, currentUserId, canModerate]
  );
  const greeting = greetingForHour(new Date().getHours());
  const summary = tasksQuery.data ? buildDaySummary(groups) : "Revisando tus tareas…";

  return (
    // Sin padding propio: el margen lateral y el aire contra el header ya los
    // pone .sp-workspace.
    <div className="sp-page padded db-page">
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando resumen operativo" /> : null}

      <header className="db-hello">
        <div className="db-hello-text">
          <span>{todayLabel}</span>
          <h2>
            {greeting}, {firstName}
          </h2>
          <p>{summary}</p>
        </div>
        <div className="db-actions">
          <button type="button" className="db-gesti" onClick={() => setTab("gesti")}>
            <Image src="/gesti/gesti-avatar.webp" alt="" width={28} height={28} />
            Preguntale a Gesti
          </button>
          <button type="button" className="db-action" onClick={() => setCreateOpen("policy")}>
            <FileText size={15} />
            Nueva póliza
          </button>
          <button type="button" className="db-action" onClick={() => setCreateOpen("client")}>
            <Users size={15} />
            Nuevo asegurado
          </button>
        </div>
      </header>

      <div className="db-layout">
        <MyWorkPanel
          groups={groups}
          isLoading={tasksQuery.isLoading}
          error={tasksQuery.error ? tasksQuery.error.message : null}
          onOpenTask={onOpenTask}
          onOpenTasks={() => onOpenTasks(false)}
        />

        {/* Lo secundario: avisos compactos, recuento por etapa (COUNT en el
            servidor, /tasks/stats) y calendario de las activas en memoria. */}
        <aside className="db-aside">
          <NoticesSummary notices={notices} onOpenNotices={() => setTab("notices")} />
          <TaskStatsCard
            common={common}
            currentUserId={currentUserId}
            canModerate={canModerate}
            onOpenTasks={onOpenTasks}
          />
          <TaskCalendar tasks={tasks} onOpenTasks={() => onOpenTasks(false)} />
        </aside>
      </div>

      <ClientCreateModal
        isOpen={createOpen === "client"}
        isCreating={isCreatingClient}
        common={common}
        onClose={() => setCreateOpen(null)}
        onCreate={onCreateClient}
      />
      <PolicyFormModal
        key={createOpen === "policy" ? "dashboard-policy-open" : "dashboard-policy-closed"}
        title="Nueva póliza"
        submitLabel="Guardar póliza"
        isOpen={createOpen === "policy"}
        policy={null}
        clients={clients}
        companies={companies}
        isSaving={isCreatingPolicy}
        common={common}
        isCreatingClient={isCreatingClient}
        onCreateClient={onCreateClient}
        onClose={() => setCreateOpen(null)}
        onSubmit={async (values) => {
          await onCreatePolicy(values);
          setCreateOpen(null);
        }}
      />
    </div>
  );
}
