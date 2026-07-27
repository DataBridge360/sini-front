"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, Hash, Plus, Search, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import {
  apiRequest,
  type ApiCommonOptions,
  type Client,
  type InsuranceCompany,
  type Paginated,
  type Policy
} from "@/lib/api";
import { readView, writeView } from "@/lib/browser";
import { formatDate } from "@/lib/format";
import { BRANCHES, type EntityView, type PolicyFormValues } from "@/lib/shell-types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PolicyFormModal } from "@/components/policies/policy-form-modal";
import { PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { SearchableSelect } from "@/components/ui/selects";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ViewToggle } from "@/components/ui/view-toggle";

const NO_POLICIES: Policy[] = [];

// Listado con paginación server-side (PAGINADO.md): búsqueda (asegurado,
// número, patente) y filtros resueltos en el backend, de a 10 por página.
export function PoliciesView({
  common,
  clients,
  companies,
  isCreating,
  onCreate,
  onOpenPolicy
}: {
  common: ApiCommonOptions;
  clients: Client[];
  companies: InsuranceCompany[];
  isCreating: boolean;
  onCreate: (values: PolicyFormValues) => Promise<unknown>;
  onOpenPolicy: (policy: Policy) => void;
}) {
  const slug = common.organizationSlug ?? "";
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<EntityView>(() => readView("sp-policies-view", "list"));
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim());

  // Cambiar búsqueda o filtros siempre vuelve a la primera página
  // (reset de estado derivado durante el render, sin efecto).
  const filtersKey = `${debouncedSearch}|${branch}|${companyId}`;
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey);
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey);
    setPage(1);
  }

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (branch !== "all") params.set("branch", branch);
  if (companyId !== "all") params.set("companyId", companyId);

  const policiesQuery = useQuery({
    queryKey: ["policies", slug, "page", { page, search: debouncedSearch, branch, companyId }],
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<Paginated<Policy>>(`/policies?${params.toString()}`, common)
  });

  const items = policiesQuery.data?.items ?? NO_POLICIES;
  const total = policiesQuery.data?.total ?? 0;
  const currentPage = policiesQuery.data?.page ?? page;
  const pageSize = policiesQuery.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (currentPage - 1) * pageSize;
  const isLoading = policiesQuery.isLoading;

  return (
    <div className="sp-page padded">
      <div className="sp-entity-toolbar">
        <div className="sp-search">
          <Search size={15} />
          <input
            placeholder="Asegurado, N° póliza, patente..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select value={branch} onChange={(event) => setBranch(event.target.value)}>
          <option value="all">Todas las ramas</option>
          {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <SearchableSelect
          value={companyId}
          options={[
            { value: "all", label: "Todas las compañías" },
            ...companies.map((company) => ({ value: company.id, label: company.name }))
          ]}
          placeholder="Compañía"
          onChange={setCompanyId}
        />
        <span>{items.length} de {total}</span>
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
        {policiesQuery.error ? <ErrorState text={policiesQuery.error.message} /> : null}
        {isLoading ? <LoadingState text="Cargando pólizas" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {items.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} onOpen={onOpenPolicy} />
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {items.map((policy) => (
              <PolicyRow key={policy.id} policy={policy} onOpen={onOpenPolicy} />
            ))}
          </div>
        ) : null}
        {!isLoading && items.length === 0 ? (
          <EmptyState title="No hay pólizas para mostrar" text="Probá limpiar los filtros o cargar una nueva póliza." />
        ) : null}
        {!isLoading ? (
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            start={start}
            count={items.length}
            total={total}
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
      className="sp-policy-row is-clickable"
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
      <span className="sp-policy-row-icon"><ShieldCheck size={16} /></span>
      <span className="sp-policy-row-id">
        <strong className="sp-policy-row-name">{policy.clients?.full_name ?? "Sin cliente"}</strong>
        <span className="sp-policy-row-sub">
          {[
            policy.insurance_companies?.name ?? "Sin compañía",
            `#${policy.policy_number}`,
            policy.branch,
            policy.vehicle_plate
          ].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="sp-policy-row-date">
        <CalendarDays size={13} />
        {formatDate(policy.first_payment_date)}
      </span>
      <ChevronRight className="sp-policy-row-chev" size={16} />
    </div>
  );
}
