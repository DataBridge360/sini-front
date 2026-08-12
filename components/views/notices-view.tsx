"use client";

import {
  Bell,
  Check,
  CheckCircle,
  Copy,
  FileText,
  Layers,
  Loader2,
  Mail,
  Phone,
  RotateCcw,
  Search,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { intervalLabel, type InsuranceCompany, type Notice } from "@/lib/api";
import { readView, writeView } from "@/lib/browser";
import { capitalizeFirst, formatDate, getDaysUntilDue } from "@/lib/format";
import {
  buildNoticeReminderMessage,
  clusterNoticesByClient,
  EMPTY_NOTICE_FILTERS,
  isNoticeInWindow,
  matchesNoticeFilters,
  noticeStatusLabel,
  noticeStatusPill,
  type NoticeFilters,
  type NoticeView
} from "@/lib/notices";
import { useDeferRealtime } from "@/lib/realtime";
import { BRANCHES, type NoticeNoteApi } from "@/lib/shell-types";
import { ClientNote, DueChip, NOTICE_COLUMNS, NoticeNotes } from "@/components/notices/shared";
import { WhatsAppPreview } from "@/components/notices/whatsapp-preview";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
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
  // El detalle recibe el grupo completo: con varias pólizas se muestran juntas.
  const [detailNotices, setDetailNotices] = useState<Notice[] | null>(null);
  // Confirmaciones: marcar avisado (1 o N del mismo asegurado) y revertir estado.
  const [notifyTarget, setNotifyTarget] = useState<Notice[] | null>(null);
  const [revertTarget, setRevertTarget] = useState<Notice | null>(null);

  // Con un modal abierto los refrescos de tiempo real esperan: las confirmaciones
  // de avisado, pago y reversión trabajan sobre una copia del aviso, y cambiarla
  // por debajo mientras alguien decide sería confuso. Al cerrar se aplican todos.
  useDeferRealtime(
    Boolean(payNoticeTarget || detailNotices || notifyTarget || revertTarget)
  );

  const requestNotify = (notice: Notice) => setNotifyTarget([notice]);
  const openDetail = (notice: Notice) => setDetailNotices([notice]);

  // El estado del detalle guarda un snapshot: se refresca contra las props para
  // que las notas agregadas desde el modal aparezcan sin cerrar y reabrir.
  const freshDetailNotices = detailNotices
    ? detailNotices.map((stale) => notices.find((notice) => notice.id === stale.id) ?? stale)
    : null;

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
                          onRequestNotify={requestNotify}
                          onRequestRevert={setRevertTarget}
                          onRequestPay={setPayNoticeTarget}
                          onOpenDetail={openDetail}
                        />
                      ) : (
                        <NoticeGroupCard
                          key={cluster.map((notice) => notice.id).join("|")}
                          notices={cluster}
                          markingNoticeId={markingNoticeId}
                          payingNoticeId={payingNoticeId}
                          revertingNoticeId={revertingNoticeId}
                          onRequestNotifyAll={setNotifyTarget}
                          onRequestRevert={setRevertTarget}
                          onRequestPay={setPayNoticeTarget}
                          onOpenDetail={setDetailNotices}
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
                    onRequestNotify={requestNotify}
                    onRequestRevert={setRevertTarget}
                    onRequestPay={setPayNoticeTarget}
                    onOpenDetail={openDetail}
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
        key={detailNotices ? detailNotices.map((notice) => notice.id).join("|") : "detail-modal"}
        notices={freshDetailNotices}
        noteApi={noteApi}
        onClose={() => setDetailNotices(null)}
        onViewPolicy={(notice) => {
          setDetailNotices(null);
          onViewPolicy(notice);
        }}
      />

      {/* Confirmación de "avisado" con mensaje sugerido listo para copiar */}
      <NotifyDialog
        key={notifyTarget ? notifyTarget.map((notice) => notice.id).join("|") : "notify-dialog"}
        notices={notifyTarget}
        onClose={() => setNotifyTarget(null)}
        onConfirm={() => {
          notifyTarget?.forEach((notice) => onNotified(notice.id));
          setNotifyTarget(null);
        }}
      />

      {/* Confirmación para volver atrás el estado de un aviso */}
      <ConfirmDialog
        isOpen={Boolean(revertTarget)}
        title={revertTarget?.status === "pagado" ? "Revertir pago" : "Volver a «Avisar»"}
        message={
          revertTarget?.status === "pagado"
            ? `¿Revertir el pago de ${revertTarget?.policies?.clients?.full_name ?? "este aviso"}? El aviso vuelve a la columna "Avisados".`
            : `¿Volver el aviso de ${revertTarget?.policies?.clients?.full_name ?? "este asegurado"} a "Avisar"? Va a quedar de nuevo como pendiente de contactar.`
        }
        confirmLabel={revertTarget?.status === "pagado" ? "Revertir pago" : "Volver atrás"}
        tone="warning"
        isBusy={Boolean(revertTarget && revertingNoticeId === revertTarget.id)}
        onClose={() => setRevertTarget(null)}
        onConfirm={() => {
          if (revertTarget) onRevert(revertTarget.id);
          setRevertTarget(null);
        }}
      />
    </div>
  );
}

// Confirmación de "marcar avisado" con el mensaje sugerido para el cliente,
// listo para copiar y mandar por WhatsApp. Se adapta al tipo de seguro y a
// la cantidad de vencimientos (aviso simple o agrupado).
function NotifyDialog({
  notices,
  onClose,
  onConfirm
}: {
  notices: Notice[] | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isOpen = Boolean(notices && notices.length > 0);
  const message = notices ? buildNoticeReminderMessage(notices) : "";
  const client = notices?.[0]?.policies?.clients;
  const clientName = client?.full_name ?? "el asegurado";

  const copyMessage = () => {
    void navigator.clipboard
      .writeText(message)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => undefined);
  };

  return (
    <Modal
      title={notices && notices.length > 1 ? `Marcar avisados (${notices.length})` : "Marcar avisado"}
      isOpen={isOpen}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Vas a marcar como avisado{notices && notices.length > 1 ? `s los ${notices.length} vencimientos` : " el vencimiento"} de{" "}
          <strong className="font-semibold text-slate-800">{clientName}</strong>. Podés copiar el mensaje sugerido y enviárselo:
        </p>
        {/* Antes del mensaje: si el asegurado tiene requisitos para contactarlo,
            hay que verlos ahora y no después de mandarlo. */}
        <ClientNote note={client?.notes} />
        <WhatsAppPreview message={message} />
        <button
          type="button"
          className={`inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
            copied
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
          onClick={copyMessage}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Mensaje copiado" : "Copiar mensaje"}
        </button>
        <div className="sp-modal-actions">
          <button type="button" className="sp-secondary-action" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="sp-primary-action" onClick={onConfirm}>
            <Bell size={14} />
            Confirmar avisado
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Detalle de uno o varios avisos del mismo asegurado: cada póliza se muestra
// como una tarjeta destacada, todas juntas en el mismo modal.
function NoticeDetailModal({
  notices,
  noteApi,
  onClose,
  onViewPolicy
}: {
  notices: Notice[] | null;
  noteApi: NoticeNoteApi;
  onClose: () => void;
  onViewPolicy: (notice: Notice) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const first = notices?.[0];
  if (!notices || !first) {
    return <Modal title="Detalle del aviso" isOpen={false} onClose={onClose}><div /></Modal>;
  }

  const client = first.policies?.clients;
  const minDays = Math.min(...notices.map((notice) => getDaysUntilDue(notice.due_date)));
  const showCopy = notices.some((notice) => notice.status !== "pagado");
  const message = buildNoticeReminderMessage(notices);

  // Al copiar también se muestra la vista previa, para ver qué le va a llegar
  // al asegurado antes de pegarlo en WhatsApp.
  const copyMessage = () => {
    setShowPreview(true);
    void navigator.clipboard
      .writeText(message)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => undefined);
  };

  // La vista previa arranca oculta cada vez que se abre el detalle.
  const handleClose = () => {
    setShowPreview(false);
    onClose();
  };

  return (
    <Modal
      title={notices.length > 1 ? `Detalle de ${notices.length} avisos` : "Detalle del aviso"}
      isOpen
      onClose={handleClose}
    >
      <div className="flex flex-col gap-4">
        {/* Cabecera: asegurado + estado + urgencia */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-lg font-semibold text-slate-900">{client?.full_name ?? "Sin cliente"}</h3>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5">
              <DueChip days={minDays} status={first.status} />
              {notices.length > 1 ? (
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <Layers size={12} /> {notices.length} pólizas con vencimientos juntos
                </span>
              ) : (
                <span className="text-xs text-slate-400">Vence el {formatDate(first.due_date)}</span>
              )}
            </p>
          </div>
          <span className={noticeStatusPill(first.status)}>{noticeStatusLabel(first.status)}</span>
        </div>

        {/* Una tarjeta destacada por póliza */}
        {notices.map((notice) => (
          <PolicyShowcase key={notice.id} notice={notice} noteApi={noteApi} onViewPolicy={onViewPolicy} />
        ))}

        {/* Contacto del asegurado: links discretos */}
        {client?.phone || client?.email ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {client?.phone ? (
              <a
                href={`tel:${client.phone}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-[color:var(--org-primary)]"
              >
                <Phone size={12} />
                {client.phone}
              </a>
            ) : null}
            {client?.email ? (
              <a
                href={`mailto:${client.email}`}
                className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-[color:var(--org-primary)]"
              >
                <Mail size={12} />
                <span className="truncate">{client.email}</span>
              </a>
            ) : null}
          </div>
        ) : null}

        <ClientNote note={client?.notes} />

        {showCopy && showPreview ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Vista previa del mensaje
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 transition-colors hover:text-slate-600"
                onClick={() => setShowPreview(false)}
              >
                <X size={11} />
                Ocultar
              </button>
            </div>
            <WhatsAppPreview message={message} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {showCopy ? (
            <button
              type="button"
              className={`mr-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                copied
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              onClick={copyMessage}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Mensaje copiado" : "Copiar mensaje"}
            </button>
          ) : null}
          <button type="button" className="sp-secondary-action" onClick={handleClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

// Sección de una póliza dentro del detalle: encabezado sobrio, datos clave en
// columnas y la auditoría/notas internas de ese aviso.
function PolicyShowcase({
  notice,
  noteApi,
  onViewPolicy
}: {
  notice: Notice;
  noteApi: NoticeNoteApi;
  onViewPolicy: (notice: Notice) => void;
}) {
  const company = notice.policies?.insurance_companies;

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-slate-800">
            {company?.name ?? "Sin compañía"}
            {notice.policies?.policy_number ? ` · Póliza N° ${notice.policies.policy_number}` : ""}
          </span>
          <span className="block text-[11px] text-slate-400">{notice.policies?.branch ?? "Rama"}</span>
        </span>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[color:var(--org-primary)] transition-opacity hover:opacity-75"
          onClick={() => onViewPolicy(notice)}
        >
          <FileText size={12} />
          Ver póliza
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 px-4 py-3 max-[520px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vencimiento</span>
          <span className="truncate text-[13px] font-semibold text-slate-800">{formatDate(notice.due_date)}</span>
        </div>
        {notice.policies?.vehicle_plate ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Patente</span>
            <span className="truncate text-[13px] font-semibold text-slate-800">{notice.policies.vehicle_plate}</span>
          </div>
        ) : null}
        {notice.status === "pagado" && notice.paid_interval_months ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pagó</span>
            <span className="truncate text-[13px] font-semibold text-emerald-700">
              {capitalizeFirst(intervalLabel(notice.paid_interval_months))}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-slate-100 px-4 py-2.5">
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
        {/* Notas internas editables: la tarjeta del tablero quedó minimalista,
            así que el alta/baja de notas vive acá en el detalle. */}
        <NoticeNotes notice={notice} noteApi={noteApi} />
      </div>
    </div>
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

// Tarjeta sobria: titular, una línea de póliza y vencimiento. Todo el resto
// (contacto, notas, auditoría) vive en el modal de detalle. La tarjeta entera
// es clickeable, salvo los botones de acción.
function NoticeCard({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  onRequestNotify,
  onRequestRevert,
  onRequestPay,
  onOpenDetail
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onRequestNotify: (notice: Notice) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);
  const clientName = client?.full_name ?? "Sin cliente";

  return (
    <article
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary-soft)]"
      onClick={() => onOpenDetail(notice)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail(notice);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="m-0 min-w-0 truncate text-[13px] font-semibold leading-snug text-slate-900">{clientName}</h4>
        <DueChip days={days} status={notice.status} />
      </div>
      <p className="m-0 mt-1 truncate text-[11.5px] text-slate-500">
        {company?.name ?? "Sin compañía"}
        {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
        {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
      </p>
      <p className="m-0 mt-0.5 truncate text-[11px] text-slate-400">
        {notice.policies?.branch ?? "Rama"} · Vence el {formatDate(notice.due_date)}
      </p>
      <ClientNote note={client?.notes} variant="card" />

      <NoticeActions
        notice={notice}
        isMarkingNotified={isMarkingNotified}
        isPaying={isPaying}
        isReverting={isReverting}
        onRequestNotify={onRequestNotify}
        onRequestRevert={onRequestRevert}
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
  onRequestNotifyAll,
  onRequestRevert,
  onRequestPay,
  onOpenDetail
}: {
  notices: Notice[];
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  revertingNoticeId: string | null;
  onRequestNotifyAll: (notices: Notice[]) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notices: Notice[]) => void;
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
    <article
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary-soft)]"
      onClick={() => onOpenDetail(notices)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail(notices);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="m-0 min-w-0 truncate text-[13px] font-semibold leading-snug text-slate-900">{clientName}</h4>
        <DueChip days={minDays} status={status} />
      </div>
      <p className="m-0 mt-1 flex items-center gap-1 truncate text-[11px] text-slate-400">
        <Layers size={11} className="shrink-0" />
        {notices.length} pólizas con vencimientos juntos
      </p>
      <ClientNote note={client?.notes} variant="card" />

      {/* Una línea por póliza: compañía · número a la izquierda, fecha a la derecha */}
      <div className="mt-2 flex flex-col divide-y divide-slate-100 border-t border-slate-100">
        {notices.map((notice) => {
          const rowBusy =
            markingNoticeId === notice.id || payingNoticeId === notice.id || revertingNoticeId === notice.id;
          return (
            <div key={notice.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600">
                {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{formatDate(notice.due_date)}</span>
              {status === "avisado" ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10.5px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestPay(notice);
                  }}
                  disabled={rowBusy}
                >
                  {payingNoticeId === notice.id ? spin : <CheckCircle size={11} />}
                  Pagar
                </button>
              ) : null}
              {status === "pagado" ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[10.5px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestRevert(notice);
                  }}
                  disabled={rowBusy}
                >
                  {revertingNoticeId === notice.id ? spin : <RotateCcw size={11} />}
                  Revertir
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {status === "avisar" ? (
        <div className="border-t border-slate-100 pt-2">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-50 py-1.5 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={(event) => {
              event.stopPropagation();
              onRequestNotifyAll(notices);
            }}
            disabled={busy}
          >
            {busy ? spin : <Bell size={13} />}
            Marcar avisados ({notices.length})
          </button>
        </div>
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
  onRequestNotify,
  onRequestRevert,
  onRequestPay,
  onOpenDetail,
  compact
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onRequestNotify: (notice: Notice) => void;
  onRequestRevert: (notice: Notice) => void;
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
        <ClientNote note={client?.notes} variant="card" />
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
          onRequestNotify={onRequestNotify}
          onRequestRevert={onRequestRevert}
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
  onRequestNotify,
  onRequestRevert,
  onRequestPay,
  inline
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onRequestNotify: (notice: Notice) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  inline?: boolean;
}) {
  const busy = isMarkingNotified || isPaying || isReverting;
  const wrap = `mt-2.5 flex gap-1.5 border-t border-slate-100 pt-2 ${inline ? "mt-0 border-0 pt-0" : ""}`;
  // Tintes suaves: marcan la acción sin competir con el contenido de la tarjeta.
  const base =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const blue = `${base} bg-blue-50 text-blue-700 hover:bg-blue-100`;
  const green = `${base} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`;
  const neutral = `${base} bg-slate-50 text-slate-500 hover:bg-slate-100`;
  const spin = <Loader2 size={13} className="animate-spin" />;
  // La tarjeta entera abre el detalle: los botones cortan la propagación.
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  // Flujo estricto: avisar -> avisado (azul) -> pagado (verde).
  if (notice.status === "pagado") {
    return (
      <div className={wrap} onClick={stop}>
        <button type="button" className={neutral} onClick={() => onRequestRevert(notice)} disabled={busy}>
          {isReverting ? spin : <RotateCcw size={13} />}
          Revertir pago
        </button>
      </div>
    );
  }

  if (notice.status === "avisar") {
    return (
      <div className={wrap} onClick={stop}>
        <button type="button" className={blue} onClick={() => onRequestNotify(notice)} disabled={busy}>
          {isMarkingNotified ? spin : <Bell size={13} />}
          Marcar avisado
        </button>
      </div>
    );
  }

  return (
    <div className={wrap} onClick={stop}>
      <button type="button" className={neutral} onClick={() => onRequestRevert(notice)} disabled={busy}>
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
