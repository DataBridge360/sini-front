"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, CheckCircle, ChevronDown, Edit3, FileText, Hash, Loader2, Mail, MapPin, Phone, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  apiRequest,
  intervalLabel,
  paymentMethodLabel,
  type Client,
  type Notice,
  type Policy
} from "@/lib/api";
import { AVATAR_COLORS, formatDate, initials } from "@/lib/format";
import { noticeStatusLabel, noticeStatusPill } from "@/lib/notices";
import type { NoticeNoteApi, PolicyActions } from "@/lib/shell-types";
import { NOTICE_COLUMNS, NoticeNotes } from "@/components/notices/shared";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

export function ClientDetailScreen({
  client,
  policies,
  common,
  currentUserId,
  isSavingClient,
  isDeletingClient,
  noteApi,
  policyActions,
  initialOpenPolicyId,
  onBack,
  onSaveClient,
  onDeleteClient
}: {
  client: Client | null;
  policies: Policy[];
  common: { token: string | undefined; organizationSlug: string };
  currentUserId: string;
  isSavingClient: boolean;
  isDeletingClient: boolean;
  noteApi: NoticeNoteApi;
  policyActions: PolicyActions;
  initialOpenPolicyId: string | null;
  onBack: () => void;
  onSaveClient: (patch: Record<string, unknown>) => Promise<unknown>;
  onDeleteClient: () => Promise<unknown>;
}) {
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null);
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(initialOpenPolicyId);
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [deleteClientOpen, setDeleteClientOpen] = useState(false);
  const [deletePolicyTarget, setDeletePolicyTarget] = useState<Policy | null>(null);

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[color:var(--org-primary)] transition-colors hover:opacity-80"
    >
      <ArrowLeft size={16} />
      Volver a asegurados
    </button>
  );

  if (!client) {
    return (
      <div className="sp-page padded flex flex-col gap-5 p-6">
        {backButton}
        <EmptyState title="Asegurado no encontrado" text="Puede que la lista se haya actualizado." />
      </div>
    );
  }

  const clientPolicies = policies.filter((policy) => policy.clients?.id === client.id);
  const color = AVATAR_COLORS[(client.full_name.charCodeAt(0) || 0) % AVATAR_COLORS.length] ?? "#1d4ed8";

  return (
    <div className="sp-page padded flex flex-col gap-6 p-6">
      {backButton}

      <ClientDetailHeader
        client={client}
        color={color}
        isSaving={isSavingClient}
        onSaveClient={onSaveClient}
        onEditClient={() => setEditClientOpen(true)}
        onDeleteClient={() => setDeleteClientOpen(true)}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 className="m-0 text-lg font-semibold text-slate-900">Pólizas</h2>
          <span className="text-xs font-medium text-slate-500">
            {clientPolicies.length} {clientPolicies.length === 1 ? "póliza" : "pólizas"}
          </span>
        </div>
        {clientPolicies.length === 0 ? (
          <EmptyState title="Sin pólizas" text="Este asegurado todavía no tiene pólizas cargadas." compact />
        ) : (
          <div className="flex flex-col gap-3">
            {clientPolicies.map((policy) => (
              <PolicyHistoryPanel
                key={policy.id}
                policy={policy}
                common={common}
                currentUserId={currentUserId}
                noteApi={noteApi}
                isDeleting={policyActions.isDeleting}
                open={openPolicyId === policy.id}
                onToggle={() => setOpenPolicyId((current) => (current === policy.id ? null : policy.id))}
                onEdit={setEditPolicy}
                onDelete={setDeletePolicyTarget}
              />
            ))}
          </div>
        )}
      </section>

      <PolicyFormModal
        key={editPolicy?.id ?? "client-policy-edit"}
        title="Editar póliza"
        submitLabel="Guardar cambios"
        isOpen={Boolean(editPolicy)}
        policy={editPolicy}
        clients={policyActions.clients}
        companies={policyActions.companies}
        isSaving={policyActions.isSaving}
        onClose={() => setEditPolicy(null)}
        onSubmit={async (values) => {
          if (!editPolicy) return;
          await policyActions.onUpdate(editPolicy.id, values);
          setEditPolicy(null);
        }}
      />

      <ClientFormModal
        key={editClientOpen ? `client-edit-${client.id}` : "client-edit-closed"}
        isOpen={editClientOpen}
        client={client}
        isSaving={isSavingClient}
        onClose={() => setEditClientOpen(false)}
        onSubmit={async (patch) => {
          await onSaveClient(patch);
          setEditClientOpen(false);
        }}
      />

      <ConfirmDialog
        isOpen={deleteClientOpen}
        title="Eliminar asegurado"
        message={`¿Seguro que querés eliminar a ${client.full_name}? Se ocultarán también sus pólizas y avisos. Esta acción se puede revertir desde la base de datos.`}
        confirmLabel="Eliminar asegurado"
        isBusy={isDeletingClient}
        onClose={() => setDeleteClientOpen(false)}
        onConfirm={async () => {
          await onDeleteClient();
          setDeleteClientOpen(false);
          onBack();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deletePolicyTarget)}
        title="Eliminar póliza"
        message={
          deletePolicyTarget
            ? `¿Eliminar la póliza ${deletePolicyTarget.policy_number ? `#${deletePolicyTarget.policy_number}` : ""} de ${deletePolicyTarget.branch}? Se ocultará junto con sus avisos.`
            : ""
        }
        confirmLabel="Eliminar póliza"
        isBusy={policyActions.isDeleting}
        onClose={() => setDeletePolicyTarget(null)}
        onConfirm={async () => {
          if (!deletePolicyTarget) return;
          await policyActions.onDelete(deletePolicyTarget.id);
          setDeletePolicyTarget(null);
        }}
      />
    </div>
  );
}


function ClientFormModal({
  isOpen,
  client,
  isSaving,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  client: Client;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [fullName, setFullName] = useState(client.full_name);
  const [phone, setPhone] = useState(client.phone ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [dni, setDni] = useState(client.dni ?? "");
  const [locality, setLocality] = useState(client.locality ?? "");
  const [address, setAddress] = useState(client.address ?? "");
  const [birthDate, setBirthDate] = useState(client.birth_date ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Editar asegurado" isOpen={isOpen} onClose={onClose}>
      <form
        className="sp-form sp-modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          if (!fullName.trim()) {
            setError("El nombre es obligatorio.");
            return;
          }
          try {
            await onSubmit({
              fullName: fullName.trim(),
              phone: phone.trim() || null,
              email: email.trim() || null,
              dni: dni.trim() || null,
              locality: locality.trim() || null,
              address: address.trim() || null,
              birthDate: birthDate || null
            });
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "No se pudo actualizar el asegurado.");
          }
        }}
      >
        <div className="sp-form-section">
          <h3>Datos personales</h3>
          <label className="sp-field">
            <span>Nombre completo</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nombre y apellido" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>Teléfono</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Teléfono" />
          </label>
          <label className="sp-field">
            <span>Email</span>
            <input value={email} type="email" onChange={(event) => setEmail(event.target.value)} placeholder="correo@dominio.com" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>DNI</span>
            <input value={dni} onChange={(event) => setDni(event.target.value)} placeholder="Documento" />
          </label>
          <label className="sp-field">
            <span>Localidad</span>
            <input value={locality} onChange={(event) => setLocality(event.target.value)} placeholder="Localidad" />
          </label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>Dirección</span>
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Dirección" />
          </label>
          <label className="sp-field">
            <span>Nacimiento</span>
            <DatePicker value={birthDate} onChange={setBirthDate} ariaLabel="Fecha de nacimiento" />
          </label>
        </div>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button type="submit" className="sp-primary-action" disabled={isSaving}>
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar cambios
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientDetailHeader({
  client,
  color,
  isSaving,
  onSaveClient,
  onEditClient,
  onDeleteClient
}: {
  client: Client;
  color: string;
  isSaving: boolean;
  onSaveClient: (patch: Record<string, unknown>) => Promise<unknown>;
  onEditClient: () => void;
  onDeleteClient: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(client.notes ?? "");

  const fields: Array<{ icon: typeof Phone; label: string; value: string | null; href: string | null }> = [
    { icon: Phone, label: "Teléfono", value: client.phone, href: client.phone ? `tel:${client.phone}` : null },
    { icon: Mail, label: "Email", value: client.email, href: client.email ? `mailto:${client.email}` : null },
    { icon: Hash, label: "DNI", value: client.dni, href: null },
    { icon: MapPin, label: "Localidad", value: client.locality, href: null },
    { icon: MapPin, label: "Dirección", value: client.address, href: null },
    { icon: CalendarDays, label: "Nacimiento", value: client.birth_date ? formatDate(client.birth_date) : null, href: null }
  ];

  const visibleFields = fields.filter((field) => field.value);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-sm sm:h-16 sm:w-16 sm:text-xl"
          style={{ backgroundColor: color }}
        >
          {initials(client.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-xl font-bold text-slate-900 sm:text-2xl">{client.full_name}</h2>
          {client.locality ? (
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
              <MapPin size={14} />
              {client.locality}
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEditClient}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Edit3 size={14} />
            Editar
          </button>
          <button
            type="button"
            onClick={onDeleteClient}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>
      </div>

      {visibleFields.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          {visibleFields.map((field) => {
            const Icon = field.icon;
            return (
              <div key={field.label} className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <Icon size={13} />
                  {field.label}
                </span>
                {field.href ? (
                  <a className="truncate text-sm font-medium text-slate-800 transition-colors hover:text-[color:var(--org-primary)]" href={field.href}>
                    {field.value}
                  </a>
                ) : (
                  <span className="truncate text-sm font-medium text-slate-800">{field.value}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Nota del asegurado</span>
          {!editingNote ? (
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--org-primary)] transition-colors hover:opacity-80"
              onClick={() => {
                setDraft(client.notes ?? "");
                setEditingNote(true);
              }}
            >
              <Edit3 size={12} />
              {client.notes ? "Editar" : "Agregar"}
            </button>
          ) : null}
        </div>
        {editingNote ? (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={draft}
              rows={2}
              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-[color:var(--org-primary)]"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Escribí una nota sobre este asegurado..."
              disabled={isSaving}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="sp-secondary-action" onClick={() => setEditingNote(false)} disabled={isSaving}>
                Cancelar
              </button>
              <button
                type="button"
                className="sp-primary-action"
                disabled={isSaving}
                onClick={async () => {
                  await onSaveClient({ notes: draft.trim() || null });
                  setEditingNote(false);
                }}
              >
                {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Guardar
              </button>
            </div>
          </div>
        ) : client.notes ? (
          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-snug text-slate-600">{client.notes}</p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-400">Sin notas todavía.</p>
        )}
      </div>
    </section>
  );
}

function PolicyHistoryPanel({
  policy,
  common,
  currentUserId,
  noteApi,
  isDeleting,
  open,
  onToggle,
  onEdit,
  onDelete
}: {
  policy: Policy;
  common: { token: string | undefined; organizationSlug: string };
  currentUserId: string;
  noteApi: NoticeNoteApi;
  isDeleting: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: (policy: Policy) => void;
  onDelete: (policy: Policy) => void;
}) {
  const history = useQuery({
    queryKey: ["policy-notices", policy.id],
    enabled: open,
    queryFn: () => apiRequest<Notice[]>(`/policies/${policy.id}/notices`, common)
  });

  const notices = history.data ?? [];
  const payments = notices.filter((notice) => notice.status === "pagado");

  const infoItems = [
    { label: "Compañía", value: policy.insurance_companies?.name ?? "-" },
    { label: "Rama", value: policy.branch },
    { label: "N° de póliza", value: policy.policy_number || "-" },
    { label: "Patente", value: policy.vehicle_plate || "-" },
    { label: "Periodicidad", value: intervalLabel(policy.payment_interval_months) },
    { label: "Tipo de pago", value: paymentMethodLabel(policy.payment_method) },
    { label: "Primer pago", value: policy.first_payment_date ? formatDate(policy.first_payment_date) : "-" }
  ];
  const isAutomatic = policy.payment_method === "debito_automatico";

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 pr-3 transition-colors hover:bg-slate-50">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left"
          onClick={onToggle}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--org-primary-soft)] text-[color:var(--org-primary)]">
            <FileText size={17} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate text-sm font-semibold text-slate-900">
              {policy.branch} · {policy.insurance_companies?.name ?? "Sin compañía"}
            </strong>
            <span className="truncate text-xs text-slate-500">
              {policy.policy_number ? `#${policy.policy_number}` : "Sin N°"}
              {policy.vehicle_plate ? ` · ${policy.vehicle_plate}` : ""}
              {` · ${intervalLabel(policy.payment_interval_months)}`}
              {policy.payment_method === "debito_automatico" ? " · débito automático" : ""}
            </span>
          </div>
          <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <PolicyActionButtons policy={policy} isDeleting={isDeleting} onEdit={onEdit} onDelete={onDelete} compact />
      </div>

      {open ? (
        <div className="flex flex-col gap-5 border-t border-slate-100 bg-slate-50/70 p-4">
          {history.isLoading ? <LoadingState text="Cargando historial" /> : null}
          {history.error ? <ErrorState text={history.error.message} /> : null}
          {!history.isLoading && !history.error ? (
            <>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                {infoItems.map((item) => (
                  <div key={item.label} className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</span>
                    <strong className="text-sm font-medium text-slate-800">{item.value}</strong>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Historial de pagos</h4>
                {payments.length === 0 ? (
                  <p className="m-0 text-xs text-slate-400">Todavía no hay pagos registrados.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {payments.map((payment) => (
                      <div key={payment.id} className="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <CheckCircle size={15} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <strong className="text-sm font-semibold text-slate-900">Vto. {formatDate(payment.due_date)}</strong>
                          <span className="truncate text-xs text-slate-500">
                            {payment.paid_interval_months ? `${intervalLabel(payment.paid_interval_months)}` : "Pago"}
                            {payment.payment_processed_by ? ` · cobró ${payment.payment_processed_by.full_name}` : ""}
                          </span>
                        </div>
                        {payment.payment_processed_at ? (
                          <em className="shrink-0 text-[11px] not-italic text-slate-400">{formatDate(payment.payment_processed_at.slice(0, 10))}</em>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Historial de avisos</h4>
                {notices.length === 0 ? (
                  <p className="m-0 text-xs text-slate-400">
                    {isAutomatic
                      ? "Se cobra por débito automático: no genera avisos."
                      : "Sin avisos para esta póliza."}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {notices.map((notice) => (
                      <div key={notice.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NOTICE_COLUMNS.find((column) => column.key === notice.status)?.dot }} />
                          <strong className="text-sm font-semibold text-slate-900">Vto. {formatDate(notice.due_date)}</strong>
                          <span className={noticeStatusPill(notice.status)}>{noticeStatusLabel(notice.status)}</span>
                          {notice.notified_by ? <em className="text-[11px] not-italic text-slate-400">Avisó {notice.notified_by.full_name}</em> : null}
                        </div>
                        <NoticeNotes notice={notice} noteApi={{ ...noteApi, currentUserId }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}


function PolicyActionButtons({
  policy,
  isDeleting,
  onEdit,
  onDelete,
  compact
}: {
  policy: Policy;
  isDeleting: boolean;
  onEdit: (policy: Policy) => void;
  onDelete: (policy: Policy) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "flex shrink-0 items-center gap-1" : "flex gap-2"}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(policy);
        }}
        className={
          compact
            ? "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            : "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        }
        aria-label="Editar póliza"
      >
        <Edit3 size={14} />
        {compact ? null : "Editar"}
      </button>
      <button
        type="button"
        disabled={isDeleting}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(policy);
        }}
        className={
          compact
            ? "flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            : "inline-flex items-center justify-center gap-1 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
        }
        aria-label="Eliminar póliza"
      >
        <Trash2 size={14} />
        {compact ? null : "Eliminar"}
      </button>
    </div>
  );
}

