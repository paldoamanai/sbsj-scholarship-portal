import { z } from "zod";

/** The password rule for new passwords (registration and reset). Account Settings uses the same rule. */
export const newPasswordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/\d/, "Include a number");

export const PASSWORD_HINT = "At least 8 characters with an uppercase letter, a lowercase letter and a number.";

/** First problem with a new password, or null when it passes. */
export function passwordProblem(password: string): string | null {
  const r = newPasswordSchema.safeParse(password);
  return r.success ? null : r.error.issues[0].message;
}

/** 0–4 score for the strength meter: one point each for length 8+, mixed case, a digit, and 12+ chars or a symbol. */
export function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (password.length >= 12 || /[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

export const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;
