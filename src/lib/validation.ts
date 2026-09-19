import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const registerSchema = z
  .object({
    ign: z
      .string()
      .trim()
      .min(2, "IGN must be at least 2 characters.")
      .max(32, "IGN must be at most 32 characters.")
      .regex(/^[a-zA-Z0-9_\- ]+$/, "Letters, numbers, spaces, dashes and underscores only."),
    email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
    discord: z
      .string()
      .trim()
      .max(64, "Discord username must be at most 64 characters.")
      .optional()
      .or(z.literal("")),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be at most 72 characters.")
      .regex(/[a-zA-Z]/, "Password must contain a letter.")
      .regex(/[0-9]/, "Password must contain a number."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const profileUpdateSchema = z.object({
  ign: z
    .string()
    .trim()
    .min(2, "IGN must be at least 2 characters.")
    .max(32, "IGN must be at most 32 characters.")
    .regex(/^[a-zA-Z0-9_\- ]+$/, "Letters, numbers, spaces, dashes and underscores only."),
  discord: z
    .string()
    .trim()
    .max(64, "Discord username must be at most 64 characters.")
    .optional()
    .or(z.literal("")),
});

export const teamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Team name must be at least 2 characters.")
    .max(60, "Team name must be at most 60 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters.")
    .optional()
    .or(z.literal("")),
});

export const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be at most 72 characters.")
      .regex(/[a-zA-Z]/, "Password must contain a letter.")
      .regex(/[0-9]/, "Password must contain a number."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type TeamInput = z.infer<typeof teamSchema>;
export type ResetInput = z.infer<typeof resetSchema>;

export function fieldErrors(result: { success: boolean; error?: z.ZodError }): Record<string, string> {
  if (result.success || !result.error) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
