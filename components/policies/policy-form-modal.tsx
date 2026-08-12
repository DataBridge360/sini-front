"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import {
  intervalLabel,
  type ApiCommonOptions,
  type Client,
  type InsuranceCompany,
  type PaymentMethod,
  type Policy
} from "@/lib/api";
import { formatDate } from "@/lib/format";
import { suggestNextPaymentDate } from "@/lib/policy-analysis";
import { BRANCHES, type PolicyFormValues } from "@/lib/shell-types";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { SearchableSelect } from "@/components/ui/selects";

export function PolicyFormModal({
  title,
  submitLabel,
  isOpen,
  policy,
  // Valores sugeridos para un alta (hoy: lo que salió de analizar un PDF). No
  // se pasa un `policy` sintético a propósito, porque eso activaría la rama de
  // edición y el aviso sobre el vencimiento pendiente. Como el estado se
  // inicializa una sola vez, quien los pase tiene que remontar con `key`.
  initialValues,
  // Vigencia leída del PDF. Solo alimenta los atajos de fecha de cobro: no se
  // guarda en la póliza, que no tiene esas columnas.
  coverageDates,
  clients,
  companies,
  isSaving,
  // Alta de asegurado sin salir del formulario: si el asegurado de la póliza
  // todavía no está cargado, no hay que abandonar lo tipeado para ir a crearlo.
  // Sin estas props (p. ej. al editar desde la ficha del asegurado) el atajo no
  // se muestra.
  common,
  isCreatingClient,
  onCreateClient,
  onClose,
  onSubmit
}: {
  title: string;
  submitLabel: string;
  isOpen: boolean;
  policy: Policy | null;
  initialValues?: Partial<PolicyFormValues> | undefined;
  coverageDates?: { from: string | null; to: string | null } | undefined;
  clients: Client[];
  companies: InsuranceCompany[];
  isSaving: boolean;
  common?: ApiCommonOptions | undefined;
  isCreatingClient?: boolean | undefined;
  onCreateClient?: ((body: Record<string, FormDataEntryValue>) => Promise<Client>) | undefined;
  onClose: () => void;
  onSubmit: (values: PolicyFormValues) => Promise<unknown>;
}) {
  const [clientId, setClientId] = useState(policy?.clients?.id ?? initialValues?.clientId ?? "");
  const [companyId, setCompanyId] = useState(
    policy?.insurance_companies?.id ?? initialValues?.insuranceCompanyId ?? ""
  );
  const [branch, setBranch] = useState(policy?.branch ?? initialValues?.branch ?? "");
  const [policyNumber, setPolicyNumber] = useState(
    policy?.policy_number ?? initialValues?.policyNumber ?? ""
  );
  const [vehiclePlate, setVehiclePlate] = useState(
    policy?.vehicle_plate ?? initialValues?.vehiclePlate ?? ""
  );
  const [months, setMonths] = useState<number>(
    policy?.payment_interval_months ?? initialValues?.paymentIntervalMonths ?? 1
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    policy?.payment_method ?? initialValues?.paymentMethod ?? "manual"
  );
  const [date, setDate] = useState(policy?.first_payment_date ?? initialValues?.firstPaymentDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  // Nombre tipeado en el buscador del select: entra prellenado al alta para no
  // escribirlo dos veces. El seed remonta el modal para que lo tome de nuevo.
  const [newClientName, setNewClientName] = useState("");
  const [clientModalSeed, setClientModalSeed] = useState(0);
  // El asegurado recién creado tarda en aparecer en `clients` (la lista se
  // refetchea): se suma a mano para que el select pueda mostrarlo ya elegido.
  const [createdClients, setCreatedClients] = useState<Client[]>([]);
  const canCreateClient = Boolean(common && onCreateClient);
  const clientOptions = [
    ...createdClients.filter((created) => !clients.some((client) => client.id === created.id)),
    ...clients
  ];
  const branches = Array.from(new Set([...BRANCHES, ...(branch ? [branch] : [])]));
  const isAutomatic = paymentMethod === "debito_automatico";
  // El tipo de pago define si la póliza entra al circuito de cobranza: al
  // pasarla a automático se archivan sus avisos pendientes, y al volver a
  // manual se genera el aviso del vencimiento cargado.
  const methodChanged = Boolean(policy && paymentMethod !== policy.payment_method);
  // Editar el vencimiento arrastra el aviso activo que tenía la fecha vieja
  // (trigger trg_sync_policy_notice_due_date), así que se avisa antes de guardar.
  const dateChanged = Boolean(policy && date && date !== policy.first_payment_date);

  const dateSuggestions = (() => {
    if (policy || !coverageDates?.from) return [];
    const options: Array<{ value: string; label: string }> = [];
    const next = suggestNextPaymentDate(coverageDates.from, months);
    if (next) options.push({ value: next, label: "Próximo cobro" });
    if (coverageDates.from !== next) {
      options.push({ value: coverageDates.from, label: "Inicio de vigencia" });
    }
    if (coverageDates.to && coverageDates.to !== next) {
      options.push({ value: coverageDates.to, label: "Fin de vigencia" });
    }
    return options;
  })();

  return (
    <>
      <Modal title={title} isOpen={isOpen} onClose={onClose}>
        <form
          className="sp-form sp-modal-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            if (!clientId || !companyId || !branch || !policyNumber.trim() || !date) {
              setError("Completá asegurado, compañía, rama, número y vencimiento.");
              return;
            }
            try {
              await onSubmit({
                clientId,
                insuranceCompanyId: companyId,
                branch,
                policyNumber: policyNumber.trim(),
                vehiclePlate: vehiclePlate.trim(),
                paymentIntervalMonths: months,
                paymentMethod,
                firstPaymentDate: date
              });
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "No se pudo guardar la póliza.");
            }
          }}
        >
          <div className="sp-form-section">
            <h3>Relación comercial</h3>
            <div className="sp-form-grid">
              <SearchableSelect
                label="Asegurado"
                value={clientId}
                onChange={setClientId}
                options={clientOptions.map((client) => ({ value: client.id, label: client.full_name }))}
                placeholder="Buscar asegurado"
                createAction={
                  canCreateClient
                    ? {
                        label: "Nuevo asegurado",
                        onSelect: (typed) => {
                          setNewClientName(typed);
                          setClientModalSeed((seed) => seed + 1);
                          setIsClientModalOpen(true);
                        }
                      }
                    : undefined
                }
              />
              <SearchableSelect
                label="Compañía"
                value={companyId}
                onChange={setCompanyId}
                options={companies.map((company) => ({ value: company.id, label: company.name }))}
                placeholder="Buscar compañía"
              />
            </div>
          </div>
          <div className="sp-form-section">
            <h3>Datos de póliza</h3>
          </div>
          <div className="sp-form-grid">
            <label className="sp-field">
              <span>Rama</span>
              <select value={branch} onChange={(event) => setBranch(event.target.value)}>
                <option value="">Seleccionar rama</option>
                {branches.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="sp-field">
              <span>Número</span>
              <input value={policyNumber} onChange={(event) => setPolicyNumber(event.target.value)} placeholder="Número de póliza" />
            </label>
          </div>
          <div className="sp-form-grid">
            <label className="sp-field">
              <span>Patente</span>
              <input value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value)} placeholder="Opcional" />
            </label>
            <label className="sp-field">
              <span>Periodicidad</span>
              <select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{intervalLabel(value)}</option>)}
              </select>
            </label>
          </div>
          <label className="sp-field">
            <span>Tipo de pago</span>
            <select
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
            >
              <option value="manual">Manual (se avisa y se cobra)</option>
              <option value="debito_automatico">Débito/crédito automático</option>
            </select>
            <span className="mt-1 text-[11px] leading-snug text-slate-500">
              {isAutomatic
                ? methodChanged
                  ? "Se cobra sola: sale del gestor de avisos y sus avisos pendientes se archivan. Los pagos ya registrados quedan como historial."
                  : "Se cobra sola: no genera avisos ni aparece en el gestor de avisos."
                : methodChanged
                  ? "Vuelve al circuito de cobranza: se genera un aviso pendiente con el vencimiento de abajo."
                  : "Genera avisos de cobro en cada vencimiento."}
            </span>
          </label>
          <label className="sp-field">
            <span>{policy ? "Primer vencimiento" : "Fecha del próximo cobro"}</span>
            <DatePicker
              value={date}
              onChange={setDate}
              ariaLabel={policy ? "Primer vencimiento" : "Fecha del próximo cobro"}
            />
            {isAutomatic ? (
              <span className="mt-1 text-[11px] leading-snug text-slate-500">
                Queda registrada como referencia del vencimiento: por débito automático no se genera ningún aviso.
              </span>
            ) : policy ? (
              <span className="mt-1 text-[11px] leading-snug text-slate-500">
                {dateChanged
                  ? `El aviso pendiente con vencimiento ${formatDate(policy.first_payment_date)} pasa a ${formatDate(date)}. Los pagos ya registrados no se tocan.`
                  : "Si cambiás esta fecha, el aviso pendiente que la tenía se mueve con ella."}
              </span>
            ) : (
              <span className="mt-1 text-[11px] leading-snug text-slate-500">
                Con esta fecha se genera el primer aviso de cobro.
              </span>
            )}
            {/* La póliza trae la vigencia, no el calendario de cobranza: se
                ofrecen las fechas de referencia para no obligar a calcularlas. */}
            {!policy && dateSuggestions.length > 0 ? (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {dateSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.value}
                    type="button"
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      date === suggestion.value
                        ? "border-sky-300 bg-sky-50 text-sky-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                    onClick={() => setDate(suggestion.value)}
                  >
                    {suggestion.label} · {formatDate(suggestion.value)}
                  </button>
                ))}
              </span>
            ) : null}
          </label>
          {error ? <div className="sp-pay-error">{error}</div> : null}
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={onClose} disabled={isSaving}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isSaving}>
              {isSaving ? <span className="sp-button-spinner" aria-hidden="true" /> : <Save size={14} />}
              {submitLabel}
            </button>
          </div>
        </form>
      </Modal>

    {/* Hermano del modal de póliza, no hijo: así el formulario de la póliza
        queda intacto detrás y el clic afuera cierra solo el de arriba. */}
    {canCreateClient && common && onCreateClient ? (
      <ClientCreateModal
        key={`policy-client-${clientModalSeed}`}
        isOpen={isClientModalOpen}
        isCreating={Boolean(isCreatingClient)}
        common={common}
        initialName={newClientName}
        onClose={() => setIsClientModalOpen(false)}
        onCreate={async (body) => {
          const created = await onCreateClient(body);
          setCreatedClients((current) => [created, ...current]);
          setClientId(created.id);
          return created;
        }}
      />
    ) : null}
    </>
  );
}

