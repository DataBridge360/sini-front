"use client";

import { Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import type { InsuranceCompany, Policy } from "@/lib/api";
import { AVATAR_COLORS, initials } from "@/lib/format";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

export function CompaniesView({
  companies,
  policies,
  isLoading,
  isCreating,
  error,
  onSubmit
}: {
  companies: InsuranceCompany[];
  policies: Policy[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="sp-page padded">
      <div className="sp-company-header">
        <div>
          <h2>Compañías</h2>
          <p>Gestión de entidades aseguradoras.</p>
        </div>
        <button className="sp-primary-action" type="button" onClick={() => setIsModalOpen(true)}>
          <Plus size={15} />
          Nueva compañía
        </button>
      </div>
      {error ? <ErrorState text={error} /> : null}
      {isLoading ? <LoadingState text="Cargando compañías" /> : null}
      {!isLoading && companies.length === 0 ? (
        <EmptyState title="No hay compañías cargadas" text="Agregá una compañía para asociarla a nuevas pólizas." />
      ) : null}
      {!isLoading && companies.length > 0 ? (
        <div className="sp-company-grid">
          {companies.map((company, index) => {
            const count = policies.filter((policy) => policy.insurance_companies?.id === company.id).length;
            return (
              <article key={company.id} className="sp-company-card">
                <div className="sp-avatar company" style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}>
                  {initials(company.name)}
                </div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{count} póliza{count === 1 ? "" : "s"} activa{count === 1 ? "" : "s"}</p>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      <Modal title="Nueva compañía" isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <form
          className="sp-form"
          onSubmit={async (event) => {
            try {
              await onSubmit(event);
              setIsModalOpen(false);
            } catch {
              // parent mutation state renders the error
            }
          }}
        >
          <label className="sp-field"><span>Nombre</span><input name="name" placeholder="Nombre de la compañía" required /></label>
          <div className="sp-modal-actions">
            <button className="sp-secondary-action" type="button" onClick={() => setIsModalOpen(false)} disabled={isCreating}>Cancelar</button>
            <button className="sp-primary-action" type="submit" disabled={isCreating}>
              {isCreating ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={14} />}
              {isCreating ? "Cargando..." : "Agregar compañía"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

