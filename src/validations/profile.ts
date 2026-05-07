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
