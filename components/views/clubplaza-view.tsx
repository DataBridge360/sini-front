"use client";

/*
Dirección (extensión dentro del mundo Sinipro establecido):
THESIS: la planilla de papel FECHA/EQUIPO/JUGADOR/PAGO/ATENDIÓ digitalizada como
  registro operativo escaneable; rechaza el dashboard de tarjetas con métricas.
OWN-WORLD: sistema incumbente Sinipro — superficies blancas, borde 1px, sin
  sombras, tipografía 13px, color solo para estado (ámbar=pendiente,
  verde=pagado) y acento --org-primary.
STORY: el empleado registra en segundos a quién atendió y cómo pagó; los
  jugadores nuevos de la carga masiva entran solos como pendientes y se
  completan EN LA MISMA FILA, sin abrir nada.
FIRST VIEWPORT: toolbar (búsqueda + registrar + carga masiva), fila de filtros
  compactos, tabla densa con celdas editables; paginación server-side al pie.
FORM: extensión directa del shell (pedido precisamente especificado, sin
  concept tournament).
*/

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest, type ApiCommonOptions, type OrganizationMember, type Paginated } from "@/lib/api";
import {
  isRegistrationPending,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type ImportResult,
  type PlayerCorrection,
  type Registration,
  type RegistrationFilters,
  type RegistrationFormPayload,
  type RegistrationPatch
} from "@/lib/clubplaza";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { BulkImportWizard } from "@/components/clubplaza/bulk-import-wizard";
import {
  AttendedCell,
  DateCell,
  PayerCell,
  PayerSuggestions,
  PaymentCell,
  type CellSaveHandler
} from "@/components/clubplaza/registration-cells";
import { RegistrationModal } from "@/components/clubplaza/registration-modal";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { SearchableSelect } from "@/components/ui/selects";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import type { ToastMessage } from "@/components/ui/toast";

const PAGE_SIZE = 20;
const NO_MEMBERS: OrganizationMember[] = [];
const NO_ITEMS: Registration[] = [];
const NO_PAYERS: string[] = [];

const EMPTY_FILTERS: RegistrationFilters = {
  search: "",
  pagador: "",
  paymentMethod: "",
  attendedBy: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  birthDate: ""
};

const FILTER_SELECT_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-[var(--org-primary)] focus:ring-2 focus:ring-[var(--org-primary-soft)]";

// Aplica sobre la fila en caché lo mismo que va a guardar el PATCH, para que la
// celda se vea completa antes de que conteste el servidor.
function applyPatch(
  registration: Registration,
  patch: RegistrationPatch,
  members: OrganizationMember[]
): Registration {
  const next: Registration = { ...registration };
  if (patch.registeredOn !== undefined) next.registered_on = patch.registeredOn;
  if (patch.payerName !== undefined) next.payer_name = patch.payerName;
  if (patch.paymentMethod !== undefined) next.payment_method = patch.paymentMethod;
  if (patch.attendedByUserId !== undefined) {
    next.attended_by_user_id = patch.attendedByUserId;
    const member = members.find((candidate) => candidate.id === patch.attendedByUserId);
    // Si el usuario ya no está en la lista de miembros se conserva el embed
    // anterior (quien atendió puede haber sido dado de baja).
    next.attended_by = member
      ? { id: member.id, full_name: member.full_name }
      : patch.attendedByUserId
        ? registration.attended_by
        : null;
  }
  return next;
}

export function ClubplazaView({
  common,
  currentUserId,
  canManage,
  notify
}: {
  common: ApiCommonOptions;
  currentUserId: string;
  canManage: boolean;
  notify: (message: string, tone?: ToastMessage["tone"]) => void;
}) {
  const queryClient = useQueryClient();
  const slug = common.organizationSlug ?? "";
  const token = common.token;

  const [filters, setFilters] = useState<RegistrationFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  // La planilla ya no tiene "editar": el modal solo da de alta un jugador.
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Registration | null>(null);
  const debouncedSearch = useDebouncedValue(filters.search.trim());

  // Cambiar cualquier filtro vuelve a la primera página (ajuste durante render).
  const filtersKey = JSON.stringify({ ...filters, search: debouncedSearch });
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey);
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey);
    setPage(1);
  }

  const buildQueryString = (targetPage: number) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filters.pagador) params.set("pagador", filters.pagador);
    if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
    if (filters.attendedBy) params.set("attendedBy", filters.attendedBy);
    if (filters.status) params.set("status", filters.status);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.birthDate) params.set("birthDate", filters.birthDate);
    return params.toString();
  };

  const listKey = ["cp-registrations", slug, { page, filters: filtersKey }] as const;

  const registrationsQuery = useQuery({
    queryKey: listKey,
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<Paginated<Registration>>(`/club-plaza-registrations?${buildQueryString(page)}`, common)
  });

  const membersQuery = useQuery({
    queryKey: ["organization-members", slug],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiRequest<OrganizationMember[]>("/organizations/current/members", common)
  });

  // Pagadores ya usados: una sola request para toda la planilla; el filtrado
  // mientras se tipea lo hace el navegador contra el <datalist>.
  const payersQuery = useQuery({
    queryKey: ["cp-payers", slug],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiRequest<string[]>("/club-plaza-registrations/payers", common)
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cp-registrations", slug] });

  const items = registrationsQuery.data?.items ?? NO_ITEMS;
  const total = registrationsQuery.data?.total ?? 0;
  const currentPage = registrationsQuery.data?.page ?? page;
  const pageSize = registrationsQuery.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (currentPage - 1) * pageSize;
  const members = membersQuery.data ?? NO_MEMBERS;
  const payers = payersQuery.data ?? NO_PAYERS;
  const hasActiveFilters = filtersKey !== JSON.stringify({ ...EMPTY_FILTERS, search: "" });
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "search" && Boolean(value)).length;
  const isLoading = registrationsQuery.isLoading;

  // Se adelanta UNA request: la página siguiente queda en caché para que pasar
  // de página sea instantáneo. Nunca hay una request por fila.
  const nextPage = currentPage + 1;
  const shouldPrefetch = !registrationsQuery.isPlaceholderData && nextPage <= totalPages;
  const nextPageQuery = shouldPrefetch ? buildQueryString(nextPage) : "";
  useEffect(() => {
    if (!nextPageQuery) return;
    void queryClient.prefetchQuery({
      queryKey: ["cp-registrations", slug, { page: nextPage, filters: filtersKey }],
      staleTime: 30 * 1000,
      queryFn: () =>
        apiRequest<Paginated<Registration>>(`/club-plaza-registrations?${nextPageQuery}`, {
          token,
          organizationSlug: slug
        })
    });
  }, [queryClient, nextPageQuery, nextPage, filtersKey, slug, token]);

  const createRegistration = useMutation({
    mutationFn: (payload: RegistrationFormPayload) =>
      apiRequest<Registration>("/club-plaza-registrations", { ...common, method: "POST", body: payload }),
    onSuccess: () => {
      notify("Registro creado.");
      void queryClient.invalidateQueries({ queryKey: ["cp-payers", slug] });
      return invalidate();
    },
    onError: (error) => notify(error.message, "error")
  });

  // Edición inline: PATCH de una sola celda, aplicado optimista sobre la página
  // que ya está en caché. No se refetchea el listado en cada tecla ni en cada
  // selección — solo se marcan obsoletas las demás páginas.
  const patchRegistration = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RegistrationPatch }) =>
      apiRequest<Registration>(`/club-plaza-registrations/${id}`, { ...common, method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      const key = listKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Paginated<Registration>>(key);
      queryClient.setQueryData<Paginated<Registration>>(key, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === id ? applyPatch(item, patch, members) : item))
            }
          : current
      );
      return { key, previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      notify(error.message, "error");
      // Tras un error se resincroniza la página visible con el servidor.
      return invalidate();
    },
    onSuccess: (_updated, variables) => {
      // El valor optimista ya es el que guardó el servidor, así que no se pisa
      // la fila (dos PATCH en vuelo podrían llegar desordenados y revertirse).
      if (variables.patch.payerName) {
        void queryClient.invalidateQueries({ queryKey: ["cp-payers", slug] });
      }
      void queryClient.invalidateQueries({
        queryKey: ["cp-registrations", slug],
        refetchType: "none"
      });
    }
  });

  const deleteRegistration = useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ ok: boolean }>(`/club-plaza-registrations/${id}`, { ...common, method: "DELETE" }),
    onSuccess: () => {
      notify("Registro eliminado.");
      setDeleteTarget(null);
      return invalidate();
    },
    onError: (error) => notify(error.message, "error")
  });

  // Los jugadores nuevos de la carga masiva entran a la planilla como
  // pendientes (sin pagador, pago ni atendido) para completarlos después.
  const bulkAdd = useMutation({
    mutationFn: (players: Array<{ fullName: string; dni: string; birthDate: string | null }>) =>
      apiRequest<{ inserted: number; skipped: number }>("/club-plaza-registrations/bulk", {
        ...common,
        method: "POST",
        body: { players }
      }),
    onSuccess: (result) => {
      if (result.inserted > 0) {
        notify(`${result.inserted} jugador${result.inserted === 1 ? "" : "es"} agregado${result.inserted === 1 ? "" : "s"} a la planilla como pendiente${result.inserted === 1 ? "" : "s"}.`);
      }
      return invalidate();
    },
    onError: (error) => notify(error.message, "error")
  });

  // Correcciones de datos del jugador aplicadas en Club Plaza: se replican en
  // las filas de la planilla que tengan ese DNI.
  const applyCorrections = useMutation({
    mutationFn: (corrections: PlayerCorrection[]) =>
      apiRequest<{ updated: number }>("/club-plaza-registrations/corrections", {
        ...common,
        method: "POST",
        body: { corrections }
      }),
    onSuccess: (result) => {
      if (result.updated > 0) {
        notify(`${result.updated} registro${result.updated === 1 ? "" : "s"} de la planilla corregido${result.updated === 1 ? "" : "s"} con los datos nuevos.`);
      }
      return invalidate();
    },
    onError: (error) => notify(error.message, "error")
  });

  const handleImportComplete = (result: ImportResult, corrections: PlayerCorrection[]) => {
    const players = result.created_players.map((player) => ({
      fullName: player.nombre_completo,
      dni: player.dni,
      birthDate: player.fecha_nacimiento ? player.fecha_nacimiento.slice(0, 10) : null
    }));
    if (players.length > 0) {
      bulkAdd.mutate(players);
    }
    if (corrections.length > 0) {
      applyCorrections.mutate(corrections);
    }
  };

  const savePatch = (id: string): CellSaveHandler => (patch) => patchRegistration.mutate({ id, patch });

  const setFilter = <K extends keyof RegistrationFilters>(key: K, value: RegistrationFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (

    <div className="sp-page padded cp-page">
      <header className="cp-page-heading">
        <div>
          <h2>Planilla de jugadores</h2>
          <p>Completá el pago, quién atendió y el pagador en la misma fila.</p>
        </div>
        <span className="cp-record-count" aria-live="polite">
          {total} registro{total === 1 ? "" : "s"}
        </span>
      </header>

      <div className="cp-command-bar">
        <div className="sp-search cp-search">
          <Search size={15} />
          <input
            aria-label="Buscar por jugador o DNI"
            placeholder="Buscar por jugador o DNI..."
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`cp-pending-filter ${
            filters.status === "pendiente"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
          onClick={() => setFilter("status", filters.status === "pendiente" ? "" : "pendiente")}
        >
          Pendientes
        </button>
        <div className="cp-command-actions">
          <button className="sp-secondary-action" type="button" onClick={() => setIsWizardOpen(true)}>
            <Upload size={14} />
            <span>Carga masiva</span>
          </button>
          <button className="sp-primary-action" type="button" onClick={() => setIsRegistrationOpen(true)}>
            <Plus size={14} />
            <span>Registrar jugador</span>
          </button>
        </div>
      </div>

      <details className="cp-filters" open={hasActiveFilters}>
        <summary>
          <span>Filtros</span>
          {activeFilterCount > 0 ? <b>{activeFilterCount} activos</b> : <em>Fecha, pagador, pago y atención</em>}
        </summary>
        <div className="cp-filter-fields">
          <label className="cp-date-field"><span>Desde</span><DatePicker value={filters.dateFrom} onChange={(value) => setFilter("dateFrom", value)} ariaLabel="Filtrar desde fecha" /></label>
          <label className="cp-date-field"><span>Hasta</span><DatePicker value={filters.dateTo} onChange={(value) => setFilter("dateTo", value)} ariaLabel="Filtrar hasta fecha" /></label>
          <label className="cp-date-field"><span>Pagador</span><input className={FILTER_SELECT_CLASS} value={filters.pagador} onChange={(event) => setFilter("pagador", event.target.value)} placeholder="Pagador" aria-label="Filtrar por pagador" maxLength={180} /></label>
          <label className="cp-date-field">
            <span>Tipo de pago</span>
            <select className={FILTER_SELECT_CLASS} value={filters.paymentMethod} onChange={(event) => setFilter("paymentMethod", event.target.value)} aria-label="Filtrar por tipo de pago">
              <option value="">Todos los pagos</option>
              {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>)}
            </select>
          </label>
          <label className="cp-date-field"><span>Atendió</span><SearchableSelect value={filters.attendedBy} options={[{ value: "", label: "Atendió: todos" }, ...members.map((member) => ({ value: member.id, label: member.full_name }))]} placeholder="Atendió" onChange={(value) => setFilter("attendedBy", value)} /></label>
          <label className="cp-date-field"><span>Fecha de nacimiento</span><DatePicker value={filters.birthDate} onChange={(value) => setFilter("birthDate", value)} ariaLabel="Filtrar por fecha de nacimiento" /></label>
          {hasActiveFilters ? <button type="button" className="cp-clear-filters" onClick={() => setFilters(EMPTY_FILTERS)}><X size={13} /> Limpiar filtros</button> : null}
        </div>
      </details>

      <section className="sp-section-card wide">
        {registrationsQuery.error ? <ErrorState text={registrationsQuery.error.message} /> : null}
        {isLoading ? <LoadingState text="Cargando planilla" /> : null}

        {!isLoading && items.length > 0 ? (
          <>
            <div className="cp-desktop-table overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2">Fecha</th>
                    <th className="px-2 py-2">Jugador</th>
                    <th className="px-2 py-2">DNI</th>
                    <th className="px-2 py-2">F. nac.</th>
                    <th className="cp-col-edit px-2 py-2">Pagador</th>
                    <th className="cp-col-edit px-2 py-2">Pago</th>
                    <th className="cp-col-edit px-2 py-2">Atendió</th>
                    <th className="px-2 py-2" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((registration) => (
                    <RegistrationRow
                      key={registration.id}
                      registration={registration}
                      members={members}
                      canDelete={canManage || registration.created_by_user_id === currentUserId}
                      onSave={savePatch(registration.id)}
                      onDelete={() => setDeleteTarget(registration)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cp-mobile-list">
              {items.map((registration) => (
                <RegistrationMobileCard
                  key={registration.id}
                  registration={registration}
                  members={members}
                  canDelete={canManage || registration.created_by_user_id === currentUserId}
                  onSave={savePatch(registration.id)}
                  onDelete={() => setDeleteTarget(registration)}
                />
              ))}
            </div>
            <PayerSuggestions payers={payers} />
          </>
        ) : null}

        {!isLoading && items.length === 0 && !registrationsQuery.error ? (
          <EmptyState
            title="Todavía no hay registros"
            text="Registrá un jugador o hacé una carga masiva: los jugadores nuevos entran solos como pendientes."
          />
        ) : null}

        {!isLoading && items.length > 0 ? (
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

      <RegistrationModal
        isOpen={isRegistrationOpen}
        members={members}
        currentUserId={currentUserId}
        isSaving={createRegistration.isPending}
        onClose={() => setIsRegistrationOpen(false)}
        onSave={(payload) => createRegistration.mutateAsync(payload)}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Eliminar registro"
        message={`Se va a eliminar el registro de ${deleteTarget?.player_full_name ?? ""} (DNI ${deleteTarget?.player_dni ?? ""}) solo de esta planilla — el jugador NO se borra de Club Plaza. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        isBusy={deleteRegistration.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteRegistration.mutate(deleteTarget.id);
        }}
      />

      {/* La carga masiva es para todos los roles: el proxy solo pide sesión
          activa de SiniPro, no un rol en particular. */}
      <BulkImportWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onImportComplete={handleImportComplete}
        notify={notify}
      />
    </div>

  );
}

function RegistrationRow({
  registration,
  members,
  canDelete,
  onSave,
  onDelete
}: {
  registration: Registration;
  members: OrganizationMember[];
  canDelete: boolean;
  onSave: CellSaveHandler;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0">
      <td className="cp-col-locked whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">
        <DateCell registration={registration} onSave={onSave} />
      </td>
      <td className="cp-col-locked px-2 py-1.5">
        <span className="text-[13px] font-semibold text-slate-950">{registration.player_full_name}</span>
      </td>
      <td className="cp-col-locked whitespace-nowrap px-2 py-1.5 font-mono text-xs text-slate-600">
        {registration.player_dni}
      </td>
      <td className="cp-col-locked whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">
        {registration.player_birth_date ? formatDate(registration.player_birth_date) : "—"}
      </td>
      <td className="cp-col-edit px-2 py-1.5">
        <PayerCell registration={registration} onSave={onSave} />
      </td>
      <td className="cp-col-edit whitespace-nowrap px-2 py-1.5">
        <PaymentCell registration={registration} onSave={onSave} />
      </td>
      <td className="cp-col-edit whitespace-nowrap px-2 py-1.5">
        <AttendedCell registration={registration} members={members} onSave={onSave} />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        {canDelete ? (
          <button
            type="button"
            aria-label={`Eliminar registro de ${registration.player_full_name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function RegistrationMobileCard({
  registration,
  members,
  canDelete,
  onSave,
  onDelete
}: {
  registration: Registration;
  members: OrganizationMember[];
  canDelete: boolean;
  onSave: CellSaveHandler;
  onDelete: () => void;
}) {
  const pending = isRegistrationPending(registration);
  return (
    <article className="cp-registration-card">
      <div className="cp-registration-main">
        <div>
          <h3>{registration.player_full_name}</h3>
          <p>DNI {registration.player_dni} · {registration.player_birth_date ? formatDate(registration.player_birth_date) : "Sin fecha de nacimiento"}</p>
        </div>
        {pending ? <span className="cp-payment pending">Pendiente</span> : null}
      </div>
      <div className="cp-registration-editors">
        <label><span>Fecha</span><DateCell registration={registration} onSave={onSave} /></label>
        <label className="cp-field-edit"><span>Pago</span><PaymentCell registration={registration} onSave={onSave} /></label>
        <label className="cp-field-edit"><span>Pagador</span><PayerCell registration={registration} onSave={onSave} /></label>
        <label className="cp-field-edit"><span>Atendió</span><AttendedCell registration={registration} members={members} onSave={onSave} /></label>
      </div>
      {canDelete ? (
        <div className="cp-registration-actions">
          <button type="button" aria-label={`Eliminar registro de ${registration.player_full_name}`} className="cp-delete-action" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      ) : null}
    </article>
  );
}
