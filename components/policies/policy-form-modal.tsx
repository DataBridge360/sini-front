"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { intervalLabel, type Client, type InsuranceCompany, type Policy } from "@/lib/api";
import { BRANCHES, type PolicyFormValues } from "@/lib/shell-types";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { SearchableSelect } from "@/components/ui/selects";

export function PolicyFormModal({
  title,
  submitLabel,
  isOpen,
  policy,
  clients,
  companies,
  isSaving,
  onClose,
  onSubmit
}: {
  title: string;
  submitLabel: string;
  isOpen: boolean;
  policy: Policy | null;
  clients: Client[];
  companies: InsuranceCompany[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: PolicyFormValues) => Promise<unknown>;
}) {
  const [clientId, setClientId] = useState(policy?.clients?.id ?? "");
  const [companyId, setCompanyId] = useState(policy?.insurance_companies?.id ?? "");
  const [branch, setBranch] = useState(policy?.branch ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy?.policy_number ?? "");
  const [vehiclePlate, setVehiclePlate] = useState(policy?.vehicle_plate ?? "");
  const [months, setMonths] = useState<number>(policy?.payment_interval_months ?? 1);
  const [date, setDate] = useState(policy?.first_payment_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const branches = Array.from(new Set([...BRANCHES, ...(branch ? [branch] : [])]));

  return (
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
              options={clients.map((client) => ({ value: client.id, label: client.full_name }))}
              placeholder="Buscar asegurado"
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
          <span>Primer vencimiento</span>
          <DatePicker value={date} onChange={setDate} ariaLabel="Primer vencimiento" />
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
  );
}

