// What each staff role may do. Mirrors public.staff_may() (migration 050), which is what actually
// enforces it; this copy only decides which pages and buttons the admin panel shows.

export const STAFF_ROLES = ["super_admin", "admin", "reviewer", "finance_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Mayor Office", admin: "Admin", reviewer: "Reviewer", finance_admin: "Finance", student: "Scholar",
};

export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  super_admin: "Oversight: sees every office, runs programs, staff, settings, scholar accounts and deletion requests, and schedules payments and marks them received. Applicant decisions are left to the other roles.",
  admin: "Runs the office: programs, applicants, scholars, payments (scheduling and marking received) and announcements.",
  reviewer: "Applicants only: documents, grades, approving or disapproving, notes and messages.",
  finance_admin: "Money only: scheduling payments, marking them received (one at a time or in a batch) and payment problems.",
};

export const isStaffRole = (role: string | null | undefined): role is StaffRole =>
  (STAFF_ROLES as readonly string[]).includes(role ?? "");

export type Permissions = {
  /** Programs, announcements, student accounts, award changes after approval, reminder jobs. */
  manage: boolean;
  /** Applicants: status changes, documents, grades, messages. Not the Mayor Office (oversight only). */
  review: boolean;
  /** Payments (schedule, mark received, in batches) and payment problems. Every admin, the Mayor Office too. */
  finance: boolean;
  /** Staff, settings, deleting programs, account deletion requests. */
  super: boolean;
};

/** `canManageSettings` comes from can_manage_settings(): true for a super admin, or any admin while none exists. */
export function permissionsFor(role: string | null | undefined, canManageSettings: boolean): Permissions {
  const admin = role === "super_admin" || role === "admin";
  // The Mayor Office oversees: it sees everything but leaves applicant decisions to the Admin and Reviewer
  // accounts (only its screens change; the database would still allow them). Payments it handles like
  // every admin.
  return {
    manage: admin,
    review: role === "admin" || role === "reviewer",
    finance: admin || role === "finance_admin",
    super: canManageSettings,
  };
}

// Offices (migrations 060, 061 and 066): an Admin, Reviewer or Finance account can belong to Barangay
// Affairs, MSWDO or the Sangguniang Bayan Office. It keeps its role's permissions but only sees its office's programs and what's
// filed under them. No office means municipality-wide, like the Mayor Office.
export const STAFF_OFFICES = ["barangay_affairs", "mswdo", "sangguniang_bayan"] as const;
export type StaffOffice = (typeof STAFF_OFFICES)[number];

export const OFFICE_LABEL: Record<StaffOffice, string> = {
  barangay_affairs: "Barangay Affairs",
  mswdo: "MSWDO",
  sangguniang_bayan: "Sangguniang Bayan Office",
};
export const OFFICE_FULL_NAME: Record<StaffOffice, string> = {
  barangay_affairs: "Barangay Affairs",
  mswdo: "Municipal Social Welfare and Development Office",
  sangguniang_bayan: "Sangguniang Bayan Office",
};
/** An office's own seal, where it has one; the others use the municipal seal. */
export const OFFICE_LOGO: Partial<Record<StaffOffice, string>> = {
  mswdo: "/mswdo-logo.png",
  sangguniang_bayan: "/sangguniang-bayan-logo.png",
};
export const officeLogo = (office: string | null | undefined) => (isOffice(office) && OFFICE_LOGO[office]) || "/municipal-logo.png";

export const isOffice = (o: string | null | undefined): o is StaffOffice => (STAFF_OFFICES as readonly string[]).includes(o ?? "");
/** The Mayor Office works across every office, so it can't belong to one. */
export const roleCanHaveOffice = (role: string) => role === "admin" || role === "reviewer" || role === "finance_admin";
export const officeLabel = (office: string | null | undefined) => (isOffice(office) ? OFFICE_LABEL[office] : "All offices");

/** The name to show for a staff account, e.g. "MSWDO · Reviewer". */
export const staffLabel = (role: string, office?: string | null): string =>
  isOffice(office) && roleCanHaveOffice(role) ? `${OFFICE_LABEL[office]} · ${ROLE_LABEL[role] ?? role}` : ROLE_LABEL[role] ?? role;
