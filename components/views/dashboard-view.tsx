"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  apiRequest,
  type ApiCommonOptions,
  type Client,
  type InsuranceCompany,
  type Notice,
  type Task
} from "@/lib/api";
import type { PolicyFormValues, Tab } from "@/lib/shell-types";
import { BalanceCard } from "@/components/dashboard/balance-card";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import {
  buildDaySummary,
  buildHeroSummary,
  buildNoticeSummary,
  buildTaskFeed,
  buildWorkGroups,
  firstNameOf,
  greetingForHour,
  heroPoseOf
} from "@/components/dashboard/dashboard-helpers";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { TaskFeed } from "@/components/dashboard/task-feed";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { ErrorState, LoadingState } from "@/components/ui/states";

const NO_TASKS: Task[] = [];

// Filas del listado de tareas; el resto se ve en Tareas.
const FEED_ROWS = 10;

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
  const hero = useMemo(() => buildHeroSummary(groups), [groups]);
  const feed = useMemo(() => buildTaskFeed(groups, FEED_ROWS), [groups]);
  const noticeSummary = useMemo(() => buildNoticeSummary(notices), [notices]);

  return (
    // Sin padding propio: el margen lateral y el aire contra el header ya los
    // pone .sp-workspace.
    <div className="sp-page padded db-page">
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando resumen operativo" /> : null}

      <BalanceCard
        greeting={greeting}
        firstName={firstName}
        summary={hero}
        notices={noticeSummary}
        pose={heroPoseOf(groups, tasksQuery.isLoading)}
        isLoading={tasksQuery.isLoading}
        ariaSummary={tasksQuery.data ? buildDaySummary(groups) : "Revisando tus tareas…"}
        onOpenGesti={() => setTab("gesti")}
        onOpenNotices={() => setTab("notices")}
      />

      <QuickActions
        toContact={noticeSummary.toContact}
        onNewTask={() => onOpenTasks(false)}
        onNewPolicy={() => setCreateOpen("policy")}
        onNewClient={() => setCreateOpen("client")}
        onOpenNotices={() => setTab("notices")}
        onOpenGesti={() => setTab("gesti")}
      />

      <TaskFeed
        sections={feed.sections}
        shown={feed.shown}
        total={feed.total}
        isLoading={tasksQuery.isLoading}
        error={tasksQuery.error ? tasksQuery.error.message : null}
        onOpenTask={onOpenTask}
        onOpenTasks={() => onOpenTasks(false)}
      />

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
