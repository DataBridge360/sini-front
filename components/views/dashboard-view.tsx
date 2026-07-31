"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bell, CheckCircle, FileText, ListTodo, Users } from "lucide-react";
import { useState } from "react";
import {
  apiRequest,
  intervalLabel,
  type ApiCommonOptions,
  type Client,
  type InsuranceCompany,
  type Notice,
  type Task
} from "@/lib/api";
import { capitalizeFirst, formatDate, getDaysUntilDue } from "@/lib/format";
import type { PolicyFormValues, Tab } from "@/lib/shell-types";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { TaskCalendar } from "@/components/dashboard/task-calendar";
import { TaskStatsCard } from "@/components/dashboard/task-stats-card";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

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
  onOpenTasks: (archived: boolean) => void;
  onCreateClient: (body: Record<string, FormDataEntryValue>) => Promise<unknown>;
  onCreatePolicy: (values: PolicyFormValues) => Promise<unknown>;
}) {
  const [createOpen, setCreateOpen] = useState<"client" | "policy" | null>(null);
  const firstName = (userName || "").trim().split(/\s+/)[0] || "equipo";
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

  const openNotices = notices.filter((notice) => notice.status !== "pagado");
  const urgentNotices = openNotices.filter((notice) => getDaysUntilDue(notice.due_date) <= 7);
  const toContact = notices.filter((notice) => notice.status === "avisar");
  const notified = notices.filter((notice) => notice.status === "avisado");
  const paid = notices.filter((notice) => notice.status === "pagado");
  const paidRatio = notices.length ? Math.round((paid.length / notices.length) * 100) : 0;
  const recentPayments = paid
    .slice()
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .slice(0, 6);

  const quickActions = [
    {
      label: "Nueva póliza",
      icon: FileText,
      onClick: () => setCreateOpen("policy")
    },
    {
      label: "Nuevo asegurado",
      icon: Users,
      onClick: () => setCreateOpen("client")
    },
    {
      label: "Avisos",
      icon: Bell,
      onClick: () => setTab("notices")
    },
    {
      label: "Tareas",
      icon: ListTodo,
      onClick: () => onOpenTasks(false)
    }
  ];

  return (
    // Sin padding propio: el margen lateral y el aire contra el header ya los
    // pone .sp-workspace. Sumarle p-6 encima era lo que abría el hueco.
    <div className="sp-page padded grid gap-4 px-0 pb-8 md:gap-5">
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando resumen operativo" /> : null}

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-xl font-bold text-slate-950">Hola, {firstName} 👋</h2>
        <span className="text-xs font-semibold text-slate-400">{todayLabel}</span>
      </div>

      <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Tarjeta principal estilo billetera: el "saldo" son los avisos abiertos */}
          <article className="sp-wallet-card flex flex-col">
            <div className="sp-wallet-card-top">
              <div>
                <span>Seguimiento de avisos</span>
                <strong>{openNotices.length}</strong>
                <em>
                  {openNotices.length === 1 ? "aviso abierto" : "avisos abiertos"}
                  {urgentNotices.length > 0 ? ` · ${urgentNotices.length} por vencer esta semana` : ""}
                </em>
              </div>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-xs font-bold text-white backdrop-blur transition-colors hover:bg-white/25"
                onClick={() => setTab("notices")}
              >
                Gestionar
                <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="mt-auto">
              <div className="mt-6 flex items-center justify-between text-xs font-semibold text-white/70">
                <span>Cobranza registrada</span>
                <span className="text-white">{paidRatio}%</span>
              </div>
              {/* utilities pisan a components en el cascade: mt-2 anula el mt-10 del componente */}
              <div className="sp-wallet-progress mt-2">
                <span style={{ width: `${paidRatio}%` }} />
              </div>
              <div className="sp-wallet-card-bottom">
                <div>
                  <span>A contactar</span>
                  <strong className="text-lg font-bold text-white">{toContact.length}</strong>
                </div>
                <div>
                  <span>Contactados</span>
                  <strong className="text-lg font-bold text-white">{notified.length}</strong>
                </div>
                <div>
                  <span>Pagados</span>
                  <strong className="text-lg font-bold text-white">{paid.length}</strong>
                </div>
              </div>
            </div>
          </article>

          {/* Accesos rápidos estilo billetera: acciones circulares */}
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
            <h2 className="m-0 mb-4 text-sm font-bold text-slate-900">Accesos rápidos</h2>
            <div className="grid grid-cols-4 gap-2 max-[520px]:grid-cols-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    className="group flex flex-col items-center gap-2.5 rounded-xl px-2 py-3 transition-colors hover:bg-slate-50"
                    onClick={action.onClick}
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--org-primary-soft)] text-[var(--org-primary)] transition-transform group-hover:scale-110">
                      <Icon size={19} />
                    </span>
                    <span className="text-center text-[11.5px] font-semibold leading-tight text-slate-700">
                      {action.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </article>
        </div>

        {/* Columna de tareas: primero cuánto hay, después cuándo vence. Los
            recuentos salen de /tasks/stats (COUNT server-side) y el calendario
            de las activas que ya están en memoria. */}
        <div className="flex min-w-0 flex-col gap-5">
          <TaskStatsCard
            common={common}
            currentUserId={currentUserId}
            canModerate={canModerate}
            onOpenTasks={onOpenTasks}
          />
          <TaskCalendar tasks={tasks} onOpenTasks={() => onOpenTasks(false)} />
        </div>
      </section>

      {/* Últimos pagos: lista estilo movimientos de billetera */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-sm font-bold text-slate-900">Últimos pagos</h2>
            <span className="text-xs text-slate-400">{paid.length} pagos registrados en total</span>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-bold text-[var(--org-primary)] transition-opacity hover:opacity-80"
            onClick={() => setTab("notices")}
          >
            Ver avisos
            <ArrowUpRight size={13} />
          </button>
        </div>
        {recentPayments.length === 0 ? (
          <EmptyState title="Sin pagos registrados" text="Cuando marques un aviso como pagado, vas a verlo acá." compact />
        ) : (
          <div className="grid gap-1">
            {recentPayments.map((notice) => {
              const client = notice.policies?.clients;
              return (
                <button
                  key={notice.id}
                  className="grid cursor-pointer grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                  type="button"
                  onClick={() => setTab("notices")}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle size={18} />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-[13.5px] font-semibold text-slate-950">
                      {client?.full_name ?? "Sin cliente"}
                    </strong>
                    <em className="truncate text-xs not-italic text-slate-500">
                      {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                      {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
                    </em>
                  </span>
                  <span className="grid justify-items-end gap-0.5 text-right">
                    <b className="text-xs font-semibold text-slate-700">{formatDate(notice.due_date)}</b>
                    {notice.paid_interval_months ? (
                      <em className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold not-italic text-emerald-700">
                        {intervalLabel(notice.paid_interval_months)}
                      </em>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <ClientCreateModal
        isOpen={createOpen === "client"}
        isCreating={isCreatingClient}
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
        onClose={() => setCreateOpen(null)}
        onSubmit={async (values) => {
          await onCreatePolicy(values);
          setCreateOpen(null);
        }}
      />
    </div>
  );
}
