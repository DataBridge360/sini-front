"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
  meta?: string;
  key?: string;
};


export function SearchableSelect({
  label,
  name,
  value,
  options,
  placeholder,
  required,
  onChange
}: {
  label?: string;
  name?: string;
  value?: string;
  options: SelectOption[];
  placeholder: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [internalValue, setInternalValue] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue);
  const filtered = options.filter((option) => {
    const term = query.trim().toLowerCase();
    return !term || `${option.label} ${option.meta ?? ""}`.toLowerCase().includes(term);
  });

  const closeSelect = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const select = (next: string) => {
    setInternalValue(next);
    onChange?.(next);
    closeSelect();
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closeSelect();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSelect();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSelect]);

  const control = (
    <div className="sp-combobox" ref={rootRef}>
      <div className="sp-combobox-control">
        <input
          value={open ? query : selected?.label ?? ""}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        <button type="button" onClick={() => setOpen((state) => !state)} aria-label="Abrir opciones">
          <ChevronDown size={15} />
        </button>
      </div>
      {open ? (
        <div className="sp-combobox-menu t-dropdown is-open" data-origin="top-left">
          <div>
            {filtered.length === 0 ? <p>Sin resultados</p> : null}
            {filtered.map((option, index) => (
              <button
                key={option.key ?? `${option.value}-${index}`}
                type="button"
                className={option.value === selectedValue ? "active" : ""}
                onClick={() => select(option.value)}
              >
                <span>{option.label}</span>
                {option.meta ? <em>{option.meta}</em> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {name ? (
        <input
          className="sp-combobox-hidden-input"
          name={name}
          value={selectedValue}
          required={required}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );

  if (!label) return control;
  return (
    <label className="sp-field">
      <span>{label}</span>
      {control}
    </label>
  );
}

export function LocalityCombobox({ name }: { name: string }) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          nombre: term,
          campos: "id,nombre,provincia.nombre",
          max: "12"
        });
        const response = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?${params}`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as {
          localidades?: Array<{ id?: string; nombre?: string; provincia?: { nombre?: string } }>;
        };
        const nextOptions = (payload.localidades ?? []).map((locality, index) => ({
            key: locality.id ?? `${locality.nombre ?? "localidad"}-${locality.provincia?.nombre ?? "provincia"}-${index}`,
            value: locality.provincia?.nombre
              ? `${locality.nombre ?? ""}, ${locality.provincia.nombre}`
              : locality.nombre ?? "",
            label: locality.nombre ?? "",
            ...(locality.provincia?.nombre ? { meta: locality.provincia.nombre } : {})
          })).filter((option) => option.value.trim());
        setOptions(nextOptions);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setOptions([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const visibleOptions = options.filter((option) => option.label);

  return (
    <label className="sp-field">
      <span>Localidad</span>
      <div className="sp-combobox sp-locality-combobox">
        <input
          className="block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[var(--org-primary)] focus:ring-2 focus:ring-[var(--org-primary-soft)]"
          value={query}
          placeholder="Buscar localidad"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setValue(event.target.value);
            if (event.target.value.trim().length < 2) setOptions([]);
            setOpen(true);
          }}
        />
        {open && (query.trim().length >= 2 || visibleOptions.length > 0) ? (
          <div className="sp-combobox-menu locality">
            <div>
              {isLoading ? <p>Buscando...</p> : null}
              {!isLoading && visibleOptions.length === 0 ? <p>Sin resultados</p> : null}
              {visibleOptions.map((option, index) => (
                <button
                  key={option.key ?? `${option.value}-${index}`}
                  type="button"
                  onClick={() => {
                    setQuery(option.value);
                    setValue(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.meta ? <em>{option.meta}</em> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <input name={name} value={value} readOnly hidden />
      </div>
    </label>
  );
}
