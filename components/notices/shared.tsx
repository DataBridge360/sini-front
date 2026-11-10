"use client";

import { AlertTriangle, Bell, CalendarDays, Check, CheckCircle, ChevronDown, Clock, Copy, Loader2, Mail, MessageSquare, Phone, Save, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Notice } from "@/lib/api";
import { dueLabel } from "@/lib/format";
import {
  describeHandlingAge,
  describeNoticeHandlingLine,
  type NoticeContact,
  type NoticeHandling,
  type NoticeStatus
} from "@/lib/notices";
import type { NoticeNoteApi } from "@/lib/shell-types";
import { ConfirmDialog } from "@/components/ui/modal";

export const NOTICE_COLUMNS = [
  { key: "avisar" as const, label: "Avisar", hint: "Pendientes de contactar", dot: "#f59e0b", icon: AlertTriangle },
  { key: "avisado" as const, label: "Avisados", hint: "Ya contactados, falta el pago", dot: "#4d8eff", icon: Clock },
  { key: "pagado" as const, label: "Pagados", hint: "Pago registrado", dot: "#4ae176", icon: CheckCircle }
];

export function DueChip({ days, status }: { days: number; status: NoticeStatus }) {
  const tone =
    status === "pagado"
      ? { className: "bg-emerald-50 text-emerald-700", Icon: CheckCircle }
      : days < 0
        ? { className: "bg-red-50 text-red-700", Icon: AlertTriangle }
        : days <= 7
          ? { className: "bg-amber-50 text-amber-700", Icon: Clock }
          : { className: "bg-slate-100 text-slate-600", Icon: CalendarDays };
  const Icon = tone.Icon;

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.className}`}>
      <Icon size={11} />
      {dueLabel(days)}
    </span>
  );
}


// Nota del asegurado (la de su ficha, no las notas internas del aviso). Suele
// traer requisitos para contactarlo — "avisar por correo", "hablar con la
// hija", "no llamar al fijo" —, así que tiene que verse en el tablero y antes
// de marcar avisado, no solo abriendo el detalle.
// 'card' la recorta a dos líneas para no desarmar la tarjeta; 'block' la
// muestra completa.
export function ClientNote({
  note,
  variant = "block"
}: {
  note: string | null | undefined;
  variant?: "block" | "card";
}) {
  const text = note?.trim();
  if (!text) return null;

  if (variant === "card") {
    // Sin elementos hijos de por medio: la fila de la vista lista estiliza sus
    // <span> internos y pisaría tanto el recorte como el color de la nota.
    return (
      <p
        className="m-0 mt-1.5 line-clamp-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900"
        title={text}
      >
        <StickyNote size={11} className="mr-1 inline align-[-1px]" />
        {text}
      </p>
    );
  }

  return (
    <div className="border-l-2 border-amber-300 pl-3">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        <StickyNote size={11} />
        Nota del asegurado
      </span>
      <p className="m-0 mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-slate-600">{text}</p>
    </div>
  );
}


export function NoticeAudit({ notice }: { notice: Notice }) {
  if (notice.status === "avisar") return null;
  const showNotified = notice.notified_by && (notice.status === "avisado" || notice.status === "pagado");
  const showPaid = notice.payment_processed_by && notice.status === "pagado";
  if (!showNotified && !showPaid) return null;
  const parts: string[] = [];
  if (showNotified) parts.push(`avisó ${notice.notified_by?.full_name}`);
  if (showPaid) parts.push(`cobró ${notice.payment_processed_by?.full_name}`);
  return (
    <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
      {showPaid ? <CheckCircle size={11} className="shrink-0 text-emerald-500" /> : <Bell size={11} className="shrink-0 text-blue-500" />}
      <span className="truncate">{parts.join(" · ")}</span>
    </p>
  );
}


export function NoticeNotes({ notice, noteApi }: { notice: Notice; noteApi: NoticeNoteApi }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingNoteId, setConfirmingNoteId] = useState<string | null>(null);
  const notes = notice.notes ?? [];
  const isAdding = noteApi.busyNoticeId === notice.id;

  const submit = async () => {
    const value = draft.trim();
    if (!value) return;
    await noteApi.onAdd(notice.id, value);
    setDraft("");
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600"
        onClick={() => setOpen((current) => !current)}
      >
        <MessageSquare size={12} />
        {notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "nota interna" : "notas internas"}` : "Agregar nota interna"}
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {notes.map((note) => {
            const own = note.user_id === noteApi.currentUserId;
            return (
              <div
                key={note.id}
                className={`flex items-start justify-between gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug ${
                  own ? "border-l-2 border-amber-400 bg-amber-50 text-amber-900" : "border border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="font-semibold">{note.user?.full_name ?? "Usuario"}:</strong> {note.note}
                </span>
                {own ? (
                  <button
                    type="button"
                    aria-label="Eliminar nota"
                    className="shrink-0 text-slate-400 transition-colors hover:text-red-600 disabled:opacity-50"
                    onClick={() => setConfirmingNoteId(note.id)}
                    disabled={noteApi.deletingNoteId === note.id}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <input
              value={draft}
              placeholder="Agregar una nota..."
              className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-[color:var(--org-primary)]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              disabled={isAdding}
            />
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[color:var(--org-primary-soft)] text-[color:var(--org-primary)] transition-colors hover:brightness-95 disabled:opacity-50"
              onClick={() => void submit()}
              disabled={isAdding || !draft.trim()}
            >
              {isAdding ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(confirmingNoteId)}
        title="Eliminar nota"
        message="¿Eliminar esta nota interna? Esta acción no se puede deshacer."
        confirmLabel="Eliminar nota"
        isBusy={Boolean(confirmingNoteId && noteApi.deletingNoteId === confirmingNoteId)}
        onClose={() => setConfirmingNoteId(null)}
        onConfirm={() => {
          if (!confirmingNoteId) return;
          void noteApi
            .onDelete(notice.id, confirmingNoteId)
            .catch(() => undefined)
            .finally(() => setConfirmingNoteId(null));
        }}
      />
    </div>
  );
}


// Botón de copiar de una fila de contacto. Solo copia: no hay links de llamar ni
// de escribir. Corta la propagación porque la tarjeta entera abre el detalle.
function CopyContactButton({
  value,
  label,
  size
}: {
  value: string;
  label: string;
  size: "sm" | "lg";
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => window.clearTimeout(timerRef.current ?? undefined), []);

  const copy = (event: React.MouseEvent) => {
    event.stopPropagation();
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timerRef.current ?? undefined);
        timerRef.current = window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => undefined);
  };

  const Icon = copied ? Check : Copy;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={copied ? "Copiado" : label}
        onClick={copy}
        className={`flex shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--org-primary)] ${
          size === "lg" ? "h-11 w-11 border border-slate-200 bg-white" : "h-8 w-8"
        } ${copied ? "text-emerald-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
      >
        <Icon size={size === "lg" ? 16 : 14} aria-hidden="true" />
      </button>
      <span className="sr-only" role="status">
        {copied ? "Copiado" : ""}
      </span>
    </>
  );
}

// Teléfono y correo del asegurado, siempre como texto plano con su botón de
// copiar. "card" va en el tablero, "modal" arriba del detalle (más grande) y
// "row" es la versión de una línea para la vista lista (solo teléfono).
export function ContactBlock({
  contact,
  variant
}: {
  contact: NoticeContact;
  variant: "card" | "modal" | "row";
}) {
  const { phone, email } = contact;

  if (variant === "row") {
    if (!phone) return null;
    return (
      <div className="mt-0.5 flex items-center gap-1.5 text-[13px]">
        <Phone size={13} className="shrink-0 text-slate-600" aria-hidden="true" />
        <p className="m-0 font-semibold tabular-nums text-slate-900">{phone}</p>
        <CopyContactButton value={phone} label="Copiar teléfono" size="sm" />
      </div>
    );
  }

  if (variant === "modal") {
    return (
      <div className="flex flex-col divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
        {phone ? (
          <div className="flex items-center gap-3 py-3 pl-4 pr-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Teléfono</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">{phone}</span>
            </div>
            <CopyContactButton value={phone} label="Copiar teléfono" size="lg" />
          </div>
        ) : null}
        {email ? (
          <div className="flex items-center gap-3 py-3 pl-4 pr-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Correo</span>
              <span className="truncate text-[15px] font-semibold text-slate-900" title={email}>
                {email}
              </span>
            </div>
            <CopyContactButton value={email} label="Copiar correo" size="lg" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2.5 flex flex-col divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
      {phone ? (
        <div className="flex h-10 items-center gap-2 pl-2.5 pr-1">
          <Phone size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums text-slate-900">{phone}</span>
          <CopyContactButton value={phone} label="Copiar teléfono" size="sm" />
        </div>
      ) : null}
      {email ? (
        <div className="flex h-10 items-center gap-2 pl-2.5 pr-1">
          <Mail size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700" title={email}>
            {email}
          </span>
          <CopyContactButton value={email} label="Copiar correo" size="sm" />
        </div>
      ) : null}
    </div>
  );
}

// "Avisado por Ana · ayer 16:20" / "Pago registrado por Ana · 09/11 11:05".
export function NoticeHandledLine({
  notice,
  currentUserId,
  now,
  className = "m-0 mt-2"
}: {
  notice: Notice;
  currentUserId: string | null;
  now: number;
  className?: string;
}) {
  const line = describeNoticeHandlingLine(notice, currentUserId, now);
  if (!line) return null;
  return (
    <p className={`${className} text-xs font-medium ${line.kind === "paid" ? "text-emerald-700" : "text-blue-700"}`}>
      {line.text}
    </p>
  );
}

// Cartel destacado cuando otra persona resolvió el aviso hace instantes. En la
// tarjeta es una línea; en el detalle suma la póliza y cuánto hace pasó.
export function RecentHandlingBanner({
  handling,
  now,
  policyNumber,
  variant
}: {
  handling: NoticeHandling;
  now: number;
  policyNumber?: string | null | undefined;
  variant: "card" | "modal";
}) {
  const paid = handling.kind === "paid";
  const name = handling.by.full_name;
  const tone = paid ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-800";
  const Icon = paid ? CheckCircle : Bell;

  if (variant === "card") {
    return (
      <div role="status" className={`mb-2.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold ${tone}`}>
        <Icon size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0">{name} {paid ? "registró el pago" : "lo avisó"} recién</span>
      </div>
    );
  }

  const policy = policyNumber ? ` la póliza #${policyNumber}` : " este aviso";
  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-lg px-3.5 py-3 ${tone}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-bold">
          {name} {paid ? "registró el pago" : "lo avisó"} {describeHandlingAge(handling.atMs, now)}
        </span>
        <span className="text-[12.5px] leading-snug">
          {paid ? `El pago de${policy} ya está registrado.` : `No hace falta volver a contactarlo por${policy}.`}
        </span>
      </div>
    </div>
  );
}
