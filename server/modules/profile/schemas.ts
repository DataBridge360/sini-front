import { z } from "zod";

const avatarSchema = z
  .string()
  .max(500_000)
  .refine(
    (value) =>
      value === "" ||
      value.startsWith("data:image/png;base64,") ||
      value.startsWith("data:image/jpeg;base64,") ||
      value.startsWith("data:image/webp;base64,"),
    "Invalid avatar format"
  );

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(180),
  avatarUrl: avatarSchema.nullable().optional()
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(120),
    confirmPassword: z.string().min(8).max(120)
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
