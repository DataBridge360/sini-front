"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SearchSelectOption = {
  id: string;
  label: string;
  hint?: string | undefined;
};

const PANEL_MAX_HEIGHT = 250;

// Combobox buscable para listas largas (asegurados, pólizas, miembros).
export function SearchSelect({
  value,
  options,
  placeholder,
  emptyLabel = "Sin resultados",
  disabled,
  onChange
}: {
  value: string | null;
  options: SearchSelectOption[];
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean | undefined;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // El panel vive en un portal sobre <body>: dentro del modal lo recortaban el
  // `overflow-y: auto` del cuerpo y el `overflow: hidden` del bloque plegable.
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    primary: string;
  } | null>(null);

  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(query) || option.hint?.toLowerCase().includes(query)
    );
  }, [options, term]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // `--org-primary` está declarada en el shell, no en <body>: el portal queda
    // fuera de ese árbol, así que la copiamos al panel.
    const primary = window.getComputedStyle(trigger).getPropertyValue("--org-primary").trim() || "#176e64";

    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(140, Math.min(PANEL_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
    const top = openUp ? rect.top - 4 - maxHeight : rect.bottom + 4;
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - rect.width - margin));

    setCoords({ top, left, width: rect.width, maxHeight, primary });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    inputRef.current?.focus();

    const handleReposition = () => updatePosition();
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePosition]);

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-left text-[13px] transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 ${
          selected ? "text-slate-800" : "text-slate-400"
        }`}
        onClick={() => {
          setTerm("");
          setOpen((current) => !current);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
        {selected ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Quitar selección"
            className="shrink-0 rounded text-slate-400 transition-colors hover:text-red-500"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onChange(null);
                setOpen(false);
              }
            }}
          >
            <X size={13} />
          </span>
        ) : null}
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
              style={
                {
                  position: "fixed",
                  top: coords.top,
                  left: coords.left,
                  width: coords.width,
                  maxHeight: coords.maxHeight,
                  // Por encima del backdrop del modal (z-50) y del calendario flotante.
                  zIndex: 210,
                  "--org-primary": coords.primary
                } as CSSProperties
              }
            >
              <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
                <Search size={13} className="shrink-0 text-slate-400" />
                <input
                  ref={inputRef}
                  value={term}
                  placeholder="Buscar..."
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400"
                  onChange={(event) => setTerm(event.target.value)}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {filtered.length === 0 ? (
                  <p className="m-0 px-2.5 py-2 text-[12px] text-slate-400">{emptyLabel}</p>
                ) : (
                  filtered.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-slate-50 ${
                        option.id === value ? "font-semibold text-[color:var(--org-primary)]" : "text-slate-700"
                      }`}
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.hint ? (
                          <span className="block truncate text-[11px] font-normal text-slate-400">{option.hint}</span>
                        ) : null}
                      </span>
                      {option.id === value ? <Check size={13} className="shrink-0" /> : null}
                    </button>
                  ))
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
