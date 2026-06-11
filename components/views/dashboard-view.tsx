"use client";

import { AlertTriangle, ArrowUpRight, Bell, CalendarDays, CheckCircle, ChevronRight, Clock, FileText, Phone, Plus, Users } from "lucide-react";
import { useState } from "react";
import { intervalLabel, type Client, type InsuranceCompany, type Notice, type Policy } from "@/lib/api";
import { capitalizeFirst, formatDate, getDaysUntilDue } from "@/lib/format";
import type { PolicyFormValues, Tab } from "@/lib/shell-types";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { DueChip } from "@/components/notices/shared";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

export function DashboardView({
  userName,
  notices,
  clients,
  policies,
  companies,
  isLoading,
  isCreatingClient,
  isCreatingPolicy,
  error,
  setTab,
  onCreateClient,
  onCreatePolicy
}: {
  userName: string;
  notices: Notice[];
  clients: Client[];
  policies: Policy[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  isCreatingClient: boolean;
  isCreatingPolicy: boolean;
  error: string | null;
  setTab: (tab: Tab) => void;
  onCreateClient: (body: Record<string, FormDataEntryValue>) => Promise<unknown>;
  onCreatePolicy: (values: PolicyFormValues) => Promise<unknown>;
}) {
  const [createOpen, setCreateOpen] = useState<"client" | "policy" | null>(null);
  const firstName = (userName || "").trim().split(/\s+/)[0] || "equipo";
  const todayLabel = capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())
  );
  const urgentNotices = notices.filter((notice) => notice.status !== "pagado" && getDaysUntilDue(notice.due_date) <= 7);
  const openNotices = notices.filter((notice) => notice.status !== "pagado");
  const notified = notices.filter((notice) => notice.status === "avisado");
  const paid = notices.filter((notice) => notice.status === "pagado");
  const nextNotice = notices
    .filter((notice) => notice.status !== "pagado")
    .sort((a, b) => getDaysUntilDue(a.due_date) - getDaysUntilDue(b.due_date))[0];
  const paidRatio = notices.length ? Math.round((paid.length / notices.length) * 100) : 0;
  const contactRatio = openNotices.length ? Math.round((notified.length / openNotices.length) * 100) : 0;
  const recentNotices = [...notices]
    .sort((a, b) => getDaysUntilDue(a.due_date) - getDaysUntilDue(b.due_date))
    .slice(0, 5);
  const recentPayments = paid
    .slice()
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .slice(0, 5);

  const stats = [
    {
      label: "Pendientes",
      sublabel: "avisos abiertos",
      value: openNotices.length,
      icon: AlertTriangle,
      tone: "warning",
      tab: "notices" as const
    },
    {
      label: "Urgentes",
      sublabel: "vencen en 7 días",
      value: urgentNotices.length,
      icon: Clock,
      tone: "danger",
      tab: "notices" as const
    },
    {
      label: "Pólizas",
      sublabel: "cartera activa",
      value: policies.length,
      icon: FileText,
      tone: "neutral",
      tab: "policies" as const
    },
    {
      label: "Asegurados",
      sublabel: "personas registradas",
      value: clients.length,
      icon: Users,
      tone: "neutral",
      tab: "clients" as const
    }
  ];

  const statusMetrics = [
    {
      label: "A contactar",
      value: notices.filter((notice) => notice.status === "avisar").length,
      color: "var(--sp-amber)"
    },
    {
      label: "Contactados",
      value: notified.length,
      color: "var(--sp-accent)"
    },
    {
      label: "Pagados",
      value: paid.length,
      color: "var(--sp-green)"
    }
  ];

  const quickActions = [
    {
      label: "Nueva póliza",
      description: "Cargá una póliza y sus avisos se generan solos",
      icon: FileText,
      onClick: () => setCreateOpen("policy")
    },
    {
      label: "Nuevo asegurado",
      description: "Sumá un cliente con sus datos de contacto",
      icon: Users,
      onClick: () => setCreateOpen("client")
    },
    {
      label: "Gestionar avisos",
      description: "Revisá vencimientos y registrá pagos",
      icon: Bell,
      onClick: () => setTab("notices")
    }
  ];

  return (
    <div className="sp-page padded grid gap-5 p-6">
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando resumen operativo" /> : null}

      <section className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 max-[900px]:flex-col">
        <div>
          <span className="text-xs font-semibold uppercase text-slate-500">{todayLabel}</span>
          <h2 className="m-0 mt-1 text-2xl font-semibold text-slate-950">Hola, {firstName} 👋</h2>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {clients.length === 0
              ? "Para empezar, cargá tu primer asegurado y después creá su póliza."
              : policies.length === 0
                ? "Ya tenés asegurados cargados: creá la primera póliza para generar sus avisos."
                : "Este es el estado de tu cartera y los últimos movimientos registrados."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-[900px]:w-full max-[900px]:flex-wrap max-[520px]:flex-col">
          <button type="button" className="sp-secondary-action" onClick={() => setCreateOpen("client")}>
            <Users size={15} />
            Nuevo asegurado
          </button>
          <button type="button" className="sp-primary-action" onClick={() => setCreateOpen("policy")}>
            <Plus size={15} />
            Nueva póliza
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <button
              key={stat.label}
              className={`flex min-h-28 items-start gap-3 rounded-lg border bg-white p-4 text-left transition-colors hover:bg-slate-50 ${stat.tone === "danger" ? "border-red-200" : stat.tone === "warning" ? "border-amber-200" : "border-slate-200"}`}
              type="button"
              onClick={() => setTab(stat.tab)}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${stat.tone === "danger" ? "bg-red-50 text-red-700" : stat.tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                <Icon size={18} />
              </span>
              <span className="grid min-w-0 gap-1">
                <em className="text-xs font-medium not-italic text-slate-500">{stat.label}</em>
                <strong className="text-3xl font-semibold leading-none text-slate-950">{stat.value}</strong>
                <small className="text-xs text-slate-500">{stat.sublabel}</small>
              </span>
            </button>
          );
        })}
      </section>

      {/* Fila 1: lo accionable primero — agenda de vencimientos y el más urgente */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Agenda inmediata</h2>
              <span>Vencimientos ordenados por prioridad</span>
            </div>
            <button type="button" onClick={() => setTab("notices")}>
              Ver todo
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="grid gap-1">
            {recentNotices.length === 0 ? (
              <EmptyState title="Sin avisos cargados" text="Cuando existan vencimientos, van a aparecer en esta lista." compact />
            ) : (
              recentNotices.map((notice) => {
                const client = notice.policies?.clients;
                const days = getDaysUntilDue(notice.due_date);
                return (
                  <button
                    key={notice.id}
                    className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
                    type="button"
                    onClick={() => setTab("notices")}
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-sm font-semibold text-slate-950">{client?.full_name ?? "Sin cliente"}</strong>
                      <em className="truncate text-xs not-italic text-slate-500">
                        {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                        {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
                      </em>
                    </span>
                    <span className="grid shrink-0 justify-items-end gap-0.5">
                      <DueChip days={days} status={notice.status} />
                      <em className="text-[11px] not-italic text-slate-400">{formatDate(notice.due_date)}</em>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <aside className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Próximo vencimiento</h2>
              <span>Prioridad operativa</span>
            </div>
            <CalendarDays size={18} />
          </div>
          {nextNotice ? (
            <div className="grid gap-3">
              <strong className="text-xl font-semibold leading-tight text-slate-950">
                {nextNotice.policies?.clients?.full_name ?? "Sin cliente"}
              </strong>
              <span className="text-sm text-slate-500">
                {nextNotice.policies?.insurance_companies?.name ?? "Sin compañía"}
                {nextNotice.policies?.policy_number ? ` · #${nextNotice.policies.policy_number}` : ""}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <DueChip days={getDaysUntilDue(nextNotice.due_date)} status={nextNotice.status} />
                <span className="text-xs font-medium text-slate-500">{formatDate(nextNotice.due_date)}</span>
              </div>
              {nextNotice.policies?.clients?.phone ? (
                <a
                  className="flex w-fit items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-[color:var(--org-primary)]"
                  href={`tel:${nextNotice.policies.clients.phone}`}
                >
                  <Phone size={12} />
                  {nextNotice.policies.clients.phone}
                </a>
              ) : null}
              <button type="button" className="sp-primary-action mt-1 w-fit" onClick={() => setTab("notices")}>
                Resolver
                <ArrowUpRight size={14} />
              </button>
            </div>
          ) : (
            <EmptyState title="Sin pendientes" text="No hay vencimientos abiertos para gestionar." compact />
          )}
        </aside>
      </section>

      {/* Fila 2: métricas de seguimiento + accesos rápidos de creación */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <article className="min-h-[280px] rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Seguimiento de avisos</h2>
              <span>{notices.length} avisos generados</span>
            </div>
            <button type="button" onClick={() => setTab("notices")}>
              Abrir avisos
              <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">Cobranza registrada</span>
              <strong className="text-lg font-semibold text-slate-950">{paidRatio}%</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${paidRatio}% de avisos pagados`}>
              <i className="block h-full rounded-full bg-[var(--org-primary)]" style={{ width: `${paidRatio}%` }} />
            </div>
          </div>

          <div className="my-3 grid gap-3 md:grid-cols-3">
            {statusMetrics.map((metric) => (
              <div key={metric.label} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4">
                <i className="h-1 w-10 rounded-full" style={{ backgroundColor: metric.color }} />
                <span className="text-xs font-medium text-slate-500">{metric.label}</span>
                <strong className="text-2xl font-semibold text-slate-950">{metric.value}</strong>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">Contactabilidad pendiente</span>
              <strong className="text-lg font-semibold text-slate-950">{contactRatio}%</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${contactRatio}% de avisos abiertos contactados`}>
              <i className="block h-full rounded-full bg-amber-600" style={{ width: `${contactRatio}%` }} />
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="sp-section-title">
            <div>
              <h2>Accesos rápidos</h2>
              <span>Creá registros sin salir del dashboard</span>
            </div>
          </div>
          <div className="grid gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-left transition-colors hover:border-[color:var(--org-primary)] hover:bg-slate-50"
                  type="button"
                  onClick={action.onClick}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--org-primary-soft)] text-[var(--org-primary)]">
                    <Icon size={16} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <strong className="text-sm font-semibold text-slate-950">{action.label}</strong>
                    <em className="text-xs not-italic leading-5 text-slate-500">{action.description}</em>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        </article>
      </section>

      {/* Fila 3: historial reciente */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="sp-section-title">
          <div>
            <h2>Últimos pagos</h2>
            <span>{paid.length} pagos registrados en total</span>
          </div>
          <button type="button" onClick={() => setTab("notices")}>
            Ver avisos
            <ArrowUpRight size={14} />
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
                  className="grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
                  type="button"
                  onClick={() => setTab("notices")}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--org-primary-soft)] text-[var(--org-primary)]">
                    <CheckCircle size={17} />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-sm font-semibold text-slate-950">{client?.full_name ?? "Sin cliente"}</strong>
                    <em className="truncate text-xs not-italic text-slate-500">
                      {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                      {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
                    </em>
                  </span>
                  <span className="grid justify-items-end gap-0.5 text-right">
                    <b className="text-xs font-semibold text-slate-700">{formatDate(notice.due_date)}</b>
                    {notice.paid_interval_months ? (
                      <em className="text-[11px] not-italic text-slate-400">{intervalLabel(notice.paid_interval_months)}</em>
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
