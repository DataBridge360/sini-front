import { z } from "zod";
import { pageField, pageSizeField } from "@/server/core/pagination";

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

// Códigos de conflicto (HTTP 409) que el frontend usa para reaccionar: el de
// nombre repetido pide el DNI en el formulario en vez de mostrar un error suelto.
export const CLIENT_DUPLICATE_NAME = "CLIENT_DUPLICATE_NAME";
export const CLIENT_DUPLICATE_DNI = "CLIENT_DUPLICATE_DNI";

export const createClientSchema = z.object({
  fullName: z.string().trim().min(2).max(180),
  phone: z.preprocess(emptyToNull, z.string().trim().max(80).nullable().optional()),
  email: z.preprocess(emptyToNull, z.string().email().nullable().optional()),
  locality: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
  dni: z.preprocess(emptyToNull, z.string().trim().max(40).nullable().optional()),
  address: z.preprocess(emptyToNull, z.string().trim().max(240).nullable().optional()),
  birthDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(1200).nullable().optional())
});

export const updateClientSchema = createClientSchema.partial();

export const listClientsQuerySchema = z.object({
  search: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.preprocess(emptyToNull, z.string().trim().max(400).nullable().optional()),
  // Paginación numerada (PAGINADO.md). Con page/pageSize la respuesta pasa a
  // ser { items, total, page, pageSize }; sin ellos se mantiene el array legado.
  page: pageField,
  pageSize: pageSizeField,
  locality: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional())
});

// Búsqueda liviana para combobox: devuelve solo lo necesario para elegir.
export const searchClientsQuerySchema = z.object({
  q: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  limit: z.coerce.number().int().min(1).max(20).optional()
});

export type CreateClientDto = z.infer<typeof createClientSchema>;
export type UpdateClientDto = z.infer<typeof updateClientSchema>;
export type ListClientsQueryDto = z.infer<typeof listClientsQuerySchema>;
export type SearchClientsQueryDto = z.infer<typeof searchClientsQuerySchema>;
