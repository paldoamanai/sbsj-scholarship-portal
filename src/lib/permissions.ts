// What each staff role may do. Mirrors public.staff_may() (migration 050), which is what actually
// enforces it; this copy only decides which pages and buttons the admin panel shows.

export const STAFF_ROLES = ["super_admin", "admin", "reviewer", "finance_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Mayor Office", admin: "Admin", reviewer: "Reviewer", finance_admin: "Finance", student: "Student",
};

export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  super_admin: "Everything, plus staff, settings, deleting programs and account deletion requests.",
  admin: "Runs the office: programs, applicants, students, payments and announcements.",
  reviewer: "Applicants only: documents, grades, approving or disapproving, notes and messages.",
  finance_admin: "Money only: creating and disbursing payments, receipts and payment problems.",
};

export const isStaffRole = (role: string | null | undefined): role is StaffRole =>
  (STAFF_ROLES as readonly string[]).includes(role ?? "");

export type Permissions = {
  /** Programs, announcements, student accounts, award changes after approval, reminder jobs. */
  manage: boolean;
  /** Applicants: status changes, documents, grades, notes, messages. */
  review: boolean;
  /** Payments, receipts and payment problems. */
  finance: boolean;
  /** Staff, settings, deleting programs, account deletion requests. */
  super: boolean;
};

/** `canManageSettings` comes from can_manage_settings(): true for a super admin, or any admin while none exists. */
export function permissionsFor(role: string | null | undefined, canManageSettings: boolean): Permissions {
  const admin = role === "super_admin" || role === "admin";
  return {
    manage: admin,
    review: admin || role === "reviewer",
    finance: admin || role === "finance_admin",
    super: canManageSettings,
  };
}

// Offices (migrations 060 and 061): an Admin, Reviewer or Finance account can belong to Barangay
// Affairs or MSWDO. It keeps its role's permissions but only sees its office's programs and what's
// filed under them. No office means municipality-wide, like the Mayor Office.
export const STAFF_OFFICES = ["barangay_affairs", "mswdo"] as const;
export type StaffOffice = (typeof STAFF_OFFICES)[number];

export const OFFICE_LABEL: Record<StaffOffice, string> = {
  barangay_affairs: "Barangay Affairs",
  mswdo: "MSWDO",
};
export const OFFICE_FULL_NAME: Record<StaffOffice, string> = {
  barangay_affairs: "Barangay Affairs",
  mswdo: "Municipal Social Welfare and Development Office",
};

export const isOffice = (o: string | null | undefined): o is StaffOffice => (STAFF_OFFICES as readonly string[]).includes(o ?? "");
/** The Mayor Office works across every office, so it can't belong to one. */
export const roleCanHaveOffice = (role: string) => role === "admin" || role === "reviewer" || role === "finance_admin";
export const officeLabel = (office: string | null | undefined) => (isOffice(office) ? OFFICE_LABEL[office] : "All offices");

/** The name to show for a staff account, e.g. "MSWDO · Reviewer". */
export const staffLabel = (role: string, office?: string | null): string =>
  isOffice(office) && roleCanHaveOffice(role) ? `${OFFICE_LABEL[office]} · ${ROLE_LABEL[role] ?? role}` : ROLE_LABEL[role] ?? role;
