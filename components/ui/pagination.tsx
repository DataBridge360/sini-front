"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 10;

// Paginación client-side: el listado completo ya está en memoria.
// La paginación server-side está planificada en PAGINADO.md.
export function paginate<T>(items: T[], page: number, pageSize: number = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    start,
    total: items.length
  };
}

export function Pagination({
  page,
  totalPages,
  start,
  count,
  total,
  onChange
}: {
  page: number;
  totalPages: number;
  start: number;
  count: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-1 pt-3">
      <span className="text-xs text-slate-400">
        Mostrando {start + 1}–{start + count} de {total}
      </span>
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Página anterior"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-20 text-center text-xs font-semibold text-slate-600">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            aria-label="Página siguiente"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => onChange(page + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
