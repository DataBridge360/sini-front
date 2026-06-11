"use client";

import { AlertTriangle, Bell, CalendarDays, CheckCircle, ChevronDown, Clock, Loader2, MessageSquare, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Notice } from "@/lib/api";
import { dueLabel } from "@/lib/format";
import type { NoticeStatus } from "@/lib/notices";
import type { NoticeNoteApi } from "@/lib/shell-types";

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
                    onClick={() => noteApi.onDelete(notice.id, note.id)}
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
    </div>
  );
}

