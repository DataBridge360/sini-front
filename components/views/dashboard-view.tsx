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
import { capitalizeFirst } from "@/lib/format";
import type { PolicyFormValues, Tab } from "@/lib/shell-types";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { Briefing } from "@/components/dashboard/briefing";
import {
  buildAgenda,
  buildDaySegments,
  buildSuggestions,
  buildUpcomingList,
  buildWorkGroups,
  firstNameOf,
  greetingForHour,
  type Suggestion
} from "@/components/dashboard/dashboard-helpers";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { ApprovalsCard, NoticesCard, UpcomingCard } from "@/components/dashboard/side-cards";
import { TodayList } from "@/components/dashboard/today-list";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { ErrorState, LoadingState } from "@/components/ui/states";

const NO_TASKS: Task[] = [];

// Lo que entra sin scroll en un escritorio de 900px de alto.
const AGENDA_ROWS = 7;
const APPROVAL_ROWS = 3;
const UPCOMING_ROWS = 4;

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
  const segments = tasksQuery.data
    ? buildDaySegments(groups)
    : [{ text: "Revisando tus tareas…" }];
  const suggestions = useMemo(() => buildSuggestions(groups), [groups]);
  const agenda = useMemo(() => buildAgenda(groups, AGENDA_ROWS), [groups]);
  const reviewItems = groups.find((group) => group.key === "review")?.items ?? [];
  const upcomingItems = useMemo(() => buildUpcomingList(groups, UPCOMING_ROWS), [groups]);
  const toContact = notices.filter((notice) => notice.status === "avisar").length;
  const showApprovals = canModerate && reviewItems.length > 0;

  function openSuggestion(suggestion: Suggestion) {
    if (suggestion.kind === "task") onOpenTask(suggestion.taskId);
    else setTab("gesti");
  }

  return (
    // Sin padding propio: el margen lateral y el aire contra el header ya los
    // pone .sp-workspace.
    <div className="sp-page padded db-page">
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando resumen operativo" /> : null}

      <Briefing
        dateLabel={todayLabel}
        greeting={greeting}
        firstName={firstName}
        segments={segments}
        suggestions={suggestions}
        onSuggestion={openSuggestion}
      />

      <QuickActions
        toContact={toContact}
        onNewTask={() => onOpenTasks(false)}
        onNewPolicy={() => setCreateOpen("policy")}
        onNewClient={() => setCreateOpen("client")}
        onOpenNotices={() => setTab("notices")}
        onOpenGesti={() => setTab("gesti")}
      />

      <div className="db-layout">
        <TodayList
          rows={agenda.rows}
          total={agenda.total}
          isLoading={tasksQuery.isLoading}
          error={tasksQuery.error ? tasksQuery.error.message : null}
          onOpenTask={onOpenTask}
          onOpenTasks={() => onOpenTasks(false)}
        />

        <aside className="db-aside">
          {showApprovals ? (
            <ApprovalsCard
              items={reviewItems.slice(0, APPROVAL_ROWS)}
              total={reviewItems.length}
              onOpenTask={onOpenTask}
              onOpenTasks={() => onOpenTasks(false)}
            />
          ) : null}
          <UpcomingCard items={upcomingItems} onOpenTask={onOpenTask} onOpenTasks={() => onOpenTasks(false)} />
          <NoticesCard notices={notices} onOpenNotices={() => setTab("notices")} />
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
