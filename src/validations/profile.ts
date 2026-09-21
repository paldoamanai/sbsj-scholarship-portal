import { z } from "zod";

export const profileSchema = z.object({
  first_name: z.string().min(1, "Required"),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, "Required"),
  sex: z.enum(["Male", "Female"]),
  civil_status: z.enum(["Single", "Married", "Widowed"]),
  nationality: z.string().default("Filipino"),
  dob: z.string().min(1, "Required"),
  phone: z
    .string()
    .regex(/^(09|\+639)\d{9}$/, "Valid PH phone required"),
  barangay: z.string().min(1, "Required"),
  municipality: z.string().min(1, "Required"),
});

export const academicSchema = z.object({
  school_name: z.string().min(1, "Required"),
  course: z.string().min(1, "Required"),
  year_level: z.string().min(1, "Required"),
  average_grade: z.number().min(85, "Must be 85 or above to be eligible"),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type AcademicInput = z.infer<typeof academicSchema>;

export const adminProfileSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(60),
  last_name: z.string().trim().min(1, "Last name is required").max(60),
  phone: z
    .string()
    .trim()
    .regex(/^((09|\+639)\d{9})?$/, "Use a valid PH number (09XXXXXXXXX or +639XXXXXXXXX)"),
});

export const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/[A-Z]/, "Include an uppercase letter")
      .regex(/[a-z]/, "Include a lowercase letter")
      .regex(/\d/, "Include a number"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords do not match" })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "New password must differ from the current one" });
