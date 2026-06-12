"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileText, Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { apiRequest, type ApiCommonOptions, type ClientListItem, type Paginated } from "@/lib/api";
import { readView, writeView } from "@/lib/browser";
import { AVATAR_COLORS, initials } from "@/lib/format";
import type { EntityView } from "@/lib/shell-types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { EntityToolbar } from "@/components/ui/entity-toolbar";
import { PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { SearchableSelect } from "@/components/ui/selects";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const NO_ITEMS: ClientListItem[] = [];
const NO_LOCALITIES: string[] = [];

// Listado con paginación server-side (PAGINADO.md): el navegador solo recibe
// la página visible; búsqueda y filtros se resuelven en el backend.
export function ClientsView({
  common,
  isCreating,
  onOpenClient,
  onCreate
}: {
  common: ApiCommonOptions;
  isCreating: boolean;
  onOpenClient: (client: ClientListItem) => void;
  onCreate: (body: Record<string, FormDataEntryValue>) => Promise<unknown>;
}) {
  const slug = common.organizationSlug ?? "";
  const [search, setSearch] = useState("");
  const [locality, setLocality] = useState("all");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<EntityView>(() => readView("sp-clients-view", "list"));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim());

  // Cambiar búsqueda o filtro siempre vuelve a la primera página
  // (reset de estado derivado durante el render, sin efecto).
  const filtersKey = `${debouncedSearch}|${locality}`;
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey);
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey);
    setPage(1);
  }

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (locality !== "all") params.set("locality", locality);

  const clientsQuery = useQuery({
    queryKey: ["clients", slug, "page", { page, search: debouncedSearch, locality }],
    // Mantiene la página anterior visible mientras llega la nueva (sin parpadeo).
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<Paginated<ClientListItem>>(`/clients?${params.toString()}`, common)
  });

  const localitiesQuery = useQuery({
    queryKey: ["clients", slug, "localities"],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiRequest<string[]>("/clients/localities", common)
  });

  const items = clientsQuery.data?.items ?? NO_ITEMS;
  const total = clientsQuery.data?.total ?? 0;
  const currentPage = clientsQuery.data?.page ?? page;
  const pageSize = clientsQuery.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (currentPage - 1) * pageSize;
  const localities = localitiesQuery.data ?? NO_LOCALITIES;
  const isLoading = clientsQuery.isLoading;

  return (
    <div className="sp-page padded">
      <EntityToolbar
        search={search}
        setSearch={setSearch}
        count={items.length}
        total={total}
        view={view}
        setView={(next) => {
          setView(next);
          writeView("sp-clients-view", next);
        }}
        placeholder="Buscar asegurados..."
        actionLabel="Nuevo asegurado"
        onAction={() => setIsModalOpen(true)}
      >
        <SearchableSelect
          value={locality}
          options={[
            { value: "all", label: "Todas las localidades" },
            ...localities.map((item) => ({ value: item, label: item }))
          ]}
          placeholder="Localidad"
          onChange={setLocality}
        />
      </EntityToolbar>
      <section className="sp-section-card wide">
        {clientsQuery.error ? <ErrorState text={clientsQuery.error.message} /> : null}
        {isLoading ? <LoadingState text="Cargando asegurados" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {items.map((client, index) => (
              <ClientCard
                key={client.id}
                client={client}
                color={AVATAR_COLORS[(start + index) % AVATAR_COLORS.length] ?? "#1d4ed8"}
                onSelect={onOpenClient}
              />
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {items.length > 0 ? (
              <div className="sp-list-header entity">
                <span>Asegurado</span>
                <span>Localidad</span>
                <span>Pólizas</span>
              </div>
            ) : null}
            {items.map((client, index) => (
              <ClientRow
                key={client.id}
                client={client}
                color={AVATAR_COLORS[(start + index) % AVATAR_COLORS.length] ?? "#1d4ed8"}
                onSelect={onOpenClient}
              />
            ))}
          </div>
        ) : null}
        {!isLoading && items.length === 0 ? (
          <EmptyState title="No se encontraron asegurados" text="Probá ajustar la búsqueda o crear un nuevo asegurado." />
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
      <ClientCreateModal
        isOpen={isModalOpen}
        isCreating={isCreating}
        onClose={() => setIsModalOpen(false)}
        onCreate={onCreate}
      />
    </div>
  );
}

function policyCount(client: ClientListItem) {
  return client.policies?.[0]?.count ?? 0;
}

function ClientCard({
  client,
  color,
  onSelect
}: {
  client: ClientListItem;
  color: string;
  onSelect: (client: ClientListItem) => void;
}) {
  const count = policyCount(client);
  return (
    <article className="sp-entity-card is-clickable" role="button" tabIndex={0} onClick={() => onSelect(client)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(client); } }}>
      <div className="sp-entity-head">
        <div className="sp-avatar" style={{ backgroundColor: color }}>{initials(client.full_name)}</div>
        <div>
          <h3>{client.full_name}</h3>
          {client.locality ? <p><MapPin size={12} />{client.locality}</p> : null}
        </div>
      </div>
      <div className="sp-entity-lines">
        {client.phone ? <span><Phone size={14} />{client.phone}</span> : null}
        {client.email ? <span><Mail size={14} />{client.email}</span> : null}
      </div>
      <div className="sp-entity-footer">
        <FileText size={14} />
        <span>{count} póliza{count === 1 ? "" : "s"}</span>
      </div>
    </article>
  );
}

function ClientRow({
  client,
  color,
  onSelect
}: {
  client: ClientListItem;
  color: string;
  onSelect: (client: ClientListItem) => void;
}) {
  const count = policyCount(client);
  return (
    <div className="sp-list-row entity client is-clickable" role="button" tabIndex={0} onClick={() => onSelect(client)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(client); } }}>
      <div className="sp-avatar small" style={{ backgroundColor: color }}>{initials(client.full_name)}</div>
      <div className="sp-list-main">
        <strong>{client.full_name}</strong>
        <span>{client.phone ?? client.email ?? client.dni ?? "Sin contacto"}</span>
      </div>
      <span>{client.locality ?? "-"}</span>
      <span className="sp-branch-tag">{count} pólizas</span>
    </div>
  );
}
