import { z } from "zod";

export const createInsuranceCompanySchema = z.object({
  name: z.string().trim().min(2).max(120)
});

export type CreateInsuranceCompanyDto = z.infer<typeof createInsuranceCompanySchema>;
