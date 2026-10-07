import type { Json } from "@/integrations/supabase/types";
import { isStaffRole } from "@/lib/permissions";

export type PaymentMethod = "Cash" | "Cheque";
export const PAYMENT_METHODS: PaymentMethod[] = ["Cash", "Cheque"];
export const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"] as const;

// The application cycle is the academic year (the academic_year setting): one application per program
// per academic year, renewals, slots and budgets all follow it (migration 055).
/** First year of an academic year like "2025-2026", or NaN. Same as ay_start() in the database. */
export const ayStart = (ay: string | null | undefined) => {
  const m = /^(\d{4})-\d{4}$/.exec(ay ?? "");
  return m ? Number(m[1]) : NaN;
};
/** The academic year a date falls in, Philippine time, school year starting in June. Same as academic_year_of(). */
export function academicYearOf(d: Date): string {
  const [y, m] = d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).split("-").map(Number);
  const start = m < 6 ? y - 1 : y;
  return `${start}-${start + 1}`;
}

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
  facebook_url: string;
  required_documents: string[];
  default_payment_method: PaymentMethod;
  default_payment_lead_days: number;
  renewal_enabled: boolean;
  renewal_min_grade: number;
  max_renewals: number;
  payment_pickup_location: string;
  payment_pickup_instructions: string;
  report_prepared_by: string;
  report_prepared_title: string;
  report_approved_by: string;
  report_approved_title: string;
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
  facebook_url: "",
  required_documents: ["Valid ID", "Grades", "Certificate of Registration", "Barangay Indigency", "Birth Certificate"],
  default_payment_method: "Cash",
  default_payment_lead_days: 7,
  renewal_enabled: true,
  renewal_min_grade: 85,
  max_renewals: 3,
  payment_pickup_location: "",
  payment_pickup_instructions: "Please bring a valid ID.",
  report_prepared_by: "",
  report_prepared_title: "",
  report_approved_by: "",
  report_approved_title: "",
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
  const docs = Array.isArray(raw.required_documents)
    ? raw.required_documents.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : d.required_documents;
  const finalMethods = methods.length ? methods : d.payment_methods;
  const defMethod = raw.default_payment_method === "Cheque" || raw.default_payment_method === "Cash" ? raw.default_payment_method : d.default_payment_method;
  return {
    required_documents: docs,
    default_payment_method: finalMethods.includes(defMethod) ? defMethod : finalMethods[0],
    default_payment_lead_days: num(raw.default_payment_lead_days, d.default_payment_lead_days),
    renewal_enabled: bool(raw.renewal_enabled, d.renewal_enabled),
    renewal_min_grade: num(raw.renewal_min_grade, d.renewal_min_grade),
    max_renewals: num(raw.max_renewals, d.max_renewals),
    // Unset: the academic year today falls in, as current_academic_year() does.
    academic_year: str(raw.academic_year, academicYearOf(new Date())),
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
    facebook_url: str(raw.facebook_url, d.facebook_url),
    payment_pickup_location: str(raw.payment_pickup_location, d.payment_pickup_location),
    payment_pickup_instructions: str(raw.payment_pickup_instructions, d.payment_pickup_instructions),
    report_prepared_by: str(raw.report_prepared_by, d.report_prepared_by),
    report_prepared_title: str(raw.report_prepared_title, d.report_prepared_title),
    report_approved_by: str(raw.report_approved_by, d.report_approved_by),
    report_approved_title: str(raw.report_approved_title, d.report_approved_title),
  };
}

export type ApplicationsBlock =
  | { kind: "maintenance"; message: string }
  | { kind: "closed" }
  | { kind: "not_yet"; date: string }
  | { kind: "ended"; date: string };

/** Why students can't submit right now, or null when they can. */
export function applicationsBlock(s: AppSettings, today = new Date()): ApplicationsBlock | null {
  if (s.maintenance_mode) return { kind: "maintenance", message: s.maintenance_message };
  if (!s.applications_open) return { kind: "closed" };
  // UTC date: the database compares against CURRENT_DATE, which is UTC on Supabase.
  const iso = today.toISOString().slice(0, 10);
  if (s.application_open_date && iso < s.application_open_date) return { kind: "not_yet", date: s.application_open_date };
  if (s.application_close_date && iso > s.application_close_date) return { kind: "ended", date: s.application_close_date };
  return null;
}

/** Returns a human message when students can't submit right now, otherwise null. */
export function applicationsBlockedReason(s: AppSettings, today = new Date()): string | null {
  const b = applicationsBlock(s, today);
  if (!b) return null;
  switch (b.kind) {
    case "maintenance": return b.message;
    case "closed": return "Applications are currently closed.";
    case "not_yet": return `Applications open on ${b.date}.`;
    case "ended": return `The application period ended on ${b.date}.`;
  }
}

/** Client-side validation mirroring the database trigger. Returns an error message or null. */
export function validateSetting(key: SettingKey, value: unknown): string | null {
  switch (key) {
    case "renewal_min_grade":
    case "min_grade_requirement": {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? null : "Minimum grade must be between 0 and 100";
    }
    case "max_scholarships_per_student": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 20 ? null : "Max applications must be a whole number from 1 to 20";
    }
    case "default_payment_lead_days": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 365 ? null : "Lead days must be a whole number from 0 to 365";
    }
    case "max_renewals": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? null : "Max renewals must be a whole number from 0 to 10";
    }
    case "required_documents": {
      if (!Array.isArray(value)) return "Required documents must be a list";
      if (value.length > 12) return "At most 12 documents";
      const names = value.map((x) => String(x).trim().toLowerCase());
      if (names.some((x) => !x || x.length > 60)) return "Each document needs a name of up to 60 characters";
      return new Set(names).size === names.length ? null : "Documents must not repeat";
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
    case "payment_pickup_location":
    case "payment_pickup_instructions":
      return String(value).length <= 500 ? null : "Keep this under 500 characters";
    case "report_prepared_by":
    case "report_prepared_title":
    case "report_approved_by":
    case "report_approved_title":
      return String(value).length <= 120 ? null : "Keep this under 120 characters";
    case "facebook_url": {
      const v = String(value).trim();
      return v === "" || /^https?:\/\/\S+$/i.test(v) ? null : "Enter a full link starting with https://";
    }
    case "program_name":
    case "contact_email":
      return String(value).trim() ? null : "This field cannot be blank";
    default:
      return null;
  }
}

/** Roles that can open the admin area (any staff role; see lib/permissions for what each may do). */
export const isAdminRole = (role: string | null | undefined) => isStaffRole(role);
