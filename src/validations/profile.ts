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

// ── Student profile (editable fields) ──
const phoneOptional = z.string().trim().regex(/^((09|\+639)\d{9})?$/, "Use 09XXXXXXXXX or +639XXXXXXXXX");
const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

export const studentProfileSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(60),
  middle_name: text(60),
  last_name: z.string().trim().min(1, "Last name is required").max(60),
  sex: z.enum(["", "Male", "Female"]),
  civil_status: z.enum(["", "Single", "Married", "Widowed"]),
  nationality: text(60),
  dob: z
    .string()
    .refine((v) => v === "" || (!Number.isNaN(Date.parse(v)) && new Date(v) <= new Date() && new Date(v) >= new Date("1900-01-01")), "Enter a valid date of birth"),
  phone: phoneOptional,
  street_address: text(120),
  barangay: text(80),
  municipality: text(80),
  province: text(80),
  zip_code: z.string().trim().regex(/^(\d{4})?$/, "ZIP code must be 4 digits"),
  guardian_name: text(100),
  guardian_relationship: text(40),
  guardian_phone: phoneOptional,
  school_name: text(120),
  course: text(80),
  year_level: z.enum(["", "Grade 11", "Grade 12", "1st Year", "2nd Year", "3rd Year", "4th Year"]),
  student_id_number: text(40),
  government_id: text(40),
});

export type StudentProfileForm = z.infer<typeof studentProfileSchema>;

export const emailChangeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

export const gradeSubmissionSchema = z.object({
  grade: z.number({ invalid_type_error: "Enter your average grade" }).min(0, "Grade must be 0–100").max(100, "Grade must be 0–100"),
  term: z.string().trim().min(3, "Enter the term, e.g. 1st Semester 2025-2026").max(60),
});
