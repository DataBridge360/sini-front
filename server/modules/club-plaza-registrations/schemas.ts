import { z } from "zod";
import { pageField, pageSizeField } from "@/server/core/pagination";

export const paymentMethodValues = ["efectivo", "debito", "mp"] as const;
export const registrationStatusValues = ["pendiente", "completo"] as const;

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullable().optional());
const optionalIsoDate = z.preprocess(emptyToNull, z.iso.date().nullable().optional());
const dniSchema = z
  .string()
  .trim()
  .regex(/^\d{6,10}$/, "El DNI debe tener entre 6 y 10 dígitos");

// El alta manda los datos del jugador tal como los devolvió Club Plaza (el
// frontend solo permite registrar DNIs que existen allá).
export const createRegistrationSchema = z.object({
  registeredOn: z.iso.date(),
  playerFullName: z.string().trim().min(1).max(180),
  playerDni: dniSchema,
  playerBirthDate: optionalIsoDate,
  payerName: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  paymentMethod: z.preprocess(emptyToNull, z.enum(paymentMethodValues).nullable().optional()),
  attendedByUserId: optionalUuid
});

// La edición NO permite tocar los datos del jugador (nombre, DNI, fecha de
// nacimiento): esos solo se corrigen vía /corrections cuando la carga masiva
// aplica una corrección aceptada contra Club Plaza.
export const updateRegistrationSchema = z.object({
  registeredOn: z.iso.date().optional(),
  payerName: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  paymentMethod: z.preprocess(emptyToNull, z.enum(paymentMethodValues).nullable().optional()),
  attendedByUserId: optionalUuid
});

// Correcciones que la carga masiva aplicó en Club Plaza (conflictos aceptados):
// se replican sobre las filas de la planilla que tengan ese DNI.
export const applyCorrectionsSchema = z.object({
  corrections: z
    .array(
      z.object({
        dni: dniSchema,
        newDni: dniSchema.optional(),
        fullName: z.string().trim().min(1).max(180).optional(),
        birthDate: z.iso.date().optional()
      })
    )
    .min(1)
    .max(500)
});

// Alta masiva desde el wizard de Club Plaza: los jugadores nuevos entran a la
// planilla en estado pendiente (sin pagador, pago ni atendido).
export const bulkCreateRegistrationsSchema = z.object({
  registeredOn: z.iso.date().optional(),
  players: z
    .array(
      z.object({
        fullName: z.string().trim().min(1).max(180),
        dni: dniSchema,
        birthDate: optionalIsoDate
      })
    )
    .min(1)
    .max(2000)
});

export const listRegistrationsQuerySchema = z.object({
  page: pageField,
  pageSize: pageSizeField,
  // Busca por nombre del jugador o DNI.
  search: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  dni: z.preprocess(emptyToNull, z.string().trim().max(10).nullable().optional()),
  pagador: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional()),
  paymentMethod: z.preprocess(emptyToNull, z.enum(paymentMethodValues).nullable().optional()),
  attendedBy: optionalUuid,
  status: z.preprocess(emptyToNull, z.enum(registrationStatusValues).nullable().optional()),
  dateFrom: optionalIsoDate,
  dateTo: optionalIsoDate,
  birthDate: optionalIsoDate
});

// Autocompletado del campo "Pagador" de la planilla: sugiere los pagadores ya
// usados en la organización (un pagador suele pagar varios jugadores).
export const listPayersQuerySchema = z.object({
  search: z.preprocess(emptyToNull, z.string().trim().max(180).nullable().optional())
});

export type CreateRegistrationDto = z.infer<typeof createRegistrationSchema>;
export type UpdateRegistrationDto = z.infer<typeof updateRegistrationSchema>;
export type BulkCreateRegistrationsDto = z.infer<typeof bulkCreateRegistrationsSchema>;
export type ApplyCorrectionsDto = z.infer<typeof applyCorrectionsSchema>;
export type ListRegistrationsQueryDto = z.infer<typeof listRegistrationsQuerySchema>;
export type ListPayersQueryDto = z.infer<typeof listPayersQuerySchema>;
