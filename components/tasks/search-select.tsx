"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SearchSelectOption = {
  id: string;
  label: string;
  hint?: string | undefined;
};

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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(query) || option.hint?.toLowerCase().includes(query)
    );
  }, [options, term]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
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

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
            <Search size={13} className="shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={term}
              placeholder="Buscar..."
              className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400"
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
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
                    {option.hint ? <span className="block truncate text-[11px] font-normal text-slate-400">{option.hint}</span> : null}
                  </span>
                  {option.id === value ? <Check size={13} className="shrink-0" /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
