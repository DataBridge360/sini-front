"use client";

import { AlertTriangle, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { readTransitionMs } from "@/lib/browser";

export function Modal({
  title,
  isOpen,
  onClose,
  // "lg" es para superficies de trabajo (el detalle de una tarea): más ancho en
  // escritorio y pantalla completa en mobile. "wide" es para formularios que
  // necesitan más aire que "md" sin llegar a ser una superficie de trabajo. El
  // default "md" deja el markup exactamente como estaba.
  size = "md",
  headerSlot,
  bodyClassName,
  children
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  size?: "md" | "wide" | "lg";
  headerSlot?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current ?? undefined);
    if (isOpen) {
      const frame = window.requestAnimationFrame(() => {
        setIsMounted(true);
        setIsClosing(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!isMounted) return;

    const frame = window.requestAnimationFrame(() => {
      setIsClosing(true);
      const closeMs = readTransitionMs("--modal-close-dur", 150);
      closeTimerRef.current = window.setTimeout(() => {
        setIsMounted(false);
        setIsClosing(false);
      }, closeMs);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(closeTimerRef.current ?? undefined);
    };
  }, [isOpen, isMounted]);

  if (!isMounted) return null;

  return (
    <div
      className="sp-modal-backdrop fixed inset-0 z-50 grid min-h-dvh place-items-center overflow-hidden bg-slate-950/45 p-6 max-[520px]:p-3"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={`sp-modal m-0 flex w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl ${
          size === "lg"
            ? "sp-modal-lg max-h-[min(920px,calc(100dvh-48px))] max-w-6xl"
            : size === "wide"
              ? "sp-modal-wide max-h-[min(860px,calc(100dvh-48px))] max-w-4xl max-[520px]:max-h-[calc(100dvh-24px)]"
              : "max-h-[min(760px,calc(100dvh-48px))] max-w-2xl max-[520px]:max-h-[calc(100dvh-24px)]"
        } ${isClosing ? "opacity-0" : "opacity-100"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sp-modal-header flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4">
          {headerSlot ?? <h2 className="m-0 min-w-0 flex-1 text-lg font-semibold text-slate-950">{title}</h2>}
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>
        <div className={bodyClassName ?? "sp-modal-body min-h-0 overflow-y-auto p-5"}>{children}</div>
      </section>
    </div>
  );
}


export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  isBusy,
  // "danger" para eliminaciones (rojo), "warning" para volver atrás un estado (ámbar).
  tone = "danger",
  onClose,
  onConfirm
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  isBusy: boolean;
  tone?: "danger" | "warning";
  onClose: () => void;
  onConfirm: () => void;
}) {
  const iconClass =
    tone === "danger" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600";
  const buttonClass =
    tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700";

  return (
    <Modal title={title} isOpen={isOpen} onClose={() => (isBusy ? undefined : onClose())}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
            <AlertTriangle size={18} />
          </span>
          <p className="m-0 text-sm leading-relaxed text-slate-600">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isBusy}>
            Cancelar
          </button>
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${buttonClass}`}
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 size={15} className="animate-spin" /> : tone === "danger" ? <Trash2 size={15} /> : <RotateCcw size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

