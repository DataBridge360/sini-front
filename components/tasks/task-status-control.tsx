"use client";

import { Check, ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TaskStatus } from "@/lib/api";
import { statusActions, TASK_STATUS_META } from "@/lib/tasks";

// Acciones de cambio de etapa. La primaria del estado actual va como botón
// visible; el resto en un menú.
//
// Las acciones sin permiso se muestran DESHABILITADAS con el motivo, no
// escondidas: un asesor tiene que ver que "Aprobar" existe y que le corresponde
// a un productor, o va a pensar que la app está rota.
export function TaskStatusControl({
  status,
  canModerate,
  isBusy,
  size = "sm",
  fullWidth = false,
  onMove
}: {
  status: TaskStatus;
  canModerate: boolean;
  isBusy: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
  onMove: (status: TaskStatus) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const actions = statusActions(status, canModerate);
  const primary = actions[0];
  const rest = actions.slice(1);

  useEffect(() => {
    if (!isMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  if (!primary) return null;

  const heightClass = size === "md" ? "min-h-10 px-3.5 text-[13px]" : "min-h-9 px-3 text-[12px]";

  return (
    <div
      ref={containerRef}
      className={`sp-status-control relative flex items-center gap-1 ${fullWidth ? "w-full" : ""}`}
      // La card entera es clickeable: acá se corta la propagación para que tocar
      // una acción no abra además el detalle.
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`sp-status-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${heightClass} ${
          primary.tone === "accent"
            ? "bg-[color:var(--org-primary-soft)] text-[color:var(--org-primary)] hover:bg-[color:var(--org-primary-muted)]"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
        disabled={primary.disabled || isBusy}
        title={primary.reason ?? `Mover a ${TASK_STATUS_META[primary.to].label.toLowerCase()}`}
        onClick={() => onMove(primary.to)}
      >
        {isBusy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : primary.to === "finalizado" ? (
          <Check size={13} />
        ) : null}
        {primary.label}
        {!isBusy && primary.to !== "finalizado" ? <ChevronRight size={13} className="opacity-60" /> : null}
      </button>

      {rest.length > 0 ? (
        <>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Más acciones de estado"
            aria-expanded={isMenuOpen}
            disabled={isBusy}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={16} />
          </button>

          {isMenuOpen ? (
            <div
              className="sp-status-menu absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              role="menu"
            >
              {rest.map((action) => (
                <button
                  key={action.to}
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    action.tone === "danger"
                      ? "text-red-600 hover:bg-red-50"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                  disabled={action.disabled}
                  title={action.reason ?? undefined}
                  onClick={() => {
                    setIsMenuOpen(false);
                    onMove(action.to);
                  }}
                >
                  <i
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: TASK_STATUS_META[action.to].dot }}
                  />
                  <span className="min-w-0 flex-1">{action.label}</span>
                </button>
              ))}
              {rest.some((action) => action.disabled) ? (
                <p className="m-0 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] leading-snug text-slate-400">
                  {rest.find((action) => action.disabled)?.reason}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
