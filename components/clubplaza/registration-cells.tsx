"use client";

// Celdas editables de la planilla Club Plaza.
//
// La planilla no tiene "editar": cada celda administrativa (fecha, pagador,
// pago y atendió) se completa en el lugar, como en el papel. Cada cambio manda
// un PATCH con SOLO ese campo; la vista lo aplica optimista sobre la página que
// ya está en caché, así completar una fila no vuelve a pedir el listado.
//
// Los datos del jugador (nombre, DNI, fecha de nacimiento) siguen siendo un
// snapshot de Club Plaza y no se editan acá.

import { ChevronDown } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { OrganizationMember } from "@/lib/api";
import {
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type Registration,
  type RegistrationPatch
} from "@/lib/clubplaza";
import { DatePicker } from "@/components/ui/date-picker";

// Un solo <datalist> compartido por todas las filas: las sugerencias de pagador
// se piden una vez por página, no una por celda.
export const PAYER_DATALIST_ID = "cp-payer-suggestions";

export type CellSaveHandler = (patch: RegistrationPatch) => void;

function CellSelect({
  value,
  ariaLabel,
  className,
  onChange,
  children
}: {
  value: string;
  ariaLabel: string;
  className: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <span className={`cp-cell-select ${className}`}>
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown size={12} aria-hidden="true" />
    </span>
  );
}

export function PaymentCell({
  registration,
  onSave
}: {
  registration: Registration;
  onSave: CellSaveHandler;
}) {
  const value = registration.payment_method ?? "";
  return (
    <CellSelect
      ariaLabel={`Pago de ${registration.player_full_name}`}
      className={value ? "is-paid" : "is-pending"}
      value={value}
      onChange={(next) => {
        if (next === value) return;
        onSave({ paymentMethod: (next || null) as PaymentMethod | null });
      }}
    >
      <option value="">Pendiente</option>
      {PAYMENT_METHODS.map((method) => (
        <option key={method} value={method}>
          {PAYMENT_LABELS[method]}
        </option>
      ))}
    </CellSelect>
  );
}

export function AttendedCell({
  registration,
  members,
  onSave
}: {
  registration: Registration;
  members: OrganizationMember[];
  onSave: CellSaveHandler;
}) {
  const value = registration.attended_by_user_id ?? "";
  // Si quien atendió ya no es miembro activo, igual se lo muestra: sin esta
  // opción el select quedaría en blanco y el primer cambio borraría el dato.
  const known = members.some((member) => member.id === value);
  const orphan = !known && value ? registration.attended_by : null;

  return (
    <CellSelect
      ariaLabel={`Quién atendió a ${registration.player_full_name}`}
      className={value ? "is-set" : "is-empty"}
      value={value}
      onChange={(next) => {
        if (next === value) return;
        onSave({ attendedByUserId: next || null });
      }}
    >
      <option value="">Pendiente</option>
      {orphan ? <option value={orphan.id}>{orphan.full_name}</option> : null}
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.full_name}
        </option>
      ))}
    </CellSelect>
  );
}

export function PayerCell({
  registration,
  onSave
}: {
  registration: Registration;
  onSave: CellSaveHandler;
}) {
  const serverValue = registration.payer_name ?? "";
  const [draft, setDraft] = useState(serverValue);
  // El borrador sigue al servidor: se resincroniza cuando el PATCH confirma y
  // también cuando se revierte por error (ajuste durante render, sin efecto).
  const [lastServerValue, setLastServerValue] = useState(serverValue);
  if (serverValue !== lastServerValue) {
    setLastServerValue(serverValue);
    setDraft(serverValue);
  }

  // Escape descarta: el blur que dispara ve todavía el valor tipeado en el DOM,
  // así que se marca acá para que ese blur no guarde nada.
  const cancelled = useRef(false);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next === serverValue) {
      setDraft(serverValue);
      return;
    }
    setDraft(next);
    onSave({ payerName: next || null });
  };

  return (
    <input
      className="cp-cell-input"
      aria-label={`Pagador de ${registration.player_full_name}`}
      list={PAYER_DATALIST_ID}
      value={draft}
      placeholder="Pagador"
      maxLength={180}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(serverValue);
          return;
        }
        commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function DateCell({
  registration,
  onSave
}: {
  registration: Registration;
  onSave: CellSaveHandler;
}) {
  return (
    // div y no span: el DatePicker renderiza un bloque (span solo admite
    // contenido de frase).
    <div className="cp-cell-date">
      <DatePicker
        value={registration.registered_on}
        ariaLabel={`Fecha del registro de ${registration.player_full_name}`}
        onChange={(next) => {
          if (!next || next === registration.registered_on) return;
          onSave({ registeredOn: next });
        }}
      />
    </div>
  );
}

// Lista de sugerencias compartida (se monta una sola vez por vista).
export function PayerSuggestions({ payers }: { payers: string[] }) {
  return (
    <datalist id={PAYER_DATALIST_ID}>
      {payers.map((payer) => (
        <option key={payer} value={payer} />
      ))}
    </datalist>
  );
}
