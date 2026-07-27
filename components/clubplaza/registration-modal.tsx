"use client";

// Alta de una fila de la planilla Club Plaza.
//
// Regla: NO se puede registrar un jugador que no exista en Club Plaza. Acá solo
// se tipea el DNI; el lookup (debounced, disparado desde el input) trae nombre y
// fecha de nacimiento desde Club Plaza y sin match no se puede guardar. Lo
// administrativo (fecha, pagador, pago y quién atendió) se puede dejar vacío: la
// fila entra pendiente y se completa después EN LA PLANILLA, celda por celda —
// la edición por modal se sacó.
//
// El formulario vive en un componente interno que se monta fresco en cada
// apertura (el Modal desmonta children al cerrarse), así los useState
// inicializan directo de props sin efectos ni ajustes durante render.

import { CheckCircle2, Loader2, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OrganizationMember } from "@/lib/api";
import {
  clubplazaPlayerLookup,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type RegistrationFormPayload
} from "@/lib/clubplaza";
import { toIsoDate } from "@/lib/format";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { SearchableSelect } from "@/components/ui/selects";

const SELECT_CLASS =
  "block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[var(--org-primary)] focus:ring-2 focus:ring-[var(--org-primary-soft)]";

type LookupState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; nombre: string; fechaNacimiento: string | null; pagado: boolean }
  | { kind: "not-found" };

export function RegistrationModal({
  isOpen,
  members,
  currentUserId,
  isSaving,
  onClose,
  onSave
}: {
  isOpen: boolean;
  members: OrganizationMember[];
  currentUserId: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (payload: RegistrationFormPayload) => Promise<unknown>;
}) {
  return (
    <Modal title="Registrar jugador" isOpen={isOpen} onClose={() => (isSaving ? undefined : onClose())}>
      <RegistrationForm
        members={members}
        currentUserId={currentUserId}
        isSaving={isSaving}
        onClose={onClose}
        onSave={onSave}
      />
    </Modal>
  );
}

function RegistrationForm({
  members,
  currentUserId,
  isSaving,
  onClose,
  onSave
}: {
  members: OrganizationMember[];
  currentUserId: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (payload: RegistrationFormPayload) => Promise<unknown>;
}) {
  const [registeredOn, setRegisteredOn] = useState(() => toIsoDate(new Date()));
  const [playerDni, setPlayerDni] = useState("");
  const [payerName, setPayerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [attendedBy, setAttendedBy] = useState(currentUserId);
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const lookupTimer = useRef<number | null>(null);

  // Al desmontar (cerrar el modal) se cancela cualquier búsqueda programada.
  useEffect(
    () => () => {
      if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    },
    []
  );

  // Disparado desde el onChange del DNI: debounce manual + fetch a Club Plaza.
  const scheduleLookup = (dni: string) => {
    if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    if (!/^\d{7,10}$/.test(dni)) {
      setLookup({ kind: "idle" });
      return;
    }
    lookupTimer.current = window.setTimeout(async () => {
      setLookup({ kind: "searching" });
      try {
        const result = await clubplazaPlayerLookup(dni);
        if (result.found) {
          setLookup({
            kind: "found",
            nombre: result.nombre_completo,
            fechaNacimiento: result.fecha_nacimiento,
            pagado: result.pagado
          });
        } else {
          setLookup({ kind: "not-found" });
        }
      } catch {
        // Sin respuesta de Club Plaza no se puede validar el DNI → no se
        // habilita el guardado (queda en idle para reintentar).
        setLookup({ kind: "idle" });
      }
    }, 450);
  };

  const handleSubmit = async () => {
    // Nombre y fecha de nacimiento salen SIEMPRE del lookup.
    if (lookup.kind !== "found") return;
    try {
      await onSave({
        registeredOn,
        playerFullName: lookup.nombre,
        playerDni: playerDni.trim(),
        playerBirthDate: lookup.fechaNacimiento,
        payerName: payerName.trim() || null,
        paymentMethod: (paymentMethod || null) as PaymentMethod | null,
        attendedByUserId: attendedBy || null
      });
      onClose();
    } catch {
      // El error lo notifica la vista (toast); el modal queda abierto.
    }
  };

  const canSave = registeredOn !== "" && lookup.kind === "found";

  return (
    <form
      className="sp-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !isSaving) void handleSubmit();
      }}
    >
      <label className="sp-field">
        <span>DNI del jugador</span>
        <input
          value={playerDni}
          onChange={(event) => {
            const next = event.target.value.replace(/\D/g, "");
            setPlayerDni(next);
            scheduleLookup(next);
          }}
          placeholder="Tipeá el DNI y se traen los datos"
          inputMode="numeric"
          maxLength={10}
          required
          autoFocus
        />
      </label>
      {lookup.kind === "searching" ? (
        <p className="m-0 -mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          <Loader2 size={12} className="animate-spin" />
          Buscando en Club Plaza...
        </p>
      ) : null}
      {lookup.kind === "found" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-900">
              <CheckCircle2 size={14} className="text-emerald-600" />
              {lookup.nombre}
            </span>
            {lookup.fechaNacimiento ? (
              <span className="text-xs text-emerald-700">
                Nac. {lookup.fechaNacimiento.split("-").reverse().join("/")}
              </span>
            ) : null}
          </div>
          <p className="m-0 mt-1 text-[11px] text-emerald-700/80">
            Datos traídos de Club Plaza — no se editan acá.
          </p>
        </div>
      ) : null}
      {lookup.kind === "not-found" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <UserX size={14} />
            Este DNI no está en Club Plaza.
          </p>
          <p className="m-0 mt-1 text-[11px] text-amber-700/90">
            Solo se pueden registrar jugadores que existen en Club Plaza. Cargalo primero con la
            carga masiva y después registrá el pago acá.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
        <label className="sp-field">
          <span>Fecha</span>
          <DatePicker value={registeredOn} onChange={setRegisteredOn} ariaLabel="Fecha del registro" required />
        </label>
        <label className="sp-field">
          <span>Pago</span>
          <select
            className={SELECT_CLASS}
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
          >
            <option value="">Pendiente</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_LABELS[method]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="sp-field">
        <span>Pagador</span>
        <input
          value={payerName}
          onChange={(event) => setPayerName(event.target.value)}
          placeholder="Quién pagó estos seguros"
          maxLength={180}
        />
      </label>

      <SearchableSelect
        label="Atendió"
        value={attendedBy}
        options={[
          { value: "", label: "Pendiente" },
          ...members.map((member) => ({ value: member.id, label: member.full_name }))
        ]}
        placeholder="Quién lo atendió"
        onChange={setAttendedBy}
      />

      <div className="sp-modal-actions">
        <button className="sp-secondary-action" type="button" onClick={onClose} disabled={isSaving}>
          Cancelar
        </button>
        <button className="sp-primary-action" type="submit" disabled={!canSave || isSaving}>
          {isSaving ? <span className="sp-button-spinner" aria-hidden="true" /> : null}
          {isSaving ? "Guardando..." : "Registrar"}
        </button>
      </div>
    </form>
  );
}
