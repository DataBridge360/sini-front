import { z } from "zod";
import { pageField, pageSizeField } from "@/server/core/pagination";

// 'debito_automatico' cubre débito y tarjeta de crédito automáticos: la póliza
// se cobra sola, así que no entra al circuito de avisos.
export const paymentMethodValues = ["manual", "debito_automatico"] as const;

export const createPolicySchema = z.object({
  clientId: z.string().uuid(),
  insuranceCompanyId: z.string().uuid(),
  branch: z.string().trim().min(2).max(120),
  policyNumber: z.string().trim().min(1).max(120),
  vehiclePlate: z.string().trim().max(40).nullable().optional(),
  paymentIntervalMonths: z.coerce.number().int().min(1).max(12),
  paymentMethod: z.enum(paymentMethodValues).optional(),
  firstPaymentDate: z.string().date()
});

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const listPoliciesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.preprocess(emptyToNull, z.string().trim().max(400).nullable().optional()),
  // Paginación numerada (PAGINADO.md): con page/pageSize la respuesta pasa a
  // ser { items, total, page, pageSize }; los filtros se aplican en el servidor.
  page: pageField,
  pageSize: pageSizeField,
  search: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  branch: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
  companyId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional())
});

// Búsqueda liviana para combobox (vincular póliza a una tarea, etc.).
export const searchPoliciesQuerySchema = z.object({
  q: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  limit: z.coerce.number().int().min(1).max(20).optional()
});

export const updatePolicySchema = z
  .object({
    clientId: z.string().uuid(),
    insuranceCompanyId: z.string().uuid(),
    branch: z.string().trim().min(2).max(120),
    policyNumber: z.string().trim().min(1).max(120),
    vehiclePlate: z.string().trim().max(40).nullable(),
    paymentIntervalMonths: z.coerce.number().int().min(1).max(12),
    paymentMethod: z.enum(paymentMethodValues),
    firstPaymentDate: z.string().date()
  })
  .partial();

export type CreatePolicyDto = z.infer<typeof createPolicySchema>;
export type ListPoliciesQueryDto = z.infer<typeof listPoliciesQuerySchema>;
export type SearchPoliciesQueryDto = z.infer<typeof searchPoliciesQuerySchema>;
export type UpdatePolicyDto = z.infer<typeof updatePolicySchema>;
