"use client";

import { Bell, CalendarDays, Check, CheckCircle, FileText, Layers, Loader2, Phone, RotateCcw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { intervalLabel, type InsuranceCompany, type Notice } from "@/lib/api";
import { readView, writeView } from "@/lib/browser";
import { avatarColor, capitalizeFirst, dueLabel, formatDate, getDaysUntilDue, initials } from "@/lib/format";
import {
  clusterNoticesByClient,
  EMPTY_NOTICE_FILTERS,
  isNoticeInWindow,
  matchesNoticeFilters,
  noticeStatusLabel,
  noticeStatusPill,
  type NoticeFilters,
  type NoticeView
} from "@/lib/notices";
import { BRANCHES, type NoticeNoteApi } from "@/lib/shell-types";
import { DueChip, NOTICE_COLUMNS, NoticeAudit, NoticeNotes } from "@/components/notices/shared";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ViewToggle } from "@/components/ui/view-toggle";

export function NoticesView({
  notices,
  companies,
  isLoading,
  markingNoticeId,
  payingNoticeId,
  revertingNoticeId,
  error,
  noteApi,
  onNotified,
  onRevert,
  onPay,
  onViewPolicy
}: {
  notices: Notice[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  revertingNoticeId: string | null;
  error: string | null;
  noteApi: NoticeNoteApi;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onPay: (id: string, months: number) => Promise<unknown>;
  onViewPolicy: (notice: Notice) => void;
}) {
  const [filters, setFilters] = useState<NoticeFilters>(EMPTY_NOTICE_FILTERS);
  const [view, setView] = useState<NoticeView>(() => readView("sp-notices-view", "kanban"));
  const [payNoticeTarget, setPayNoticeTarget] = useState<Notice | null>(null);
  const [detailNotice, setDetailNotice] = useState<Notice | null>(null);

  const branches = useMemo(() => {
    const fromData = notices.map((notice) => notice.policies?.branch).filter(Boolean) as string[];
    return Array.from(new Set([...BRANCHES, ...fromData]));
  }, [notices]);

  const filtered = useMemo(
    () => notices.filter((notice) => isNoticeInWindow(notice) && matchesNoticeFilters(notice, filters)),
    [notices, filters]
  );

  const grouped = useMemo(
    () => ({
      avisar: filtered.filter((notice) => notice.status === "avisar"),
      avisado: filtered.filter((notice) => notice.status === "avisado"),
      pagado: filtered.filter((notice) => notice.status === "pagado")
    }),
    [filtered]
  );

  // Vencimientos del mismo asegurado a ≤5 días entre sí: una sola tarjeta agrupada.
  const clustered = useMemo(
    () => ({
      avisar: clusterNoticesByClient(grouped.avisar),
      avisado: clusterNoticesByClient(grouped.avisado),
      pagado: clusterNoticesByClient(grouped.pagado)
    }),
    [grouped]
  );

  return (
    <div className="sp-page flush">
      <FiltersPanel
        companies={companies}
        branches={branches}
        filters={filters}
        onChange={setFilters}
      />

      <div className="sp-board-toolbar">
        <span>{isLoading ? "Cargando..." : `${filtered.length} avisos`}</span>
        <ViewToggle
          leftLabel="Kanban"
          rightLabel="Lista"
          value={view}
          leftValue="kanban"
          rightValue="list"
          onChange={(next) => {
            setView(next);
            writeView("sp-notices-view", next);
          }}
        />
      </div>

      <div className="sp-board-area">
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando avisos" /> : null}
        {!isLoading && view === "kanban" ? (
          <div className="sp-kanban">
            {NOTICE_COLUMNS.map((column) => (
              <section
                key={column.key}
                className="sp-kanban-column border-t-[3px]"
                style={{ borderTopColor: column.dot }}
              >
                <header>
                  <div className="min-w-0">
                    <i className="shrink-0" style={{ backgroundColor: column.dot }} />
                    <h3 className="shrink-0">{column.label}</h3>
                    <em className="ml-1 hidden truncate text-[11px] font-normal not-italic text-slate-400 min-[1100px]:inline">
                      {column.hint}
                    </em>
                  </div>
                  <span
                    className="shrink-0"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${column.dot} 16%, transparent)`,
                      color: column.dot
                    }}
                  >
                    {grouped[column.key].length}
                  </span>
                </header>
                <div className="sp-kanban-scroll">
                  {clustered[column.key].length === 0 ? (
                    <EmptyState title="Sin avisos" compact />
                  ) : (
                    clustered[column.key].map((cluster) =>
                      cluster.length === 1 && cluster[0] ? (
                        <NoticeCard
                          key={cluster[0].id}
                          notice={cluster[0]}
                          isMarkingNotified={markingNoticeId === cluster[0].id}
                          isPaying={payingNoticeId === cluster[0].id}
                          isReverting={revertingNoticeId === cluster[0].id}
                          noteApi={noteApi}
                          onNotified={onNotified}
                          onRevert={onRevert}
                          onRequestPay={setPayNoticeTarget}
                          onOpenDetail={setDetailNotice}
                        />
                      ) : (
                        <NoticeGroupCard
                          key={cluster.map((notice) => notice.id).join("|")}
                          notices={cluster}
                          markingNoticeId={markingNoticeId}
                          payingNoticeId={payingNoticeId}
                          revertingNoticeId={revertingNoticeId}
                          onNotified={onNotified}
                          onRevert={onRevert}
                          onRequestPay={setPayNoticeTarget}
                          onOpenDetail={setDetailNotice}
                        />
                      )
                    )
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel">
            {filtered.length === 0 ? (
              <EmptyState title="No hay avisos para mostrar" text="Probá limpiar filtros o revisar otro rango de vencimientos." />
            ) : (
              <>
                <div className="sp-list-header notice">
                  <span>Cliente y póliza</span>
                  <span>Rama</span>
                  <span>Vencimiento</span>
                  <span>Acciones</span>
                </div>
                {filtered.map((notice) => (
                  <NoticeListRow
                    key={notice.id}
                    notice={notice}
                    isMarkingNotified={markingNoticeId === notice.id}
                    isPaying={payingNoticeId === notice.id}
                    isReverting={revertingNoticeId === notice.id}
                    onNotified={onNotified}
                    onRevert={onRevert}
                    onRequestPay={setPayNoticeTarget}
                    onOpenDetail={setDetailNotice}
                  />
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>

      <PaymentDialog
        key={payNoticeTarget?.id ?? "pay-dialog"}
        notice={payNoticeTarget}
        isPaying={Boolean(payNoticeTarget && payingNoticeId === payNoticeTarget.id)}
        onClose={() => setPayNoticeTarget(null)}
        onConfirm={async (months) => {
          if (!payNoticeTarget) return;
          await onPay(payNoticeTarget.id, months);
          setPayNoticeTarget(null);
        }}
      />

      <NoticeDetailModal
        notice={detailNotice}
        onClose={() => setDetailNotice(null)}
        onViewPolicy={(notice) => {
          setDetailNotice(null);
          onViewPolicy(notice);
        }}
      />
    </div>
  );
}

function NoticeDetailModal({
  notice,
  onClose,
  onViewPolicy
}: {
  notice: Notice | null;
  onClose: () => void;
  onViewPolicy: (notice: Notice) => void;
}) {
  if (!notice) {
    return <Modal title="Detalle del aviso" isOpen={false} onClose={onClose}><div /></Modal>;
  }

  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);
  const dueColor =
    notice.status === "pagado" ? "text-emerald-600" : days < 0 ? "text-red-600" : days <= 7 ? "text-amber-600" : "text-slate-600";

  const rows: Array<{ label: string; value: string | null; href?: string | undefined }> = [
    { label: "Compañía", value: company?.name ?? null },
    { label: "N° de póliza", value: notice.policies?.policy_number || null },
    { label: "Rama", value: notice.policies?.branch || null },
    { label: "Patente", value: notice.policies?.vehicle_plate || null },
    { label: "Teléfono", value: client?.phone ?? null, href: client?.phone ? `tel:${client.phone}` : undefined },
    { label: "Email", value: client?.email ?? null, href: client?.email ? `mailto:${client.email}` : undefined }
  ];
  const visibleRows = rows.filter((row) => row.value);

  return (
    <Modal title="Detalle del aviso" isOpen={Boolean(notice)} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-lg font-bold text-slate-900">{client?.full_name ?? "Sin cliente"}</h3>
            <p className="mt-0.5 text-sm font-semibold">
              <span className={dueColor}>{dueLabel(days)}</span>
              <span className="text-slate-400"> · {formatDate(notice.due_date)}</span>
            </p>
          </div>
          <span className={noticeStatusPill(notice.status)}>{noticeStatusLabel(notice.status)}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
          {visibleRows.map((row) => (
            <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.label}</span>
              {row.href ? (
                <a className="truncate text-sm font-medium text-slate-800 hover:text-[color:var(--org-primary)]" href={row.href}>{row.value}</a>
              ) : (
                <span className="truncate text-sm font-medium text-slate-800">{row.value}</span>
              )}
            </div>
          ))}
          {notice.status === "pagado" && notice.paid_interval_months ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Periodicidad pagada</span>
              <span className="truncate text-sm font-medium text-slate-800">{intervalLabel(notice.paid_interval_months)}</span>
            </div>
          ) : null}
        </div>

        {notice.notified_by || notice.payment_processed_by ? (
          <div className="flex flex-col gap-1.5">
            {notice.notified_by ? (
              <p className="m-0 flex items-center gap-1.5 text-xs text-slate-500">
                <Bell size={13} className="text-blue-500" />
                Avisado por <strong className="font-semibold text-slate-700">{notice.notified_by.full_name}</strong>
                {notice.notified_at ? <span className="text-slate-400">· {formatDate(notice.notified_at.slice(0, 10))}</span> : null}
              </p>
            ) : null}
            {notice.payment_processed_by ? (
              <p className="m-0 flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle size={13} className="text-emerald-500" />
                Cobrado por <strong className="font-semibold text-slate-700">{notice.payment_processed_by.full_name}</strong>
                {notice.payment_processed_at ? <span className="text-slate-400">· {formatDate(notice.payment_processed_at.slice(0, 10))}</span> : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {client?.notes ? (
          <div className="rounded-lg border-l-2 border-amber-300 bg-amber-50 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Nota del asegurado</span>
            <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-snug text-amber-900">{client.notes}</p>
          </div>
        ) : null}

        {notice.notes && notice.notes.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notas internas</span>
            {notice.notes.map((note) => (
              <p key={note.id} className="m-0 rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] leading-snug text-slate-600">
                <strong className="font-semibold text-slate-700">{note.user?.full_name ?? "Usuario"}:</strong> {note.note}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" className="sp-secondary-action" onClick={onClose}>Cerrar</button>
          <button type="button" className="sp-primary-action" onClick={() => onViewPolicy(notice)}>
            <FileText size={14} />
            Ver póliza
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FiltersPanel({
  companies,
  branches,
  filters,
  onChange
}: {
  companies: InsuranceCompany[];
  branches: string[];
  filters: NoticeFilters;
  onChange: (filters: NoticeFilters) => void;
}) {
  const hasFilters = Object.entries(filters).some(([key, value]) => {
    if (key === "companyId" || key === "branch" || key === "status") return value !== "all";
    return Boolean(value);
  });

  const update = (key: keyof NoticeFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="sp-filters">
      <div className="sp-search">
        <Search size={15} />
        <input
          placeholder="Cliente, póliza N°, patente..."
          value={filters.search}
          onChange={(event) => update("search", event.target.value)}
        />
      </div>
      <select value={filters.companyId} onChange={(event) => update("companyId", event.target.value)}>
        <option value="all">Todas las compañías</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <select value={filters.branch} onChange={(event) => update("branch", event.target.value)}>
        <option value="all">Todas las ramas</option>
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
      <select value={filters.status} onChange={(event) => update("status", event.target.value)}>
        <option value="all">Todos</option>
        <option value="avisar">Avisar</option>
        <option value="avisado">Avisado</option>
        <option value="pagado">Pagado</option>
      </select>
      <DatePicker
        value={filters.dateFrom}
        onChange={(value) => update("dateFrom", value)}
        placeholder="Desde"
        ariaLabel="Desde"
      />
      <DatePicker
        value={filters.dateTo}
        onChange={(value) => update("dateTo", value)}
        placeholder="Hasta"
        ariaLabel="Hasta"
      />
      {hasFilters ? (
        <button className="sp-clear-filter" type="button" onClick={() => onChange(EMPTY_NOTICE_FILTERS)}>
          <X size={14} />
          Limpiar
        </button>
      ) : null}
    </div>
  );
}

function NoticeCard({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  noteApi,
  onNotified,
  onRevert,
  onRequestPay,
  onOpenDetail
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  noteApi: NoticeNoteApi;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);
  const clientName = client?.full_name ?? "Sin cliente";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      {/* Cuerpo clickeable: abre el detalle del aviso */}
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary-soft)]"
        onClick={() => onOpenDetail(notice)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetail(notice);
          }
        }}
      >
        {/* Cabecera estilo billetera: avatar circular + titular + chip de urgencia */}
        <div className="flex items-start gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: avatarColor(clientName) }}
          >
            {initials(clientName)}
          </span>
          <span className="min-w-0 flex-1">
            <h4 className="m-0 truncate text-[13.5px] font-semibold leading-snug text-slate-900">{clientName}</h4>
            <p className="m-0 truncate text-[11.5px] text-slate-500">
              {company?.name ?? "Sin compañía"}
              {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
            </p>
          </span>
          <DueChip days={days} status={notice.status} />
        </div>

        {/* Pills de datos: fecha, rama, patente y teléfono */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-500">
            <CalendarDays size={10.5} className="shrink-0" />
            {formatDate(notice.due_date)}
          </span>
          {notice.policies?.branch ? (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {notice.policies.branch}
            </span>
          ) : null}
          {notice.policies?.vehicle_plate ? (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-500">
              {notice.policies.vehicle_plate}
            </span>
          ) : null}
          {client?.phone ? (
            <a
              href={`tel:${client.phone}`}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-w-0 items-center gap-1 rounded-full bg-[color:var(--org-primary-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--org-primary)] transition-opacity hover:opacity-80"
            >
              <Phone size={10.5} className="shrink-0" />
              <span className="truncate">{client.phone}</span>
            </a>
          ) : null}
        </div>

        {/* Estado (avisó / cobró) de forma sutil */}
        <NoticeAudit notice={notice} />

        {/* Nota del asegurado (solo lectura desde el aviso) */}
        {client?.notes ? (
          <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-2 text-[11px] leading-snug text-slate-400">
            {client.notes}
          </p>
        ) : null}
      </div>

      {/* Notas del aviso (editables, colapsadas y sutiles) */}
      <NoticeNotes notice={notice} noteApi={noteApi} />

      <NoticeActions
        notice={notice}
        isMarkingNotified={isMarkingNotified}
        isPaying={isPaying}
        isReverting={isReverting}
        onNotified={onNotified}
        onRevert={onRevert}
        onRequestPay={onRequestPay}
      />
    </article>
  );
}

// Tarjeta agrupada: varios vencimientos del mismo asegurado a ≤5 días entre sí.
// Se lo contacta una sola vez; el pago se registra por póliza.
function NoticeGroupCard({
  notices,
  markingNoticeId,
  payingNoticeId,
  revertingNoticeId,
  onNotified,
  onRevert,
  onRequestPay,
  onOpenDetail
}: {
  notices: Notice[];
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  revertingNoticeId: string | null;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
}) {
  const first = notices[0];
  if (!first) return null;
  const client = first.policies?.clients;
  const clientName = client?.full_name ?? "Sin cliente";
  const status = first.status;
  const minDays = Math.min(...notices.map((notice) => getDaysUntilDue(notice.due_date)));
  const busy = notices.some(
    (notice) =>
      markingNoticeId === notice.id || payingNoticeId === notice.id || revertingNoticeId === notice.id
  );
  const spin = <Loader2 size={13} className="animate-spin" />;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ backgroundColor: avatarColor(clientName) }}
        >
          {initials(clientName)}
        </span>
        <span className="min-w-0 flex-1">
          <h4 className="m-0 truncate text-[13.5px] font-semibold leading-snug text-slate-900">{clientName}</h4>
          <p className="m-0 flex items-center gap-1 truncate text-[11.5px] text-slate-500">
            <Layers size={11} className="shrink-0" />
            {notices.length} pólizas vencen juntas
          </p>
        </span>
        <DueChip days={minDays} status={status} />
      </div>

      {client?.phone ? (
        <div className="mt-2 flex">
          <a
            href={`tel:${client.phone}`}
            className="inline-flex min-w-0 items-center gap-1 rounded-full bg-[color:var(--org-primary-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--org-primary)] transition-opacity hover:opacity-80"
          >
            <Phone size={10.5} className="shrink-0" />
            <span className="truncate">{client.phone}</span>
          </a>
        </div>
      ) : null}

      {/* Sub-avisos: una línea por póliza, clickeable para ver el detalle */}
      <div className="mt-2.5 flex flex-col divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/60">
        {notices.map((notice) => {
          const rowBusy =
            markingNoticeId === notice.id || payingNoticeId === notice.id || revertingNoticeId === notice.id;
          return (
            <div key={notice.id} className="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer text-left"
                onClick={() => onOpenDetail(notice)}
              >
                <span className="block truncate text-[12px] font-semibold text-slate-700">
                  {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                  {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {notice.policies?.branch ?? "Rama"}
                  {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
                  {" · Vence el "}
                  {formatDate(notice.due_date)}
                </span>
              </button>
              {status === "avisado" ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onRequestPay(notice)}
                  disabled={rowBusy}
                >
                  {payingNoticeId === notice.id ? spin : <CheckCircle size={12} />}
                  Pagar
                </button>
              ) : null}
              {status === "pagado" ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onRevert(notice.id)}
                  disabled={rowBusy}
                >
                  {revertingNoticeId === notice.id ? spin : <RotateCcw size={12} />}
                  Revertir
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {status === "avisar" ? (
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-blue-600 py-2 text-[11.5px] font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => notices.forEach((notice) => onNotified(notice.id))}
            disabled={busy}
          >
            {busy ? spin : <Bell size={13} />}
            Marcar avisados ({notices.length})
          </button>
        </div>
      ) : null}
      {status === "avisado" ? (
        <p className="m-0 mt-2 text-center text-[10.5px] text-slate-400">
          Registrá el pago de cada póliza por separado.
        </p>
      ) : null}
    </article>
  );
}

// Chip de vencimiento con fondo tintado: comunica urgencia de un vistazo.
// Pagado siempre se muestra en verde, aunque la fecha haya pasado.

function NoticeListRow({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  onNotified,
  onRevert,
  onRequestPay,
  onOpenDetail,
  compact
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
  compact?: boolean;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);

  return (
    <div className={`sp-list-row notice ${compact ? "compact" : ""}`}>
      <i style={{ backgroundColor: NOTICE_COLUMNS.find((column) => column.key === notice.status)?.dot }} />
      <div
        className="sp-list-main cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(notice)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetail(notice);
          }
        }}
      >
        <strong>{client?.full_name ?? "Sin cliente"}</strong>
        <span>
          {company?.name ?? "Sin compañía"}
          {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
          {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
        </span>
      </div>
      <span className="sp-branch-tag">{notice.policies?.branch ?? "Rama"}</span>
      <span className="grid justify-items-start gap-0.5">
        <DueChip days={days} status={notice.status} />
        <em className="text-[11px] not-italic text-slate-400">{formatDate(notice.due_date)}</em>
      </span>
      {!compact ? (
        <NoticeActions
          notice={notice}
          isMarkingNotified={isMarkingNotified}
          isPaying={isPaying}
          isReverting={isReverting}
          onNotified={onNotified}
          onRevert={onRevert}
          onRequestPay={onRequestPay}
          inline
        />
      ) : null}
    </div>
  );
}

function NoticeActions({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  onNotified,
  onRevert,
  onRequestPay,
  inline
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onNotified: (id: string) => void;
  onRevert: (id: string) => void;
  onRequestPay: (notice: Notice) => void;
  inline?: boolean;
}) {
  const busy = isMarkingNotified || isPaying || isReverting;
  const wrap = `mt-2.5 flex gap-1.5 border-t border-slate-100 pt-2.5 ${inline ? "mt-0 border-0 pt-0" : ""}`;
  const base =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[11.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const blue = `${base} bg-blue-600 text-white hover:bg-blue-700`;
  const green = `${base} bg-emerald-600 text-white hover:bg-emerald-700`;
  const neutral = `${base} bg-slate-100 text-slate-600 hover:bg-slate-200`;
  const spin = <Loader2 size={13} className="animate-spin" />;

  // Flujo estricto: avisar -> avisado (azul) -> pagado (verde).
  if (notice.status === "pagado") {
    return (
      <div className={wrap}>
        <button type="button" className={neutral} onClick={() => onRevert(notice.id)} disabled={busy}>
          {isReverting ? spin : <RotateCcw size={13} />}
          Revertir pago
        </button>
      </div>
    );
  }

  if (notice.status === "avisar") {
    return (
      <div className={wrap}>
        <button type="button" className={blue} onClick={() => onNotified(notice.id)} disabled={busy}>
          {isMarkingNotified ? spin : <Bell size={13} />}
          Marcar avisado
        </button>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <button type="button" className={neutral} onClick={() => onRevert(notice.id)} disabled={busy}>
        {isReverting ? spin : <RotateCcw size={13} />}
        Avisar
      </button>
      <button type="button" className={green} onClick={() => onRequestPay(notice)} disabled={busy}>
        {isPaying ? spin : <CheckCircle size={13} />}
        Pagar
      </button>
    </div>
  );
}


function PaymentDialog({
  notice,
  isPaying,
  onClose,
  onConfirm
}: {
  notice: Notice | null;
  isPaying: boolean;
  onClose: () => void;
  onConfirm: (months: number) => Promise<void>;
}) {
  const [months, setMonths] = useState<number>(notice?.paid_interval_months ?? 1);
  const [error, setError] = useState<string | null>(null);

  const client = notice?.policies?.clients;
  const options = [1, 2, 3, 6, 12];

  return (
    <Modal title="Registrar pago" isOpen={Boolean(notice)} onClose={() => (isPaying ? undefined : onClose())}>
      <form
        className="sp-pay-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await onConfirm(months);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo registrar el pago.");
          }
        }}
      >
        <p className="sp-pay-client">
          {client?.full_name ?? "Sin cliente"}
          {notice?.policies?.branch ? ` · ${notice.policies.branch}` : ""}
        </p>
        <p className="sp-pay-question">¿Cuántos meses pagó el cliente?</p>
        <div className="sp-pay-options">
          {options.map((value) => {
            const selected = months === value;
            return (
              <button
                key={value}
                type="button"
                className={`sp-pay-option ${selected ? "is-selected" : ""}`}
                onClick={() => setMonths(value)}
                disabled={isPaying}
              >
                <span className="sp-pay-option-copy">
                  <strong>{capitalizeFirst(intervalLabel(value))}</strong>
                  <em>Próximo aviso en {value} {value === 1 ? "mes" : "meses"}</em>
                </span>
                {selected ? (
                  <span className="sp-pay-check">
                    <Check size={13} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isPaying}>
            Cancelar
          </button>
          <button type="submit" className="sp-primary-action" disabled={isPaying}>
            {isPaying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {isPaying ? "Registrando..." : "Confirmar pago"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Modal de alta de asegurado, compartido entre el dashboard y la vista de asegurados.
