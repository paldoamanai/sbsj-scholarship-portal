import { z } from "zod";

export const STATEMENT_MIN = 50;
export const STATEMENT_MAX = 2000;

// Fields a student fills in on the application (also used when editing a pending application).
export const applicationDetailsSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(STATEMENT_MIN, `Your statement must be at least ${STATEMENT_MIN} characters`)
    .max(STATEMENT_MAX, `Your statement must be at most ${STATEMENT_MAX} characters`),
  household_income: z.number().min(0, "Income cannot be negative").max(1_000_000_000).nullable().optional(),
  household_size: z.number().int("Whole number only").min(1, "At least 1").max(30, "At most 30").nullable().optional(),
});

export const submitApplicationSchema = applicationDetailsSchema.extend({
  scholarship_id: z.string().uuid("Choose a scholarship program"),
  certified: z.literal(true, { errorMap: () => ({ message: "You must certify that your information is true" }) }),
});

export type ApplicationDetails = z.infer<typeof applicationDetailsSchema>;
