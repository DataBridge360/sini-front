"use client";

import { AlertTriangle, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readTransitionMs } from "@/lib/browser";

// Pila de modales abiertos, del más viejo al más nuevo. Un modal que se abre
// encima de otro (una confirmación sobre el detalle) queda arriba sin importar
// el orden en el DOM, y solo el de arriba responde a Escape y atrapa el Tab.
const modalStack: object[] = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  closeOnEscape = false,
  children
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  size?: "md" | "wide" | "lg";
  headerSlot?: ReactNode;
  bodyClassName?: string;
  /** Escape cierra el modal (solo el de arriba si hay varios apilados). */
  closeOnEscape?: boolean;
  children: ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const isActive = isMounted && isOpen;

  // Apilado, foco y teclado. Al abrir el foco entra al diálogo (si el contenido
  // no tomó el foco antes); el Tab no se escapa a la página de atrás; al cerrar
  // el foco vuelve al botón que lo abrió.
  useLayoutEffect(() => {
    if (!isActive) return;
    const token = {};
    modalStack.push(token);
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    if (backdrop) backdrop.style.zIndex = String(50 + (modalStack.length - 1) * 10);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token || event.defaultPrevented) return;
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.getClientRects().length > 0
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const current = document.activeElement;
      if (!dialog.contains(current) || current === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [isActive, closeOnEscape]);

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
      ref={backdropRef}
      className="sp-modal-backdrop fixed inset-0 z-50 grid min-h-dvh place-items-center overflow-hidden bg-slate-950/45 p-6 max-[520px]:p-3"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`sp-modal m-0 outline-none flex w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl ${
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
    <Modal title={title} isOpen={isOpen} closeOnEscape onClose={() => (isBusy ? undefined : onClose())}>
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

