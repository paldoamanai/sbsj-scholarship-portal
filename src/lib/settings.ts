import type { Json } from "@/integrations/supabase/types";

export type PaymentMethod = "Cash" | "Cheque";
export const PAYMENT_METHODS: PaymentMethod[] = ["Cash", "Cheque"];
export const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"] as const;

export interface AppSettings {
  academic_year: string;
  current_semester: string;
  min_grade_requirement: number;
  max_scholarships_per_student: number;
  payment_methods: PaymentMethod[];
  email_notifications: boolean;
  applications_open: boolean;
  application_open_date: string;
  application_close_date: string;
  maintenance_mode: boolean;
  maintenance_message: string;
  max_upload_mb: number;
  program_name: string;
  contact_email: string;
  contact_phone: string;
  contact_address: string;
  office_hours: string;
}

export const SETTING_DEFAULTS: AppSettings = {
  academic_year: "2025-2026",
  current_semester: "1st Semester",
  min_grade_requirement: 85,
  max_scholarships_per_student: 1,
  payment_methods: ["Cash", "Cheque"],
  email_notifications: true,
  applications_open: true,
  application_open_date: "",
  application_close_date: "",
  maintenance_mode: false,
  maintenance_message: "The portal is temporarily unavailable for submissions. Please try again later.",
  max_upload_mb: 5,
  program_name: "SB San Jose Scholarship Portal",
  contact_email: "scholarship@sbsj.gov.ph",
  contact_phone: "(043) 457-0001",
  contact_address: "Sangguniang Bayan Building, San Jose, Occidental Mindoro, Philippines 5100",
  office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
};

export type SettingKey = keyof AppSettings;

const num = (v: unknown, fallback: number) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown, fallback: boolean) => (v === true || v === "true" ? true : v === false || v === "false" ? false : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** Turns raw system_settings rows into a typed object, tolerating legacy string-typed values. */
export function parseSettings(rows: { key: string; value: Json }[] | null | undefined): AppSettings {
  const raw: Record<string, Json> = {};
  (rows ?? []).forEach((r) => { raw[r.key] = r.value; });
  const d = SETTING_DEFAULTS;
  const methods = Array.isArray(raw.payment_methods)
    ? (raw.payment_methods.filter((m): m is PaymentMethod => m === "Cash" || m === "Cheque"))
    : d.payment_methods;
  return {
    academic_year: str(raw.academic_year, d.academic_year),
    current_semester: str(raw.current_semester, d.current_semester),
    min_grade_requirement: num(raw.min_grade_requirement, d.min_grade_requirement),
    max_scholarships_per_student: num(raw.max_scholarships_per_student, d.max_scholarships_per_student),
    payment_methods: methods.length ? methods : d.payment_methods,
    email_notifications: bool(raw.email_notifications, d.email_notifications),
    applications_open: bool(raw.applications_open, d.applications_open),
    application_open_date: str(raw.application_open_date, d.application_open_date),
    application_close_date: str(raw.application_close_date, d.application_close_date),
    maintenance_mode: bool(raw.maintenance_mode, d.maintenance_mode),
    maintenance_message: str(raw.maintenance_message, d.maintenance_message) || d.maintenance_message,
    max_upload_mb: num(raw.max_upload_mb, d.max_upload_mb),
    program_name: str(raw.program_name, d.program_name) || d.program_name,
    contact_email: str(raw.contact_email, d.contact_email) || d.contact_email,
    contact_phone: str(raw.contact_phone, d.contact_phone),
    contact_address: str(raw.contact_address, d.contact_address),
    office_hours: str(raw.office_hours, d.office_hours),
  };
}

/** Returns a human message when students can't submit right now, otherwise null. */
export function applicationsBlockedReason(s: AppSettings, today = new Date()): string | null {
  if (s.maintenance_mode) return s.maintenance_message;
  if (!s.applications_open) return "Applications are currently closed.";
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (s.application_open_date && iso < s.application_open_date) return `Applications open on ${s.application_open_date}.`;
  if (s.application_close_date && iso > s.application_close_date) return `The application period ended on ${s.application_close_date}.`;
  return null;
}

/** Client-side validation mirroring the database trigger. Returns an error message or null. */
export function validateSetting(key: SettingKey, value: unknown): string | null {
  switch (key) {
    case "min_grade_requirement": {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? null : "Minimum grade must be between 0 and 100";
    }
    case "max_scholarships_per_student": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 20 ? null : "Max applications must be a whole number from 1 to 20";
    }
    case "max_upload_mb": {
      const n = Number(value);
      return Number.isFinite(n) && n >= 1 && n <= 25 ? null : "Upload limit must be between 1 and 25 MB";
    }
    case "academic_year": {
      const m = /^(\d{4})-(\d{4})$/.exec(String(value));
      return m && Number(m[2]) === Number(m[1]) + 1 ? null : "Academic year must look like 2025-2026";
    }
    case "payment_methods":
      return Array.isArray(value) && value.length > 0 ? null : "Enable at least one payment method";
    case "program_name":
    case "contact_email":
      return String(value).trim() ? null : "This field cannot be blank";
    default:
      return null;
  }
}
