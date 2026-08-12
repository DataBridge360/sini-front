"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError, apiRequest, CLIENT_DUPLICATE_NAME, type ApiCommonOptions } from "@/lib/api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Modal } from "@/components/ui/modal";
import { LocalityCombobox } from "@/components/ui/selects";

type ClientMatch = { id: string; full_name: string };

// Dos asegurados con el mismo nombre y sin DNI no se pueden distinguir después
// (¿de cuál de los dos es esta póliza?, ¿a quién le entró el pago?), así que el
// DNI pasa a ser obligatorio cuando el nombre ya existe. La regla la aplica el
// backend en toda alta; acá se avisa mientras se escribe, antes de mandar.
function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-AR");
}

export function ClientCreateModal({
  isOpen,
  isCreating,
  common,
  // Nombre ya tipeado en el buscador que abrió este modal. Se toma una sola vez
  // al montar: quien lo cambie tiene que remontar el modal con `key`.
  initialName,
  onClose,
  onCreate
}: {
  isOpen: boolean;
  isCreating: boolean;
  common: ApiCommonOptions;
  initialName?: string | undefined;
  onClose: () => void;
  onCreate: (body: Record<string, FormDataEntryValue>) => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState(initialName ?? "");
  const [dni, setDni] = useState("");
  // Homónimo que reportó el backend al guardar (cuando la búsqueda en vivo no
  // llegó a correr o el asegurado se creó en otra pantalla mientras tanto).
  const [serverDuplicate, setServerDuplicate] = useState<string | null>(null);
  const dniRef = useRef<HTMLInputElement>(null);

  // Se busca contra el servidor y no sobre una lista en memoria porque el
  // listado de asegurados está paginado: el homónimo puede estar en otra página.
  const debouncedName = useDebouncedValue(fullName.trim(), 400);
  const normalized = normalizeName(debouncedName);
  const matches = useQuery({
    queryKey: ["client-name-check", common.organizationSlug, normalized],
    enabled: isOpen && normalized.length > 1,
    staleTime: 30_000,
    queryFn: () =>
      apiRequest<ClientMatch[]>(
        `/clients/search?q=${encodeURIComponent(debouncedName)}&limit=20`,
        common
      )
  });

  const liveDuplicate =
    normalized.length > 1
      ? matches.data?.find((client) => normalizeName(client.full_name) === normalized) ?? null
      : null;
  // El aviso del backend vale mientras no se cambie el nombre que lo disparó.
  const duplicateName =
    liveDuplicate?.full_name ??
    (serverDuplicate && normalizeName(serverDuplicate) === normalizeName(fullName) ? serverDuplicate : null);
  const needsDni = Boolean(duplicateName) && !dni.trim();

  const close = () => {
    setError(null);
    setFullName("");
    setDni("");
    setServerDuplicate(null);
    onClose();
  };

  return (
    <Modal title="Nuevo asegurado" isOpen={isOpen} onClose={close}>
      <form
        className="sp-form sp-modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          const formElement = event.currentTarget;
          if (needsDni) {
            dniRef.current?.focus();
            return;
          }
          try {
            await onCreate(Object.fromEntries(new FormData(formElement)));
            formElement.reset();
            close();
          } catch (caught) {
            if (caught instanceof ApiError && caught.code === CLIENT_DUPLICATE_NAME) {
              setServerDuplicate(fullName);
              setError(caught.message);
              dniRef.current?.focus();
              return;
            }
            setError(caught instanceof Error ? caught.message : "No se pudo crear el asegurado.");
          }
        }}
      >
        <div className="sp-form-section">
          <h3>Datos personales</h3>
          <label className="sp-field">
            <span>Nombre completo</span>
            <input
              name="fullName"
              placeholder="Nombre y apellido"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </label>
        </div>
        {duplicateName ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900">
            <AlertTriangle size={15} className="mt-px shrink-0 text-amber-600" />
            <p className="m-0">
              Ya hay un asegurado llamado <strong className="font-semibold">{duplicateName}</strong>. Cargá el DNI
              para diferenciarlos.
            </p>
          </div>
        ) : null}
        <div className="sp-form-grid">
          <label className="sp-field"><span>Teléfono</span><input name="phone" placeholder="Teléfono" /></label>
          <label className="sp-field"><span>Email</span><input name="email" type="email" placeholder="correo@dominio.com" /></label>
        </div>
        <div className="sp-form-grid">
          <label className="sp-field">
            <span>{duplicateName ? "DNI (obligatorio)" : "DNI"}</span>
            <input
              ref={dniRef}
              name="dni"
              placeholder="Documento"
              value={dni}
              onChange={(event) => setDni(event.target.value)}
              aria-invalid={needsDni}
            />
          </label>
          <LocalityCombobox name="locality" />
        </div>
        {error ? <div className="sp-pay-error">{error}</div> : null}
        <div className="sp-modal-actions">
          <button className="sp-secondary-action" type="button" onClick={close} disabled={isCreating}>Cancelar</button>
          <button className="sp-primary-action" type="submit" disabled={isCreating || needsDni}>
            {isCreating ? <span className="sp-button-spinner" aria-hidden="true" /> : <Plus size={14} />}
            {isCreating ? "Cargando..." : "Agregar asegurado"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

