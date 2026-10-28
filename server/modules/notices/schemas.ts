import { z } from "zod";

export const payNoticeSchema = z.object({
  paymentIntervalMonths: z.coerce.number().int().min(1).max(12).optional()
});

export const createNoticeNoteSchema = z.object({
  note: z.string().trim().min(1).max(1200)
});

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const noticeStatusValues = ["avisar", "avisado", "pagado"] as const;

export const listNoticesQuerySchema = z.object({
  status: z.preprocess(
    emptyToNull,
    z.enum(["avisar", "avisado", "pagado", "all"]).nullable().optional()
  ),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.preprocess(emptyToNull, z.string().trim().max(400).nullable().optional())
});

export type PayNoticeDto = z.infer<typeof payNoticeSchema>;
export type CreateNoticeNoteDto = z.infer<typeof createNoticeNoteSchema>;
export type ListNoticesQueryDto = z.infer<typeof listNoticesQuerySchema>;
