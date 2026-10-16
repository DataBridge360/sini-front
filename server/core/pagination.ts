import { z } from "zod";

// Contrato de paginación server-side (PAGINADO.md):
//   GET /recurso?page=1&pageSize=10&search=... → { items, total, page, pageSize }
// page/pageSize son opcionales: sin ellos cada endpoint conserva su respuesta
// legada (array completo) mientras dure la transición (Fase 4 del plan).

export const PAGE_SIZE_DEFAULT = 10;
export const PAGE_SIZE_MAX = 50;

export const pageField = z.coerce.number().int().min(1).optional();
// El servidor nunca obedece un pageSize gigante: tope duro de 50.
export const pageSizeField = z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).optional();

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// Pedir una página más allá de la última devuelve la última (contrato del plan).
export function clampPage(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(page, totalPages);
}

export function pageRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}
