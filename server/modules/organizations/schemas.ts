import { z } from "zod";

const nullableUrlSchema = z
  .string()
  .trim()
  .url()
  .max(1000)
  .or(z.literal(""))
  .transform((value) => value || null)
  .nullable()
  .optional();

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Invalid color")
  .nullable()
  .optional();

export const updateOrganizationSchema = z.object({
  displayName: z.string().trim().min(2).max(180),
  logoUrl: nullableUrlSchema,
  primaryColor: colorSchema,
  secondaryColor: colorSchema,
  supportEmail: z.string().trim().email().max(180).or(z.literal("")).transform((value) => value || null).nullable().optional(),
  supportPhone: z.string().trim().max(60).or(z.literal("")).transform((value) => value || null).nullable().optional()
});

export const createOrganizationTeamMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  role: z.enum(["productor", "asesor"]),
  password: z.string().min(8).max(128)
});

const producerPasswordSchema = z.object({
  producerPassword: z.string().min(1).max(128)
});

export const updateOrganizationTeamMemberSchema = producerPasswordSchema.extend({
  fullName: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  role: z.enum(["productor", "asesor"])
});

export const changeOrganizationTeamMemberPasswordSchema = producerPasswordSchema.extend({
  password: z.string().min(8).max(128)
});

export const deactivateOrganizationTeamMemberSchema = producerPasswordSchema;

export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;
export type CreateOrganizationTeamMemberDto = z.infer<typeof createOrganizationTeamMemberSchema>;
export type UpdateOrganizationTeamMemberDto = z.infer<typeof updateOrganizationTeamMemberSchema>;
export type ChangeOrganizationTeamMemberPasswordDto = z.infer<typeof changeOrganizationTeamMemberPasswordSchema>;
export type DeactivateOrganizationTeamMemberDto = z.infer<typeof deactivateOrganizationTeamMemberSchema>;
