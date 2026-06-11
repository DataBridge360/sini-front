"use client";

import { CalendarDays, ChevronRight, Hash, Plus, Search, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import type { Client, InsuranceCompany, Policy } from "@/lib/api";
import { readView, writeView } from "@/lib/browser";
import { formatDate } from "@/lib/format";
import { BRANCHES, type EntityView, type PolicyFormValues } from "@/lib/shell-types";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { paginate, Pagination } from "@/components/ui/pagination";
import { SearchableSelect } from "@/components/ui/selects";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ViewToggle } from "@/components/ui/view-toggle";

export function PoliciesView({
  policies,
  clients,
  companies,
  isLoading,
  isCreating,
  error,
  onCreate,
  onOpenPolicy
}: {
  policies: Policy[];
  clients: Client[];
  companies: InsuranceCompany[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onCreate: (values: PolicyFormValues) => Promise<unknown>;
  onOpenPolicy: (policy: Policy) => void;
}) {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<EntityView>(() => readView("sp-policies-view", "list"));
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const branches = Array.from(new Set([...BRANCHES, ...policies.map((policy) => policy.branch)])).sort();
  const filtered = policies.filter((policy) => {
    const term = search.toLowerCase();
    const matchesSearch =
      !term ||
      policy.clients?.full_name?.toLowerCase().includes(term) ||
      policy.policy_number?.toLowerCase().includes(term) ||
      policy.vehicle_plate?.toLowerCase().includes(term);
    const matchesBranch = branch === "all" || policy.branch === branch;
    const matchesCompany = companyId === "all" || policy.insurance_companies?.id === companyId;
    return matchesSearch && matchesBranch && matchesCompany;
  });
  const paged = paginate(filtered, page);

  return (
    <div className="sp-page padded">
      <div className="sp-entity-toolbar">
        <div className="sp-search">
          <Search size={15} />
          <input
            placeholder="Asegurado, N° póliza, patente..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          value={branch}
          onChange={(event) => {
            setBranch(event.target.value);
            setPage(1);
          }}
        >
          <option value="all">Todas las ramas</option>
          {branches.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <SearchableSelect
          value={companyId}
          options={[
            { value: "all", label: "Todas las compañías" },
            ...companies.map((company) => ({ value: company.id, label: company.name }))
          ]}
          placeholder="Compañía"
          onChange={(value) => {
            setCompanyId(value);
            setPage(1);
          }}
        />
        <span>{filtered.length} de {policies.length}</span>
        <ViewToggle
          leftLabel="Grid"
          rightLabel="Lista"
          value={view}
          leftValue="grid"
          rightValue="list"
          onChange={(next) => {
            setView(next);
            writeView("sp-policies-view", next);
          }}
        />
        <button className="sp-primary-action" type="button" onClick={() => setIsCreateOpen(true)}>
          <Plus size={14} />
          Nueva póliza
        </button>
      </div>

      <section className="sp-section-card wide">
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando pólizas" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {paged.items.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} onOpen={onOpenPolicy} />
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {paged.items.map((policy) => (
              <PolicyRow key={policy.id} policy={policy} onOpen={onOpenPolicy} />
            ))}
          </div>
        ) : null}
        {!isLoading && filtered.length === 0 ? <EmptyState title="No hay pólizas para mostrar" text="Probá limpiar los filtros o cargar una nueva póliza." /> : null}
        {!isLoading ? (
          <Pagination
            page={paged.page}
            totalPages={paged.totalPages}
            start={paged.start}
            count={paged.items.length}
            total={paged.total}
            onChange={setPage}
          />
        ) : null}
      </section>

      <PolicyFormModal
        key="policy-create"
        title="Nueva póliza"
        submitLabel="Guardar póliza"
        isOpen={isCreateOpen}
        policy={null}
        clients={clients}
        companies={companies}
        isSaving={isCreating}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={async (values) => {
          await onCreate(values);
          setIsCreateOpen(false);
        }}
      />
    </div>
  );
}


function PolicyCard({ policy, onOpen }: { policy: Policy; onOpen: (policy: Policy) => void }) {
  return (
    <article
      className="sp-entity-card policy is-clickable"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(policy)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(policy);
        }
      }}
    >
      <div className="sp-entity-head">
        <div className="sp-icon-box"><ShieldCheck size={18} /></div>
        <div>
          <h3>{policy.branch}</h3>
          <p>{policy.insurance_companies?.name ?? "Sin compañía"}</p>
        </div>
      </div>
      <div className="sp-entity-lines">
        <span><User size={14} />{policy.clients?.full_name ?? "Sin cliente"}</span>
        <span><Hash size={14} />{policy.policy_number}</span>
        {policy.vehicle_plate ? <span>{policy.vehicle_plate}</span> : null}
      </div>
      <div className="sp-entity-footer">
        <CalendarDays size={14} />
        <span>{formatDate(policy.first_payment_date)}</span>
      </div>
    </article>
  );
}

function PolicyRow({ policy, onOpen }: { policy: Policy; onOpen: (policy: Policy) => void }) {
  return (
    <div
      className="sp-list-row entity policy is-clickable"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(policy)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(policy);
        }
      }}
    >
      <div className="sp-icon-box small"><ShieldCheck size={15} /></div>
      <div className="sp-list-main">
        <strong>{policy.clients?.full_name ?? "Sin cliente"}</strong>
        <span>{policy.insurance_companies?.name ?? "Sin compañía"} · #{policy.policy_number}</span>
      </div>
      <span className="sp-branch-tag">{policy.branch}</span>
      <span>{policy.vehicle_plate ?? "-"}</span>
      <span>{formatDate(policy.first_payment_date)}</span>
      <ChevronRight className="ml-auto shrink-0 text-slate-300" size={16} />
    </div>
  );
}

