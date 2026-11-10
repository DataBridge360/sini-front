"use client";

import { Check, Copy, Loader2, MoreVertical, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";

// Menú de tres puntos de una póliza en el detalle del aviso. Reusa el estilo
// del menú de la tarea (.sp-task-menu*): mismos roles, Escape que cierra solo el
// menú, clic afuera y flechas para moverse entre las acciones.
export function PolicyMenu({
  policyNumber,
  policyLabel,
  onRenew
}: {
  policyNumber: string;
  policyLabel: string;
  onRenew: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => window.clearTimeout(timerRef.current ?? undefined), []);

  useEffect(() => {
    if (!isOpen) return;
    const items = () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();

    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Se corta acá para que Escape cierre el menú y no el modal entero.
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const list = items();
      if (list.length === 0) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isOpen]);

  const copy = () => {
    void navigator.clipboard
      .writeText(policyNumber)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timerRef.current ?? undefined);
        timerRef.current = window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => undefined);
  };

  const CopyIcon = copied ? Check : Copy;

  return (
    <div ref={containerRef} className="sp-task-menu">
      <button
        ref={triggerRef}
        type="button"
        className="sp-task-menu-trigger sp-task-menu-trigger-touch"
        aria-label={`Acciones de ${policyLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <MoreVertical size={17} />
      </button>

      {isOpen ? (
        <div className="sp-task-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={copy}>
            <CopyIcon size={14} className={copied ? "text-emerald-700" : undefined} />
            {copied ? "Número copiado" : "Copiar número"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onRenew();
            }}
          >
            <RefreshCw size={14} />
            Renovó póliza
          </button>
        </div>
      ) : null}
      <span className="sr-only" role="status">
        {copied ? "Número copiado" : ""}
      </span>
    </div>
  );
}

// Pide el número nuevo de una póliza renovada. El número viejo queda guardado
// en la póliza (lo hace el servidor); acá solo se valida lo evidente y se
// muestra el motivo si el servidor lo rechaza (por ejemplo, número ya usado).
export function RenewPolicyDialog({
  currentNumber,
  onClose,
  onRenew
}: {
  currentNumber: string;
  onClose: () => void;
  onRenew: (policyNumber: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    const next = value.trim();
    if (!next) {
      setError("Ingresá el nuevo número de póliza.");
      return;
    }
    if (next === currentNumber) {
      setError("El nuevo número es igual al actual.");
      return;
    }
    setError(null);
    setIsPending(true);
    try {
      await onRenew(next);
      onClose();
    } catch (renewError) {
      setError(renewError instanceof Error ? renewError.message : "No se pudo registrar la renovación.");
      setIsPending(false);
    }
  };

  return (
    <Modal title="Renovó póliza" isOpen closeOnEscape onClose={() => (isPending ? undefined : onClose())}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <p className="m-0 text-sm text-slate-600">
          Número actual: <strong className="font-semibold text-slate-900">#{currentNumber}</strong>. Al aceptar queda
          como número anterior y se puede seguir buscando por él.
        </p>
        <label className="sp-field">
          <span>Nuevo número</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            maxLength={120}
            placeholder="Número de la póliza renovada"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "renew-policy-error" : undefined}
            disabled={isPending}
          />
        </label>
        {error ? (
          <p id="renew-policy-error" role="alert" className="m-0 text-[13px] font-medium text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="sp-secondary-action" onClick={onClose} disabled={isPending}>
            Cancelar
          </button>
          <button type="submit" className="sp-primary-action" disabled={isPending}>
            {isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Aceptar
          </button>
        </div>
      </form>
    </Modal>
  );
}
