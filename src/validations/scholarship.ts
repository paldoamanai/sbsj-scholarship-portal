import { z } from "zod";
import { YEAR_LEVELS } from "@/lib/scholarships";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => v || null).nullable().optional().transform((v) => v ?? null);

export const scholarshipSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
    description: optionalText(2000),
    eligibility: optionalText(2000),
    amount: z.number({ invalid_type_error: "Award amount must be a number" }).min(0, "Award amount cannot be negative").max(100_000_000),
    total_budget: z.number({ invalid_type_error: "Budget must be a number" }).min(0, "Budget cannot be negative").max(10_000_000_000),
    slots: z.number({ invalid_type_error: "Slots must be a number" }).int("Slots must be a whole number").min(0, "Slots cannot be negative").max(100_000),
    open_date: z.string().nullable(),
    deadline: z.string().nullable(),
    min_grade: z.number().min(0, "Minimum grade must be 0–100").max(100, "Minimum grade must be 0–100").nullable(),
    year_levels: z.array(z.enum(YEAR_LEVELS)),
    municipality: optionalText(80),
    is_active: z.boolean(),
  })
  .refine((d) => !d.open_date || !d.deadline || d.open_date <= d.deadline, {
    message: "The opening date must be on or before the deadline",
    path: ["open_date"],
  });

export type ScholarshipInput = z.infer<typeof scholarshipSchema>;
