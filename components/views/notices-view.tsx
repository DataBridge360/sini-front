"use client";

import {
  Bell,
  Check,
  CheckCircle,
  Copy,
  FileText,
  Layers,
  Loader2,
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
  describeNoticeAlreadyHandled,
  EMPTY_NOTICE_FILTERS,
  describeNoticeHandlingLine,
  isNoticeInWindow,
  matchesNoticeFilters,
  noticeActionsFor,
  noticeContactOf,
  noticeStatusPill,
  pendingNotices,
  recentHandlingByOther,
  resolveNoticeDrop,
  type NoticeActionKind,
  type NoticeFilters,
  type NoticeHandling,
  type NoticeStatus,
  type NoticeView
} from "@/lib/notices";
import { previousNumbersLabel } from "@/lib/policy-numbers";
import { useRecentHandlingClock } from "@/lib/use-recent-handling-clock";
import { BRANCHES, type NoticeNoteApi } from "@/lib/shell-types";
import {
  ClientNote,
  ContactBlock,
  DueChip,
  NOTICE_COLUMNS,
  NoticeHandledLine,
  NoticeNotes,
  RecentHandlingBanner
} from "@/components/notices/shared";
import { DraggableNotice, NoticeBoardDnd, NoticeDropColumn } from "@/components/notices/notice-dnd";
import { PolicyMenu, RenewPolicyDialog } from "@/components/notices/policy-renew";
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
  onNotifiedAsync,
  onRevert,
  onPay,
  onViewPolicy,
  onRenewPolicy
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
  /** Same as onNotified but resolves when the server answers (rejects on error). */
  onNotifiedAsync: (id: string) => Promise<unknown>;
  onRevert: (id: string) => void;
  onPay: (id: string, months: number) => Promise<unknown>;
  onViewPolicy: (notice: Notice) => void;
  onRenewPolicy: (policyId: string, policyNumber: string) => Promise<unknown>;
}) {
  const [filters, setFilters] = useState<NoticeFilters>(EMPTY_NOTICE_FILTERS);
  const [view, setView] = useState<NoticeView>(() => readView("sp-notices-view", "kanban"));
  const [payNoticeTarget, setPayNoticeTarget] = useState<Notice | null>(null);
  // El detalle recibe el grupo completo: con varias pólizas se muestran juntas.
  const [detailNotices, setDetailNotices] = useState<Notice[] | null>(null);
  // Confirmaciones: marcar avisado (1 o N del mismo asegurado) y revertir estado.
  const [notifyTarget, setNotifyTarget] = useState<Notice[] | null>(null);
  const [revertTarget, setRevertTarget] = useState<Notice | null>(null);

  // Los modales de confirmación guardan el aviso con el que se abrieron, pero
  // deciden con la versión viva de la lista: el tiempo real sigue activo con un
  // modal abierto, y quien está por contactar a un cliente tiene que ver si otra
  // persona ya lo avisó o lo cobró.
  const noticesById = useMemo(() => new Map(notices.map((notice) => [notice.id, notice])), [notices]);
  const freshOf = (stale: Notice) => noticesById.get(stale.id) ?? null;
  // Se confirma un pago: mientras tanto el aviso pasa a "pagado" y no hay que
  // mostrar el cartel de "ya fue pagado" por el propio pago.
  const [submittingPayId, setSubmittingPayId] = useState<string | null>(null);
  // Payment dialog opened by dropping an "avisar" card on "pagado": confirming
  // marks it as notified first and then registers the payment.
  const [payNotifyFirstId, setPayNotifyFirstId] = useState<string | null>(null);
  // A drop that cannot start a flow because the notice changed in the meantime.
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const closePay = () => {
    setPayNoticeTarget(null);
    setPayNotifyFirstId(null);
  };

  // Reloj del cartel "lo avisó recién": solo corre mientras haya alguno vigente.
  const currentUserId = noteApi.currentUserId || null;
  const now = useRecentHandlingClock(notices, currentUserId);

  const requestNotify = (notice: Notice) => setNotifyTarget([notice]);
  const openDetail = (notice: Notice) => setDetailNotices([notice]);

  // El detalle se refresca contra las props: las notas y los cambios de estado de
  // otras personas aparecen sin cerrar y reabrir. Un aviso que ya no está se saca.
  const liveDetailNotices = detailNotices
    ? detailNotices.flatMap((stale) => {
        const fresh = freshOf(stale);
        return fresh ? [fresh] : [];
      })
    : [];
  const freshDetailNotices = liveDetailNotices.length > 0 ? liveDetailNotices : null;

  const payFresh = payNoticeTarget ? freshOf(payNoticeTarget) : null;
  const payNotifiesFirst = Boolean(
    payNoticeTarget && payNotifyFirstId === payNoticeTarget.id && (payFresh ?? payNoticeTarget).status === "avisar"
  );
  const payHandledMessage = payNoticeTarget && submittingPayId !== payNoticeTarget.id
    ? payFresh
      ? payFresh.status === "pagado"
        ? describeNoticeAlreadyHandled(payFresh, noteApi.currentUserId)
        : null
      : GONE_NOTICE_MESSAGE
    : null;

  const notifyEntries = notifyTarget?.map((stale) => ({ stale, fresh: freshOf(stale) })) ?? [];
  const notifyPending = notifyEntries.flatMap(({ fresh }) => (fresh?.status === "avisar" ? [fresh] : []));
  const notifyHandled = notifyEntries.flatMap(({ stale, fresh }) => {
    if (fresh?.status === "avisar") return [];
    const message = fresh ? describeNoticeAlreadyHandled(fresh, noteApi.currentUserId) : GONE_NOTICE_MESSAGE;
    const label = notifyEntries.length > 1 ? `${stale.policies?.policy_number ?? "Aviso"}: ` : "";
    return message ? [`${label}${message}`] : [];
  });

  const revertFresh = revertTarget ? freshOf(revertTarget) : null;
  const revertHandledMessage = revertTarget
    ? !revertFresh
      ? GONE_NOTICE_MESSAGE
      : revertFresh.status === "avisar"
        ? "Este aviso ya estaba en «Avisar»: otra persona lo revirtió antes."
        : null
    : null;

  // A drop only starts the existing flow for the transition. It decides on the
  // notice as the cache has it right now, and nothing moves until the server
  // confirms the action.
  const handleDrop = (dragged: Notice[], from: NoticeStatus, to: NoticeStatus) => {
    const live = dragged.map(freshOf);
    if (live.some((notice) => !notice)) {
      setDropMessage(GONE_NOTICE_MESSAGE);
      return;
    }
    const current = live as Notice[];
    const changed = current.find((notice) => notice.status !== from);
    if (changed) {
      setDropMessage(
        describeNoticeAlreadyHandled(changed, noteApi.currentUserId) ??
          "Este aviso cambió de estado mientras lo arrastrabas. Revisá la columna y probá de nuevo."
      );
      return;
    }
    const result = resolveNoticeDrop(from, to, current.length);
    const first = current[0];
    if (!result.valid || !first) return;
    switch (result.flow) {
      case "notify":
      case "notify-all":
        setNotifyTarget(current);
        break;
      case "revert":
      case "revert-payment":
        setRevertTarget(first);
        break;
      case "pay":
        setPayNotifyFirstId(null);
        setPayNoticeTarget(first);
        break;
      case "notify-then-pay":
        setPayNotifyFirstId(first.id);
        setPayNoticeTarget(first);
        break;
      case "open-detail":
        setDetailNotices(current);
        break;
    }
  };

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
          <NoticeBoardDnd
            onDrop={handleDrop}
            renderOverlay={(dragged) =>
              dragged.length === 1 && dragged[0] ? (
                <NoticeCard
                  notice={dragged[0]}
                  isMarkingNotified={false}
                  isPaying={false}
                  isReverting={false}
                  currentUserId={currentUserId}
                  now={now}
                  onRequestNotify={noop}
                  onRequestRevert={noop}
                  onRequestPay={noop}
                  onOpenDetail={noop}
                />
              ) : (
                <NoticeGroupCard
                  notices={dragged}
                  markingNoticeId={null}
                  payingNoticeId={null}
                  revertingNoticeId={null}
                  currentUserId={currentUserId}
                  now={now}
                  onRequestNotifyAll={noop}
                  onRequestRevert={noop}
                  onRequestPay={noop}
                  onOpenDetail={noop}
                />
              )
            }
          >
          <div className="sp-kanban">
            {NOTICE_COLUMNS.map((column) => (
              <NoticeDropColumn
                key={column.key}
                status={column.key}
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
                    clustered[column.key].map((cluster) => (
                      <DraggableNotice
                        key={cluster.map((notice) => notice.id).join("|")}
                        notices={cluster}
                        from={column.key}
                        disabled={cluster.some(
                          (notice) =>
                            markingNoticeId === notice.id ||
                            payingNoticeId === notice.id ||
                            revertingNoticeId === notice.id
                        )}
                      >
                      {cluster.length === 1 && cluster[0] ? (
                        <NoticeCard
                          notice={cluster[0]}
                          isMarkingNotified={markingNoticeId === cluster[0].id}
                          isPaying={payingNoticeId === cluster[0].id}
                          isReverting={revertingNoticeId === cluster[0].id}
                          currentUserId={currentUserId}
                          now={now}
                          onRequestNotify={requestNotify}
                          onRequestRevert={setRevertTarget}
                          onRequestPay={setPayNoticeTarget}
                          onOpenDetail={openDetail}
                        />
                      ) : (
                        <NoticeGroupCard
                          notices={cluster}
                          markingNoticeId={markingNoticeId}
                          payingNoticeId={payingNoticeId}
                          revertingNoticeId={revertingNoticeId}
                          currentUserId={currentUserId}
                          now={now}
                          onRequestNotifyAll={setNotifyTarget}
                          onRequestRevert={setRevertTarget}
                          onRequestPay={setPayNoticeTarget}
                          onOpenDetail={setDetailNotices}
                        />
                      )}
                      </DraggableNotice>
                    ))
                  )}
                </div>
              </NoticeDropColumn>
            ))}
          </div>
          </NoticeBoardDnd>
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
        notice={payHandledMessage ? null : payFresh ?? payNoticeTarget}
        notifiesFirst={payNotifiesFirst}
        isPaying={Boolean(
          payNoticeTarget &&
            (payingNoticeId === payNoticeTarget.id || (payNotifiesFirst && markingNoticeId === payNoticeTarget.id))
        )}
        onClose={closePay}
        onConfirm={async (months) => {
          if (!payNoticeTarget) return;
          const noticeId = payNoticeTarget.id;
          setSubmittingPayId(noticeId);
          try {
            // Dropped from "avisar": notify as the current user, then pay. If
            // the payment fails the notice stays "avisado" and the dialog shows the error.
            if (payNotifiesFirst) await onNotifiedAsync(noticeId);
            await onPay(noticeId, months);
            closePay();
          } finally {
            setSubmittingPayId(null);
          }
        }}
      />
      <HandledNoticeDialog title="Registrar pago" message={payHandledMessage} onClose={closePay} />
      <HandledNoticeDialog title="Mover aviso" message={dropMessage} onClose={() => setDropMessage(null)} />

      <NoticeDetailModal
        key={detailNotices ? detailNotices.map((notice) => notice.id).join("|") : "detail-modal"}
        notices={freshDetailNotices}
        noteApi={noteApi}
        now={now}
        markingNoticeId={markingNoticeId}
        payingNoticeId={payingNoticeId}
        revertingNoticeId={revertingNoticeId}
        onRequestNotify={requestNotify}
        onRequestNotifyAll={setNotifyTarget}
        onRequestRevert={setRevertTarget}
        onRequestPay={setPayNoticeTarget}
        onClose={() => setDetailNotices(null)}
        onRenewPolicy={onRenewPolicy}
        onViewPolicy={(notice) => {
          setDetailNotices(null);
          onViewPolicy(notice);
        }}
      />

      {/* Confirmación de "avisado" con mensaje sugerido listo para copiar */}
      <NotifyDialog
        key={notifyTarget ? notifyTarget.map((notice) => notice.id).join("|") : "notify-dialog"}
        notices={notifyTarget && notifyPending.length > 0 ? notifyPending : null}
        handledMessages={notifyHandled}
        senderName={noteApi.currentUserName}
        onClose={() => setNotifyTarget(null)}
        onConfirm={() => {
          notifyPending.forEach((notice) => onNotified(notice.id));
          setNotifyTarget(null);
        }}
      />
      <HandledNoticeDialog
        title="Marcar avisado"
        message={notifyTarget && notifyPending.length === 0 ? notifyHandled.join(" ") : null}
        onClose={() => setNotifyTarget(null)}
      />

      {/* Confirmación para volver atrás el estado de un aviso */}
      <ConfirmDialog
        isOpen={Boolean(revertTarget) && !revertHandledMessage}
        title={(revertFresh ?? revertTarget)?.status === "pagado" ? "Revertir pago" : "Volver a «Avisar»"}
        message={
          (revertFresh ?? revertTarget)?.status === "pagado"
            ? `¿Revertir el pago de ${(revertFresh ?? revertTarget)?.policies?.clients?.full_name ?? "este aviso"}? El aviso vuelve a la columna "Avisados".`
            : `¿Volver el aviso de ${(revertFresh ?? revertTarget)?.policies?.clients?.full_name ?? "este asegurado"} a "Avisar"? Va a quedar de nuevo como pendiente de contactar.`
        }
        confirmLabel={(revertFresh ?? revertTarget)?.status === "pagado" ? "Revertir pago" : "Volver atrás"}
        tone="warning"
        isBusy={Boolean(revertTarget && revertingNoticeId === revertTarget.id)}
        onClose={() => setRevertTarget(null)}
        onConfirm={() => {
          if (revertTarget) onRevert(revertTarget.id);
          setRevertTarget(null);
        }}
      />
      <HandledNoticeDialog title="Revertir estado" message={revertHandledMessage} onClose={() => setRevertTarget(null)} />
    </div>
  );
}

const noop = () => undefined;

const GONE_NOTICE_MESSAGE = "Este aviso ya no está disponible: otra persona lo eliminó o lo modificó.";

// Cartel cuando el aviso ya lo resolvió otra persona: dice qué pasó y solo deja
// cerrar, para no avisar ni cobrar dos veces.
function HandledNoticeDialog({
  title,
  message,
  onClose
}: {
  title: string;
  message: string | null;
  onClose: () => void;
}) {
  return (
    <Modal title={title} isOpen={Boolean(message)} closeOnEscape onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm leading-relaxed text-slate-600" role="status">
          {message}
        </p>
        <div className="sp-modal-actions">
          <button type="button" className="sp-primary-action" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Confirmación de "marcar avisado" con el mensaje sugerido para el cliente,
// listo para copiar y mandar por WhatsApp. Se adapta al tipo de seguro y a
// la cantidad de vencimientos (aviso simple o agrupado).
function NotifyDialog({
  notices,
  handledMessages,
  senderName,
  onClose,
  onConfirm
}: {
  notices: Notice[] | null;
  /** Nombre del usuario logueado, para presentarse en el mensaje. */
  senderName: string;
  /** Vencimientos del grupo que otra persona ya resolvió: se muestran y no se vuelven a avisar. */
  handledMessages: string[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isOpen = Boolean(notices && notices.length > 0);
  const message = notices ? buildNoticeReminderMessage(notices, senderName) : "";
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
      closeOnEscape
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Vas a marcar como avisado{notices && notices.length > 1 ? `s los ${notices.length} vencimientos` : " el vencimiento"} de{" "}
          <strong className="font-semibold text-slate-800">{clientName}</strong>. Podés copiar el mensaje sugerido y enviárselo:
        </p>
        {handledMessages.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800" role="status">
            {handledMessages.map((message) => (
              <p key={message} className="m-0">
                {message}
              </p>
            ))}
          </div>
        ) : null}
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

// Detalle de uno o varios avisos del mismo asegurado: contacto arriba, una
// sección por póliza con su estado y sus acciones, y el aviso masivo al pie.
function NoticeDetailModal({
  notices,
  noteApi,
  now,
  markingNoticeId,
  payingNoticeId,
  revertingNoticeId,
  onRequestNotify,
  onRequestNotifyAll,
  onRequestRevert,
  onRequestPay,
  onClose,
  onViewPolicy,
  onRenewPolicy
}: {
  notices: Notice[] | null;
  noteApi: NoticeNoteApi;
  now: number;
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  revertingNoticeId: string | null;
  onRequestNotify: (notice: Notice) => void;
  onRequestNotifyAll: (notices: Notice[]) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  onClose: () => void;
  onViewPolicy: (notice: Notice) => void;
  onRenewPolicy: (policyId: string, policyNumber: string) => Promise<unknown>;
}) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const first = notices?.[0];
  if (!notices || !first) {
    return <Modal title="Detalle del aviso" isOpen={false} onClose={onClose}><div /></Modal>;
  }

  const client = first.policies?.clients;
  const contact = noticeContactOf(client);
  const minDays = Math.min(...notices.map((notice) => getDaysUntilDue(notice.due_date)));
  const showCopy = notices.some((notice) => notice.status !== "pagado");
  const pending = pendingNotices(notices);
  const message = buildNoticeReminderMessage(notices, noteApi.currentUserName);
  const currentUserId = noteApi.currentUserId || null;
  const recent = notices.flatMap((notice) => {
    const handling = recentHandlingByOther(notice, currentUserId, now);
    return handling ? [{ notice, handling }] : [];
  });

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
      closeOnEscape
      onClose={handleClose}
    >
      <div className="flex flex-col gap-4">
        {/* Cabecera: asegurado + urgencia. El estado va en cada póliza. */}
        <div className="min-w-0">
          <h3 className="m-0 truncate text-xl font-bold text-slate-900">{client?.full_name ?? "Sin cliente"}</h3>
          <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <DueChip days={minDays} status={first.status} />
            {notices.length > 1 ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                <Layers size={12} /> {notices.length} pólizas con vencimientos juntos
              </span>
            ) : (
              <span className="text-xs text-slate-600">Vence el {formatDate(first.due_date)}</span>
            )}
          </p>
        </div>

        {/* Otra persona resolvió un aviso mientras este detalle estaba abierto */}
        {recent.map(({ notice, handling }) => (
          <RecentHandlingBanner
            key={notice.id}
            handling={handling}
            now={now}
            policyNumber={notice.policies?.policy_number}
            variant="modal"
          />
        ))}

        {/* Contacto: texto plano, solo se copia */}
        {contact ? <ContactBlock contact={contact} variant="modal" /> : null}

        <ClientNote note={client?.notes} />

        {/* Una sección por póliza, cada una con su estado y sus acciones */}
        {notices.map((notice) => (
          <PolicyShowcase
            key={notice.id}
            notice={notice}
            noteApi={noteApi}
            now={now}
            isMarkingNotified={markingNoticeId === notice.id}
            isPaying={payingNoticeId === notice.id}
            isReverting={revertingNoticeId === notice.id}
            onRequestNotify={onRequestNotify}
            onRequestRevert={onRequestRevert}
            onRequestPay={onRequestPay}
            onViewPolicy={onViewPolicy}
            onRenewPolicy={onRenewPolicy}
          />
        ))}

        {showCopy && showPreview ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                Vista previa del mensaje
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded text-[11px] font-semibold text-slate-600 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)]"
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
          {pending.length > 0 ? (
            <button type="button" className="sp-primary-action" onClick={() => onRequestNotifyAll(pending)}>
              <Bell size={14} />
              {pending.length > 1 ? `Marcar avisados (${pending.length})` : "Marcar avisado"}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

// Sección de una póliza dentro del detalle: estado propio, datos clave en
// columnas, quién la avisó o cobró, sus acciones y las notas internas.
function PolicyShowcase({
  notice,
  noteApi,
  now,
  isMarkingNotified,
  isPaying,
  isReverting,
  onRequestNotify,
  onRequestRevert,
  onRequestPay,
  onViewPolicy,
  onRenewPolicy
}: {
  notice: Notice;
  noteApi: NoticeNoteApi;
  now: number;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onRequestNotify: (notice: Notice) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  onViewPolicy: (notice: Notice) => void;
  onRenewPolicy: (policyId: string, policyNumber: string) => Promise<unknown>;
}) {
  const [isRenewing, setIsRenewing] = useState(false);
  const company = notice.policies?.insurance_companies;
  const policy = notice.policies;
  const previousLabel = previousNumbersLabel(policy);
  const currentUserId = noteApi.currentUserId || null;
  // Una póliza pagada conserva quién la avisó antes de cobrarla.
  const notifiedLine =
    notice.status === "pagado" ? describeNoticeHandlingLine({ ...notice, status: "avisado" }, currentUserId, now) : null;
  const hasOwnActions = noticeActionsFor(notice.status).some(({ kind }) => !MODAL_OMITTED_ACTIONS.includes(kind));

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-slate-900">
            {company?.name ?? "Sin compañía"}
            {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
          </span>
          <span className="block text-xs text-slate-600">{notice.policies?.branch ?? "Rama"}</span>
          {previousLabel ? <span className="block truncate text-[11px] text-slate-500">{previousLabel}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className={noticeStatusPill(notice.status)}>
            {notice.status === "avisar" ? "Por avisar" : notice.status === "avisado" ? "Avisado" : "Pagado"}
          </span>
          {policy?.id && policy.policy_number ? (
            <PolicyMenu
              policyNumber={policy.policy_number}
              policyLabel={`la póliza #${policy.policy_number}`}
              onRenew={() => setIsRenewing(true)}
            />
          ) : null}
        </span>
      </div>
      {isRenewing && policy?.id ? (
        <RenewPolicyDialog
          currentNumber={policy.policy_number}
          onClose={() => setIsRenewing(false)}
          onRenew={(policyNumber) => onRenewPolicy(policy.id, policyNumber)}
        />
      ) : null}
      <div className="grid grid-cols-3 gap-3 px-4 py-3 max-[520px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Vencimiento</span>
          <span className="truncate text-[13px] font-semibold text-slate-800">{formatDate(notice.due_date)}</span>
        </div>
        {notice.policies?.vehicle_plate ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Patente</span>
            <span className="truncate text-[13px] font-semibold text-slate-800">{notice.policies.vehicle_plate}</span>
          </div>
        ) : null}
        {notice.status === "pagado" && notice.paid_interval_months ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Pagó</span>
            <span className="truncate text-[13px] font-semibold text-emerald-700">
              {capitalizeFirst(intervalLabel(notice.paid_interval_months))}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-slate-100 px-4 py-3">
        {notifiedLine ? <p className="m-0 text-xs font-medium text-blue-700">{notifiedLine.text}</p> : null}
        <NoticeHandledLine notice={notice} currentUserId={currentUserId} now={now} className="m-0" />
        {/* Avisar es una sola acción para todas las pólizas (pie del detalle),
            así que acá quedan solo las acciones propias de cada póliza. */}
        {hasOwnActions ? (
          <div className="flex gap-2">
            <NoticeActionButtons
              notice={notice}
              isMarkingNotified={isMarkingNotified}
              isPaying={isPaying}
              isReverting={isReverting}
              onRequestNotify={onRequestNotify}
              onRequestRevert={onRequestRevert}
              onRequestPay={onRequestPay}
              size="modal"
              omit={MODAL_OMITTED_ACTIONS}
            />
          </div>
        ) : null}
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-[color:var(--org-primary)] transition-opacity hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)]"
          onClick={() => onViewPolicy(notice)}
        >
          <FileText size={12} />
          Ver póliza
        </button>
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

// Enter y Espacio abren el detalle solo cuando el foco está en la tarjeta misma:
// si viene de un botón interno (copiar, avisar, pagar), ese botón maneja la tecla.
function openOnKey(event: React.KeyboardEvent, open: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
}

const CARD_CLASS =
  "cursor-pointer rounded-xl border bg-white p-3 transition-colors hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)]";

// Tarjeta del tablero: titular, póliza y vencimiento, contacto para copiar,
// quién la resolvió y las acciones del estado. La tarjeta entera abre el
// detalle, salvo los botones.
function NoticeCard({
  notice,
  isMarkingNotified,
  isPaying,
  isReverting,
  currentUserId,
  now,
  onRequestNotify,
  onRequestRevert,
  onRequestPay,
  onOpenDetail
}: {
  notice: Notice;
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  currentUserId: string | null;
  now: number;
  onRequestNotify: (notice: Notice) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notice: Notice) => void;
}) {
  const client = notice.policies?.clients;
  const company = notice.policies?.insurance_companies;
  const days = getDaysUntilDue(notice.due_date);
  const clientName = client?.full_name ?? "Sin cliente";
  const contact = noticeContactOf(client);
  const recent = recentHandlingByOther(notice, currentUserId, now);

  return (
    <article
      role="button"
      tabIndex={0}
      className={`${CARD_CLASS} ${recent ? "border-blue-600" : "border-slate-200 hover:border-slate-300"}`}
      onClick={() => onOpenDetail(notice)}
      onKeyDown={(event) => openOnKey(event, () => onOpenDetail(notice))}
    >
      {recent ? <RecentHandlingBanner handling={recent} now={now} variant="card" /> : null}
      <div className="flex items-start justify-between gap-2">
        <h4 className="m-0 min-w-0 truncate text-[15px] font-semibold leading-snug text-slate-900">{clientName}</h4>
        <DueChip days={days} status={notice.status} />
      </div>
      <p className="m-0 mt-1 truncate text-xs text-slate-600">
        {company?.name ?? "Sin compañía"}
        {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
        {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
      </p>
      <p className="m-0 mt-0.5 truncate text-xs text-slate-600">
        {notice.policies?.branch ?? "Rama"} · Vence el {formatDate(notice.due_date)}
      </p>
      <ClientNote note={client?.notes} variant="card" />
      <NoticeHandledLine notice={notice} currentUserId={currentUserId} now={now} />
      {contact ? <ContactBlock contact={contact} variant="card" /> : null}

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
  currentUserId,
  now,
  onRequestNotifyAll,
  onRequestRevert,
  onRequestPay,
  onOpenDetail
}: {
  notices: Notice[];
  markingNoticeId: string | null;
  payingNoticeId: string | null;
  revertingNoticeId: string | null;
  currentUserId: string | null;
  now: number;
  onRequestNotifyAll: (notices: Notice[]) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
  onOpenDetail: (notices: Notice[]) => void;
}) {
  const first = notices[0];
  if (!first) return null;
  const client = first.policies?.clients;
  const clientName = client?.full_name ?? "Sin cliente";
  const contact = noticeContactOf(client);
  const status = first.status;
  const minDays = Math.min(...notices.map((notice) => getDaysUntilDue(notice.due_date)));
  const busy = notices.some(
    (notice) =>
      markingNoticeId === notice.id || payingNoticeId === notice.id || revertingNoticeId === notice.id
  );
  const spin = <Loader2 size={13} className="animate-spin" />;
  // Un solo cartel por tarjeta: el cambio más reciente de otra persona.
  const recent = notices.reduce<NoticeHandling | null>((latest, notice) => {
    const handling = recentHandlingByOther(notice, currentUserId, now);
    return handling && (!latest || handling.atMs > latest.atMs) ? handling : latest;
  }, null);
  const handledNotice = notices.find((notice) => describeNoticeHandlingLine(notice, currentUserId, now));

  return (
    <article
      role="button"
      tabIndex={0}
      className={`${CARD_CLASS} ${recent ? "border-blue-600" : "border-slate-200 hover:border-slate-300"}`}
      onClick={() => onOpenDetail(notices)}
      onKeyDown={(event) => openOnKey(event, () => onOpenDetail(notices))}
    >
      {recent ? <RecentHandlingBanner handling={recent} now={now} variant="card" /> : null}
      <div className="flex items-start justify-between gap-2">
        <h4 className="m-0 min-w-0 truncate text-[15px] font-semibold leading-snug text-slate-900">{clientName}</h4>
        <DueChip days={minDays} status={status} />
      </div>
      <p className="m-0 mt-1 flex items-center gap-1 truncate text-xs text-slate-600">
        <Layers size={11} className="shrink-0" />
        {notices.length} pólizas con vencimientos juntos
      </p>
      <ClientNote note={client?.notes} variant="card" />
      {handledNotice ? <NoticeHandledLine notice={handledNotice} currentUserId={currentUserId} now={now} /> : null}
      {contact ? <ContactBlock contact={contact} variant="card" /> : null}

      {/* Una línea por póliza: compañía · número a la izquierda, fecha a la derecha */}
      <div className="mt-2 flex flex-col divide-y divide-slate-100 border-t border-slate-100">
        {notices.map((notice) => {
          const rowBusy =
            markingNoticeId === notice.id || payingNoticeId === notice.id || revertingNoticeId === notice.id;
          const policyLabel = notice.policies?.policy_number ? ` de la póliza ${notice.policies.policy_number}` : "";
          return (
            <div key={notice.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                {notice.policies?.insurance_companies?.name ?? "Sin compañía"}
                {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-600">{formatDate(notice.due_date)}</span>
              {status === "avisado" ? (
                <button
                  type="button"
                  aria-label={`Registrar pago${policyLabel}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)] disabled:cursor-not-allowed disabled:opacity-60"
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
                  aria-label={`Revertir pago${policyLabel}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)] disabled:cursor-not-allowed disabled:opacity-60"
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
            className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-50 py-1.5 text-[12.5px] font-semibold text-blue-800 transition-colors hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)] disabled:cursor-not-allowed disabled:opacity-60"
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
  const contact = noticeContactOf(client);

  return (
    <div className={`sp-list-row notice ${compact ? "compact" : ""}`}>
      <i style={{ backgroundColor: NOTICE_COLUMNS.find((column) => column.key === notice.status)?.dot }} />
      {/* El teléfono con su botón de copiar queda afuera del área clickeable del
          detalle: un botón dentro de otro botón no es válido. */}
      <div className="sp-list-main">
        <div
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetail(notice)}
          onKeyDown={(event) => openOnKey(event, () => onOpenDetail(notice))}
        >
          <strong>{client?.full_name ?? "Sin cliente"}</strong>
          <span>
            {company?.name ?? "Sin compañía"}
            {notice.policies?.policy_number ? ` · #${notice.policies.policy_number}` : ""}
            {notice.policies?.vehicle_plate ? ` · ${notice.policies.vehicle_plate}` : ""}
          </span>
          <ClientNote note={client?.notes} variant="card" />
        </div>
        {contact ? <ContactBlock contact={contact} variant="row" /> : null}
      </div>
      <span className="sp-branch-tag">{notice.policies?.branch ?? "Rama"}</span>
      <span className="grid justify-items-start gap-0.5">
        <DueChip days={days} status={notice.status} />
        <em className="text-[11px] not-italic text-slate-600">{formatDate(notice.due_date)}</em>
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

type NoticeActionHandlers = {
  isMarkingNotified: boolean;
  isPaying: boolean;
  isReverting: boolean;
  onRequestNotify: (notice: Notice) => void;
  onRequestRevert: (notice: Notice) => void;
  onRequestPay: (notice: Notice) => void;
};

// En el detalle, avisar vive solo en el pie y aplica a todas las pólizas.
const MODAL_OMITTED_ACTIONS: readonly NoticeActionKind[] = ["notify"];

// Botones del estado actual del aviso (flujo estricto: avisar -> avisado ->
// pagado). Los usan la tarjeta, la lista y las secciones del detalle, así los
// diálogos de confirmación y las guardas de datos vivos son los mismos.
function NoticeActionButtons({
  notice,
  size,
  isMarkingNotified,
  isPaying,
  isReverting,
  onRequestNotify,
  onRequestRevert,
  onRequestPay,
  omit
}: NoticeActionHandlers & { notice: Notice; size: "card" | "row" | "modal"; omit?: readonly NoticeActionKind[] }) {
  const busy = isMarkingNotified || isPaying || isReverting;
  const sizeClass =
    size === "modal"
      ? "min-h-11 text-[13px]"
      : size === "row"
        ? "min-h-8 px-1 text-[11px]"
        : "min-h-9 text-[12.5px]";
  // Tintes suaves: marcan la acción sin competir con el contenido de la tarjeta.
  const base = `inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)] disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass}`;
  const tone: Record<NoticeActionKind, string> = {
    notify: "bg-blue-50 text-blue-800 hover:bg-blue-100",
    revert: "bg-slate-100 text-slate-600 hover:bg-slate-200",
    pay: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
  };
  const handler: Record<NoticeActionKind, (notice: Notice) => void> = {
    notify: onRequestNotify,
    revert: onRequestRevert,
    pay: onRequestPay
  };
  const spinning: Record<NoticeActionKind, boolean> = {
    notify: isMarkingNotified,
    revert: isReverting,
    pay: isPaying
  };
  const icons: Record<NoticeActionKind, typeof Bell> = { notify: Bell, revert: RotateCcw, pay: CheckCircle };
  const iconSize = size === "modal" ? 15 : 13;

  return (
    <>
      {noticeActionsFor(notice.status)
        .filter(({ kind }) => !omit?.includes(kind))
        .map(({ kind, label }) => {
        const Icon = icons[kind];
        return (
          <button
            key={kind}
            type="button"
            className={`${base} ${tone[kind]}`}
            onClick={() => handler[kind](notice)}
            disabled={busy}
          >
            {spinning[kind] ? (
              <Loader2 size={iconSize} className="animate-spin" />
            ) : size === "row" ? null : (
              <Icon size={iconSize} />
            )}
            {label}
          </button>
        );
      })}
    </>
  );
}

function NoticeActions({
  inline,
  ...props
}: NoticeActionHandlers & { notice: Notice; inline?: boolean }) {
  const wrap = `mt-2.5 flex gap-1.5 ${inline ? "mt-0" : ""}`;
  // La tarjeta entera abre el detalle: el contenedor corta la propagación.
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <div className={wrap} onClick={stop}>
      <NoticeActionButtons {...props} size={inline ? "row" : "card"} />
    </div>
  );
}

function PaymentDialog({
  notice,
  notifiesFirst,
  isPaying,
  onClose,
  onConfirm
}: {
  notice: Notice | null;
  /** The notice is still "avisar": confirming also marks it as notified by the current user. */
  notifiesFirst: boolean;
  isPaying: boolean;
  onClose: () => void;
  onConfirm: (months: number) => Promise<void>;
}) {
  const [months, setMonths] = useState<number>(notice?.paid_interval_months ?? 1);
  const [error, setError] = useState<string | null>(null);

  const client = notice?.policies?.clients;
  const options = [1, 2, 3, 6, 12];

  return (
    <Modal title="Registrar pago" isOpen={Boolean(notice)} closeOnEscape onClose={() => (isPaying ? undefined : onClose())}>
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
        {notifiesFirst ? (
          <p className="sp-pay-question">Al confirmar, el aviso también queda marcado como avisado por vos.</p>
        ) : null}
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
