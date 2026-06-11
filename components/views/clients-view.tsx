"use client";

import { FileText, Mail, MapPin, Phone } from "lucide-react";
import { useMemo, useState } from "react";
import type { Client, Policy } from "@/lib/api";
import { readView, writeView } from "@/lib/browser";
import { AVATAR_COLORS, initials } from "@/lib/format";
import type { EntityView } from "@/lib/shell-types";
import { ClientCreateModal } from "@/components/clients/client-create-modal";
import { EntityToolbar } from "@/components/ui/entity-toolbar";
import { SearchableSelect } from "@/components/ui/selects";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

export function ClientsView({
  clients,
  policies,
  isLoading,
  isCreating,
  error,
  onOpenClient,
  onCreate
}: {
  clients: Client[];
  policies: Policy[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  onOpenClient: (client: Client) => void;
  onCreate: (body: Record<string, FormDataEntryValue>) => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const [locality, setLocality] = useState("all");
  const [view, setView] = useState<EntityView>(() => readView("sp-clients-view", "list"));
  const [isModalOpen, setIsModalOpen] = useState(false);

  const localities = useMemo(
    () => Array.from(new Set(clients.map((client) => client.locality).filter(Boolean) as string[])).sort(),
    [clients]
  );

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter((client) =>
      (locality === "all" || client.locality === locality) &&
      [client.full_name, client.email, client.phone, client.locality, client.dni]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [clients, locality, search]);

  return (
    <div className="sp-page padded">
      <EntityToolbar
        search={search}
        setSearch={setSearch}
        count={filtered.length}
        total={clients.length}
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
        {error ? <ErrorState text={error} /> : null}
        {isLoading ? <LoadingState text="Cargando asegurados" /> : null}
        {!isLoading && view === "grid" ? (
          <div className="sp-card-grid">
            {filtered.map((client, index) => (
              <ClientCard key={client.id} client={client} policies={policies} color={AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#1d4ed8"} onSelect={onOpenClient} />
            ))}
          </div>
        ) : null}
        {!isLoading && view === "list" ? (
          <div className="sp-list-panel embedded">
            {filtered.length > 0 ? (
              <div className="sp-list-header entity">
                <span>Asegurado</span>
                <span>Localidad</span>
                <span>Pólizas</span>
              </div>
            ) : null}
            {filtered.map((client, index) => (
              <ClientRow key={client.id} client={client} policies={policies} color={AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#1d4ed8"} onSelect={onOpenClient} />
            ))}
          </div>
        ) : null}
        {!isLoading && filtered.length === 0 ? <EmptyState title="No se encontraron asegurados" text="Probá ajustar la búsqueda o crear un nuevo asegurado." /> : null}
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

function ClientCard({
  client,
  policies,
  color,
  onSelect
}: {
  client: Client;
  policies: Policy[];
  color: string;
  onSelect: (client: Client) => void;
}) {
  const count = policies.filter((policy) => policy.clients?.id === client.id).length;
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
  policies,
  color,
  onSelect
}: {
  client: Client;
  policies: Policy[];
  color: string;
  onSelect: (client: Client) => void;
}) {
  const count = policies.filter((policy) => policy.clients?.id === client.id).length;
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

