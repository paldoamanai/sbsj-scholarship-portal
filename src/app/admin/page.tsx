"use client";

import { useHistorySync } from "@/hooks/use-history-sync";
import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  LayoutDashboard, GraduationCap, FileText, Users,
  Plus, Pencil, Trash2, CheckCircle, XCircle, Clock, Eye,
  Menu, X, Search, LogOut, Wallet, Banknote, BarChart3,
  Bell, ScrollText, Settings as SettingsIcon, Lock,
  FileDown, Receipt, Loader2, User, Upload, ArrowRight,
   ChevronRight, ChevronLeft, ExternalLink, Printer, Power, Hourglass, RotateCcw, Copy, AlertTriangle, ShieldCheck, Undo2, MapPin,
} from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { scholarshipSchema } from "@/validations/scholarship";
import ProfileImage from "@/components/ProfileImage";
import { programChecks, type RequirementCheck } from "@/lib/scholarships";
import { HOME_MUNICIPALITY } from "@/lib/barangays";
import { ScholarshipFormFields } from "@/components/admin/ScholarshipFormFields";
import { AppDialog, ChoiceButton, Detail, DetailGrid, DialogField, DialogNote, DialogSection, ReasonDialog } from "@/components/AppDialog";
import NotificationInbox, { NOTIFICATION_PAGE } from "@/components/notifications/NotificationInbox";
import AnnouncementsPanel from "@/components/admin/AnnouncementsPanel";
import ReminderJobsCard from "@/components/admin/ReminderJobsCard";
import { useUnreadTitle } from "@/hooks/use-unread-title";
import { useAuditLogQuery } from "@/hooks/use-audit-log-query";
import { showDesktopAlert } from "@/lib/desktop-alerts";
import NotificationPreferences from "@/components/notifications/NotificationPreferences";
import OverviewPanel from "@/components/admin/OverviewPanel";
import AdminProfilePanel from "@/components/admin/AdminProfilePanel";
import SettingsPanel from "@/components/admin/SettingsPanel";
import StaffPanel from "@/components/admin/StaffPanel";
import StudentAccountActions from "@/components/admin/StudentAccountActions";
import ReportsPanel from "@/components/admin/ReportsPanel";
import {
  getRange, logsToSection, personName, renderExcel, renderPDF,
  type DocSummary, type ReportData, type ReportDef, type StaffMember,
} from "@/lib/reports";
import { parseSettings, isAdminRole, type AppSettings } from "@/lib/settings";
import { asMonths, asSchedule, isMonthTerm, openTerms, secondSemesterGradeWarning, termLabel, termsFor, yearlyAward, type PaymentTerm } from "@/lib/release-schedule";
import { OFFICE_FULL_NAME, OFFICE_LABEL, STAFF_OFFICES, isOffice, officeLogo, permissionsFor, roleCanHaveOffice, staffLabel } from "@/lib/permissions";
import { printReceiptSlip } from "@/lib/receipt-slip";
import { LETTER_OF_INTENT, MOA } from "@/lib/documents";
import { approvalDocuments, needsHomeVisit, needsHousePin, needsMoa } from "@/lib/office-requirements";
import { directionsLink, distanceKm, earthLink, fmtDistance, googleMapsLink, streetViewLink } from "@/lib/geo";
import HomeVisitsPanel from "@/components/admin/HomeVisitsPanel";
import dynamic from "next/dynamic";
import { peso, pesoFixed as formatPHP } from "@/lib/format";
import { MoneyInput } from "@/components/MoneyInput";
import type { Tables, Json } from "@/integrations/supabase/types";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAll } from "@/lib/fetch-all";

// The house map only loads in the browser, and only when a pinned house is shown.
const HouseMap = dynamic(() => import("@/components/student/HouseMap"), {
  ssr: false,
  loading: () => <div className="h-48 w-full rounded-xl border bg-muted animate-pulse" />,
});

// Ordered by the scholarship process: set up a program, review applicants, manage scholars,
// pay them out, then track and report. Each group gets a heading in the sidebar.
const sidebarItems = [
  { icon: LayoutDashboard, label: "Dashboard", key: "overview", group: "" },
  { icon: GraduationCap, label: "Scholarships", key: "scholarships", group: "Process" },
  { icon: FileText, label: "Applicants", key: "applications", group: "Process" },
  { icon: MapPin, label: "Home Visits", key: "visits", group: "Process" },
  { icon: Users, label: "Students", key: "students", group: "Process" },
  { icon: Banknote, label: "Disbursement", key: "disbursement", group: "Process" },
  { icon: Wallet, label: "Funds", key: "funds", group: "Monitoring" },
  { icon: BarChart3, label: "Reports", key: "reports", group: "Monitoring" },
  { icon: ScrollText, label: "Audit Logs", key: "audit-logs", group: "Monitoring" },
  { icon: Bell, label: "Notifications", key: "notifications", group: "Monitoring" },
  { icon: ShieldCheck, label: "Staff", key: "staff", group: "Administration" },
  { icon: SettingsIcon, label: "Settings", key: "settings", group: "Administration" },
  { icon: User, label: "Profile", key: "profile", group: "Administration" },
];

// Sections each role doesn't need. Everything is still enforced by the database (migration 050).
const hiddenSections: Record<string, string[]> = {
  reviewer: ["disbursement", "funds", "audit-logs"],
  finance_admin: ["applications", "visits", "audit-logs"],
};


// ── Status badge (pastel pill + icon, mirrors student-dashboard's pattern) ──────
function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "—") return <span className="text-sm text-muted-foreground">—</span>;
  const map: Record<string, { icon: typeof CheckCircle; cls: string }> = {
    Approved:   { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Pending:    { icon: Clock,        cls: "bg-amber-50 text-amber-700 border-amber-200" },
    Disapproved:   { icon: XCircle,      cls: "bg-red-50 text-red-700 border-red-200" },
    Disbursed:  { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Processing: { icon: Clock,        cls: "bg-accent text-primary border-primary/20" },
    Waitlisted: { icon: Clock,        cls: "bg-muted text-muted-foreground border-border" },
    Cancelled:  { icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" },
    Withdrawn:  { icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[status];
  if (!m) return <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">{status}</span>;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      <Icon className="h-3 w-3" />{status}
    </span>
  );
}

// ── Reports / audit helpers ──
type AdminDoc = { id: string; applicationId: string | null; name: string; type: string; url: string; status: string; note: string | null; size: number | null; uploadedAt: string };

// Older audit rows stored their values as JSON-encoded strings; newer ones are real JSON.
function parseJson(v: Json | null | undefined): unknown {
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } }
  return v ?? null;
}
function asObj(v: Json | null | undefined): Record<string, unknown> {
  const x = parseJson(v);
  if (x && typeof x === "object" && !Array.isArray(x)) return x as Record<string, unknown>;
  return x === null ? {} : { value: x };
}
const fmtVal = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function AdminDashboardPage() {
  return <AdminDashboard />;
}

function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();
  const [activeSection, setActiveSection] = useState("overview");
  useHistorySync("sbsjSection", activeSection, setActiveSection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [appSearch, setAppSearch] = useState("");
  const [schSearch, setSchSearch] = useState("");
  const [schFilter, setSchFilter] = useState("all");
  const [schDialog, setSchDialog] = useState<"new" | Tables<"scholarships"> | null>(null);
  const [schActive, setSchActive] = useState(true);
  const [schYearLevels, setSchYearLevels] = useState<string[]>([]);
  const [schBarangays, setSchBarangays] = useState<string[]>([]);
  const [schBarangaySearch, setSchBarangaySearch] = useState("");
  const [deleteSch, setDeleteSch] = useState<Tables<"scholarships"> | null>(null);
  // Deleting a program is permanent, so the super admin types its name to confirm.
  const [deleteSchText, setDeleteSchText] = useState("");
  const [deletingSch, setDeletingSch] = useState(false);
  // Guards against a double click saving twice (two programs, two payments).
  const [savingSch, setSavingSch] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [fundPeriod, setFundPeriod] = useState("all"); // shared by Fund Management and Reports
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditEntity, setAuditEntity] = useState("all");
  const [auditUser, setAuditUser] = useState("all");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [viewLog, setViewLog] = useState<Tables<"audit_logs"> | null>(null);
  const [paySearch, setPaySearch] = useState("");
  const [payFilter, setPayFilter] = useState("all");
  const [payPage, setPayPage] = useState(1);
  const [payDialog, setPayDialog] = useState<"new" | Tables<"payments"> | null>(null);
  const [payAppId, setPayAppId] = useState("");
  const [payMethod, setPayMethod] = useState<"Cash" | "Cheque">("Cash");
  // Which period a payment is for (null: an older payment made before payments had a term).
  const [payTerm, setPayTerm] = useState<PaymentTerm | null>(null);
  // Scheduling one semester's payments for every eligible scholar at once.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTerm, setBulkTerm] = useState<PaymentTerm>("1st Semester");
  const [bulkPicked, setBulkPicked] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [bulkPayBusy, setBulkPayBusy] = useState(false);
  const [cancelPay, setCancelPay] = useState<Tables<"payments"> | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [payIssues, setPayIssues] = useState<Tables<"payment_issues">[]>([]);
  const [issueDialog, setIssueDialog] = useState<Tables<"payments"> | null>(null);
  const [issueResponse, setIssueResponse] = useState("");
  const [disapproveReceipt, setDisapproveReceipt] = useState<Tables<"payments"> | null>(null);
  const [receiptNote, setReceiptNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [gradeReviews, setGradeReviews] = useState<Tables<"grade_updates">[]>([]);
  const [dataReqs, setDataReqs] = useState<Tables<"data_requests">[]>([]);
  const [disapproveGrade, setDisapproveGrade] = useState<Tables<"grade_updates"> | null>(null);
  const [gradeNote, setGradeNote] = useState("");
  const [handleReq, setHandleReq] = useState<Tables<"data_requests"> | null>(null);
  const [reqResponse, setReqResponse] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentFilter, setStudentFilter] = useState("all");
  const [studentSort, setStudentSort] = useState("name");
  const [studentProgram, setStudentProgram] = useState("all");
  const [studentDisb, setStudentDisb] = useState("all");
  const [studentPage, setStudentPage] = useState(1);
  const [viewStudent, setViewStudent] = useState<Tables<"profiles"> | null>(null);
  // Student Management: quick edit of a scholar's payment reference number and disbursement status.
  const [editDisb, setEditDisb] = useState<Tables<"profiles"> | null>(null);
  const [editDisbPayId, setEditDisbPayId] = useState("");
  const [editDisbRef, setEditDisbRef] = useState("");
  const [editDisbStatus, setEditDisbStatus] = useState("Pending");
  const [editDisbReason, setEditDisbReason] = useState("");
  const [studentDocs, setStudentDocs] = useState<AdminDoc[]>([]);
  const [studentDocsLoading, setStudentDocsLoading] = useState(false);

  const [allApplications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string } | null, profiles?: Tables<"profiles"> | null })[]>([]);
  const [allScholarships, setScholarships] = useState<Tables<"scholarships">[]>([]);
  const [profiles, setProfiles] = useState<Tables<"profiles">[]>([]);
  const [allPayments, setPayments] = useState<Tables<"payments">[]>([]);
  const [viewApp, setViewApp] = useState<typeof applications[0] | null>(null);
  const [remarks, setRemarks] = useState("");
  const [visitAt, setVisitAt] = useState("");
  const [visitNote, setVisitNote] = useState("");
  const [visitBusy, setVisitBusy] = useState(false);
  const [pinHistory, setPinHistory] = useState<Tables<"home_location_history">[]>([]);
  // An application to open once the list has loaded (from a notification's ?view= link).
  const [pendingView, setPendingView] = useState<string | null>(null);
  const [appPage, setAppPage] = useState(1);
  const [viewDocs, setViewDocs] = useState<AdminDoc[]>([]);
  const [allDocs, setAllDocs] = useState<DocSummary[]>([]);
  const [disapproveDoc, setDisapproveDoc] = useState<AdminDoc | null>(null);
  const [disapproveNote, setDisapproveNote] = useState("");
  const [disapproveApp, setDisapproveApp] = useState<(typeof applications)[number] | null>(null);
  const [disapproveAppNote, setDisapproveAppNote] = useState("");
  const [disapprovingApp, setDisapprovingApp] = useState(false);
  // Revoke an approval (back to Pending); the reason is sent to the student.
  const [revokeApp, setRevokeApp] = useState<(typeof applications)[number] | null>(null);
  const [revokeNote, setRevokeNote] = useState("");
  const [revokingApp, setRevokingApp] = useState(false);
  // Award amount in the application dialog: set when approving, editable once approved.
  const [awardInput, setAwardInput] = useState("");
  // Internal notes on the open application (staff only; never shown to the student).
  const [appNotes, setAppNotes] = useState<Tables<"application_notes">[]>([]);
  const [newAppNote, setNewAppNote] = useState("");
  const [savingAppNote, setSavingAppNote] = useState(false);
  // Bulk actions on Pending / Waitlisted applications.
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDisapprove, setBulkDisapprove] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [appProgram, setAppProgram] = useState("all");
  // Students who haven't applied yet, selected for a bulk reminder.
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  // Messages to students: reminders to apply, and change requests on an open application.
  const [reminderFor, setReminderFor] = useState<string[] | null>(null);
  const [reminderText, setReminderText] = useState("");
  const [changesFor, setChangesFor] = useState<(typeof applications)[number] | null>(null);
  const [changesText, setChangesText] = useState("");
  const [messaging, setMessaging] = useState(false);
  // Bumped when a document changes over realtime, so open dialogs re-read their document list.
  const [docsVersion, setDocsVersion] = useState(0);
  const [reviewingDoc, setReviewingDoc] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<Tables<"audit_logs">[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [systemSettings, setSystemSettings] = useState<Tables<"system_settings">[]>([]);
  const [adminProfile, setAdminProfile] = useState<Tables<"profiles"> | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [adminRole, setAdminRole] = useState("admin");
  const [adminOffice, setAdminOffice] = useState<string | null>(null);
  // A super admin, or any admin while no super admin exists (migration 020). Gates Settings edits and Staff.
  const [canManageSettings, setCanManageSettings] = useState(false);
  // What the signed-in staff member may do; buttons they can't use are hidden (the database refuses them anyway).
  const can = permissionsFor(adminRole, canManageSettings);
  // Office staff only see their office's programs (enforced by migration 061); null = all offices.
  const myOffice = roleCanHaveOffice(adminRole) && isOffice(adminOffice) ? adminOffice : null;
  // Programs carry an office once migration 061 has run; until then the program form doesn't offer one.
  const officesReady = allScholarships.some((sch) => "office" in sch);
  // An Admin of an office manages that office's Reviewer and Finance staff (migration 065).
  const managedOffice = adminRole === "admin" ? myOffice : null;
  // Staff without an office (the Mayor Office) can narrow every page to one office's programs, or to the
  // programs that belong to no office ("municipal"). Office staff only ever load their own office's data.
  const [officeView, setOfficeView] = useState<string>("all");
  const viewingOffice = !myOffice && officesReady && officeView !== "all";
  const scholarships = useMemo(
    () => (viewingOffice ? allScholarships.filter((sch) => (sch.office ?? "municipal") === officeView) : allScholarships),
    [allScholarships, viewingOffice, officeView]);
  const applications = useMemo(() => {
    if (!viewingOffice) return allApplications;
    const ids = new Set(scholarships.map((sch) => sch.id));
    return allApplications.filter((a) => !!a.scholarship_id && ids.has(a.scholarship_id));
  }, [allApplications, scholarships, viewingOffice]);
  const payments = useMemo(() => {
    if (!viewingOffice) return allPayments;
    const ids = new Set(applications.map((a) => a.id));
    return allPayments.filter((p) => p.application_id && ids.has(p.application_id));
  }, [allPayments, applications, viewingOffice]);
  // Exports made while viewing one office say so in the file name.
  const fileOffice = viewingOffice ? `-${officeView.replace(/_/g, "-")}` : "";
  // Programs, applicants, approvals and money per office, for the Mayor Office's dashboard.
  const officeBreakdown = useMemo(() => {
    if (myOffice || !officesReady) return [];
    const keys = [...STAFF_OFFICES, "municipal"] as const;
    return keys.map((key) => {
      const progs = allScholarships.filter((sch) => (sch.office ?? "municipal") === key);
      const ids = new Set(progs.map((sch) => sch.id));
      const apps = allApplications.filter((a) => !!a.scholarship_id && ids.has(a.scholarship_id));
      const appIds = new Set(apps.map((a) => a.id));
      const pays = allPayments.filter((p) => p.application_id && appIds.has(p.application_id));
      return {
        key, name: key === "municipal" ? "Mayor Office programs" : OFFICE_LABEL[key],
        programs: progs.length,
        applications: apps.length,
        pending: apps.filter((a) => a.status === "Pending").length,
        approved: apps.filter((a) => a.status === "Approved").length,
        budget: progs.filter((sch) => sch.is_active).reduce((t, sch) => t + Number(sch.total_budget || 0), 0),
        disbursed: pays.filter((p) => p.status === "Disbursed").reduce((t, p) => t + Number(p.amount || 0), 0),
      };
    }).filter((r) => r.programs > 0);
  }, [myOffice, officesReady, allScholarships, allApplications, allPayments]);
  // Students' house pins and the Home Visits map are for MSWDO staff only.
  const mapAccess = myOffice === "mswdo";
  const canSee = (key: string) => (key === "staff" ? can.super || !!managedOffice
    : key === "visits" ? mapAccess
    : !(hiddenSections[adminRole] ?? []).includes(key));
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Tables<"notifications">[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  // The realtime handler is created once, so it reads the current section and link handler through refs.
  const activeSectionRef = useRef("overview");
  const goToLinkRef = useRef<(link: string) => void>(() => {});
  const refreshAdminUnread = async () => {
    if (!adminUserId) return;
    const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", adminUserId).eq("muted", false).eq("read", false);
    if (count != null) setUnreadTotal(count);
  };
  useUnreadTitle(unreadTotal);

  // Disburse dialog state
  const [disbDialog, setDisbDialog] = useState(false);
  const [disbPaymentId, setDisbPaymentId] = useState<string>("");
  const [disbMethod, setDisbMethod] = useState<"Cheque" | "Cash">("Cash");
  const [disbRef, setDisbRef] = useState("");
  const [disbReceipt, setDisbReceipt] = useState<File | null>(null);
  // Portal-issued receipt numbers (staff-only): printed on the acknowledgment slip, typed back by the student.
  const [receiptNos, setReceiptNos] = useState<Record<string, string>>({});
  const [disbLoading, setDisbLoading] = useState(false);

  useEffect(() => { loadData(); }, []);
  // The home visit form follows the application being viewed. datetime-local wants local "YYYY-MM-DDTHH:mm".
  useEffect(() => {
    const at = viewApp?.home_visit_at ? new Date(viewApp.home_visit_at) : null;
    setVisitAt(at ? new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
    setVisitNote(viewApp?.home_visit_note ?? "");
  }, [viewApp?.id, viewApp?.home_visit_at, viewApp?.home_visit_note]);

  // Profiles of students only — staff accounts (anyone with a non-student role) are excluded.
  // Staff are kept aside (with their role) so reports can name who disbursed, reviewed or changed something.
  // "*" rather than naming office, so this still works on a database without migration 060.
  const staffRoles = () => supabase.from("user_roles").select("*").neq("role", "student");
  type StaffRoleRow = { user_id: string; role: string; office: string | null };
  const withoutStaff = async (rows: Tables<"profiles">[], roleRows?: StaffRoleRow[] | null) => {
    const data = roleRows ?? (await staffRoles()).data;
    const roles = new Map((data ?? []).map((r: StaffRoleRow) => [r.user_id, r]));
    setStaff(rows.filter((p) => roles.has(p.id)).map((p) => ({ id: p.id, name: personName(p), email: p.email, role: roles.get(p.id)!.role, office: roles.get(p.id)!.office ?? null })));
    return rows.filter((p) => !roles.has(p.id));
  };

  const joinProfiles = (apps: (Tables<"applications"> & { scholarships: { name: string } | null })[], rows: Tables<"profiles">[]) => {
    const byId = new Map(rows.map((p) => [p.id, p]));
    return apps.map((a) => ({ ...a, profiles: byId.get(a.user_id) ?? null }));
  };

  // The tables that grow with every applicant, read in full (ordered by id as well, so pages don't overlap).
  const fetchAllApps = () => fetchAll((f, t) => supabase.from("applications").select("*, scholarships(name)").order("created_at", { ascending: false }).order("id").range(f, t));
  const fetchAllPayments = () => fetchAll((f, t) => supabase.from("payments").select("*").order("created_at", { ascending: false }).order("id").range(f, t));
  const fetchAllProfiles = () => fetchAll((f, t) => supabase.from("profiles").select("*").order("id").range(f, t));
  const fetchAllDocs = () => fetchAll((f, t) => supabase.from("documents").select("id, user_id, application_id, document_type, status, uploaded_at").order("id").range(f, t));
  const fetchAllReceiptNos = () => fetchAll((f, t) => supabase.from("payment_receipt_numbers").select("payment_id, receipt_no").order("payment_id").range(f, t));

  const loadData = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    // The middleware has already verified the session for /admin, so read it locally instead of
    // another round trip; row-level security still guards every query below.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) { router.push("/login"); return; }

    setAdminEmail(user.email || "");
    setAdminUserId(user.id);

    // Everything is fetched in one parallel batch: each query is a full round trip to Supabase,
    // so running them one after another made the dashboard several seconds slower to open.
    const [roleRes, canManageRes, staffRolesRes, appsRes, scholsRes, profilesRes, paymentsRes, logsRes, settingsRes, adminProfRes, notifsRes, unreadRes, docsRes, issuesRes, gradesRes, reqsRes, receiptNosRes] = await Promise.all([
      supabase.from("user_roles").select("*").eq("user_id", user.id).single(),
      supabase.rpc("can_manage_settings", { _user_id: user.id }),
      staffRoles(),
      fetchAllApps(),
      supabase.from("scholarships").select("*").order("created_at", { ascending: false }),
      fetchAllProfiles(),
      fetchAllPayments(),
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("system_settings").select("*"),
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("notifications").select("*").eq("user_id", user.id).eq("muted", false).order("created_at", { ascending: false }).limit(NOTIFICATION_PAGE),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("muted", false).eq("read", false),
      fetchAllDocs(),
      fetchAll((f, t) => supabase.from("payment_issues").select("*").order("created_at", { ascending: false }).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("grade_updates").select("*").order("created_at", { ascending: false }).order("id").range(f, t)),
      supabase.from("data_requests").select("*").order("created_at", { ascending: false }),
      fetchAllReceiptNos(),
    ]);

    const role = (roleRes.data as { role?: string } | null)?.role;
    if (!isAdminRole(role)) { router.push("/student-dashboard"); return; }
    setAdminRole(role as string);
    setAdminOffice((roleRes.data as { office?: string | null } | null)?.office ?? null);
    setCanManageSettings(canManageRes.data === true);

    const failed = [appsRes, scholsRes, profilesRes, paymentsRes, logsRes, settingsRes, adminProfRes, notifsRes, unreadRes, docsRes, issuesRes, gradesRes, reqsRes].find((r) => r.error);
    setLoadError(failed?.error ? failed.error.message : null);
    if (appsRes.data) setApplications(joinProfiles(appsRes.data, profilesRes.data ?? []));
    if (scholsRes.data) setScholarships(scholsRes.data);
    if (profilesRes.data) setProfiles(await withoutStaff(profilesRes.data, staffRolesRes.data));
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (logsRes.data) setAuditLogs(logsRes.data);
    if (settingsRes.data) setSystemSettings(settingsRes.data);
    if (adminProfRes.data) setAdminProfile(adminProfRes.data);
    if (notifsRes.data) setNotifications(notifsRes.data);
    if (unreadRes.count != null) setUnreadTotal(unreadRes.count);
    if (docsRes.data) setAllDocs(docsRes.data);
    if (issuesRes.data) setPayIssues(issuesRes.data);
    if (gradesRes.data) setGradeReviews(gradesRes.data);
    if (reqsRes.data) setDataReqs(reqsRes.data);
    if (receiptNosRes.data) setReceiptNos(Object.fromEntries(receiptNosRes.data.map((r) => [r.payment_id, r.receipt_no])));
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  };

  // Re-fetch applications/payments in the background (no loading flicker) —
  // used when a live change comes in over realtime.
  const silentRefreshAdmin = async () => {
    const [appsRes, paymentsRes, profilesRes, docsRes, receiptNosRes] = await Promise.all([
      fetchAllApps(), fetchAllPayments(), fetchAllProfiles(), fetchAllDocs(), fetchAllReceiptNos(),
    ]);
    if (receiptNosRes.data) setReceiptNos(Object.fromEntries(receiptNosRes.data.map((r) => [r.payment_id, r.receipt_no])));
    if (docsRes.data) setAllDocs(docsRes.data);
    if (appsRes.data) setApplications(joinProfiles(appsRes.data, profilesRes.data ?? []));
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (profilesRes.data) setProfiles(await withoutStaff(profilesRes.data));
    setLastUpdated(new Date());
  };

  // ── Live updates: new applications, status/disbursement changes, registrations ──
  useEffect(() => {
    if (!adminUserId) return;

    const channel = supabase
      .channel("admin-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "applications" },
        () => { toast.info("New scholarship application submitted"); silentRefreshAdmin(); }
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications" }, () => silentRefreshAdmin())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payments" }, () => silentRefreshAdmin())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "payments" }, () => silentRefreshAdmin())
      // A program deleted elsewhere takes its applications and payments with it.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "applications" }, () => silentRefreshAdmin())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "payments" }, () => silentRefreshAdmin())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "profiles" },
        (payload) => {
          const p = payload.new as Tables<"profiles">;
          const name = `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || "A new student";
          toast.info("New student registered", { description: name });
          silentRefreshAdmin();
        }
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, () => silentRefreshAdmin())
      // Uploads and reviews change the requirement checks (see migration 041 for the publication).
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => {
        silentRefreshAdmin();
        setDocsVersion((v) => v + 1);
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${adminUserId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          if (n.muted) return;
          setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
          if (!n.read) setUnreadTotal((c) => c + 1);
          const open = () => (n.link ? goToLinkRef.current(n.link) : setActiveSection("notifications"));
          showDesktopAlert(n, open);
          // Already looking at the inbox: the new row appears there, so no popup on top of it.
          if (activeSectionRef.current === "notifications") return;
          const notify = toast[n.type as "info" | "success" | "warning" | "error"] ?? toast.message;
          notify(n.title, { description: n.message, action: { label: "Open", onClick: open } });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${adminUserId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          setNotifications((prev) => prev.map((x) => (x.id === n.id ? n : x)));
          refreshAdminUnread();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [adminUserId]);

  const handleLogout = async () => { await supabase.auth.signOut(); router.push("/"); router.refresh(); };

  // Documents live in a private bucket, so sign a short-lived URL from the stored object path.
  const loadSignedDocs = async (userId: string) => {
    const { data } = await supabase.from("documents").select("*").eq("user_id", userId).order("uploaded_at", { ascending: false });
    return Promise.all((data ?? []).map(async (d): Promise<AdminDoc> => {
      const m = d.file_url.match(/\/documents\/(.+)$/);
      const path = d.storage_path ?? (m ? decodeURIComponent(m[1]) : null);
      let url = d.file_url;
      if (path) {
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
        if (signed?.signedUrl) url = signed.signedUrl;
      }
      return { id: d.id, applicationId: d.application_id, name: d.file_name, type: d.document_type, url, status: d.status, note: d.review_note, size: d.file_size, uploadedAt: d.uploaded_at };
    }));
  };

  // Verify or disapprove a document. The database records who reviewed it, audits it and notifies the student.
  const reviewDocument = async (doc: AdminDoc, status: "Verified" | "Disapproved" | "Pending", note?: string) => {
    setReviewingDoc(true);
    const { data: rows, error } = await supabase.rpc("review_document", { _id: doc.id, _status: status, _note: note ?? null });
    setReviewingDoc(false);
    const data = rows?.[0];
    if (error || !data) { toast.error(error?.message ?? "Could not update the document"); return false; }
    const patch = (list: AdminDoc[]) => list.map((x) => (x.id === doc.id ? { ...x, status: data.status, note: data.review_note } : x));
    setViewDocs(patch); setStudentDocs(patch);
    setAllDocs((prev) => prev.map((x) => (x.id === doc.id ? { ...x, status: data.status } : x)));
    toast.success(status === "Verified" ? `${doc.type} verified` : status === "Disapproved" ? `${doc.type} disapproved` : `${doc.type} reopened`);
    return true;
  };

  const docList = (docs: AdminDoc[], loading: boolean) => {
    if (loading) return <ul className="mt-1 space-y-2" aria-busy>{[1, 2, 3].map((i) => <li key={i}><Skeleton className="h-14 w-full" /></li>)}</ul>;
    if (docs.length === 0) return <p className="text-sm text-muted-foreground">No documents uploaded</p>;
    const tone = (st: string) => st === "Verified" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : st === "Disapproved" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200";
    return (
      <ul className="mt-1 space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
                <span className="truncate"><span className="font-medium">{d.type}</span> · {d.name}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone(d.status)}`}>{d.status}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {d.size != null && `${d.size < 1048576 ? `${Math.max(1, Math.round(d.size / 1024))} KB` : `${(d.size / 1048576).toFixed(1)} MB`} · `}
                {new Date(d.uploadedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              {can.review && <span className="flex gap-1.5">
                {d.status !== "Verified" && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={reviewingDoc} onClick={() => reviewDocument(d, "Verified")}>Verify</Button>}
                {d.status !== "Disapproved" && <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={reviewingDoc} onClick={() => { setDisapproveNote(""); setDisapproveDoc(d); }}>Disapprove</Button>}
                {d.status !== "Pending" && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={reviewingDoc} onClick={() => reviewDocument(d, "Pending")}>Reset</Button>}
              </span>}
            </div>
            {d.status === "Disapproved" && d.note && <p className="mt-1 text-xs text-destructive">Reason: {d.note}</p>}
          </li>
        ))}
      </ul>
    );
  };

  // The open application follows live data, so its status and buttons never act on a stale copy.
  useEffect(() => {
    setViewApp((v) => (v ? applications.find((a) => a.id === v.id) ?? v : v));
  }, [applications]);

  // Opening an application: reset the form and load its internal notes.
  useEffect(() => {
    if (!viewApp) { setViewDocs([]); setAppNotes([]); return; }
    // A new decision carries a new message; an earlier one (e.g. a disapproval reason) is never resent.
    setRemarks(["Pending", "Waitlisted"].includes(viewApp.status) ? "" : viewApp.notes || "");
    setAwardInput(viewApp.amount_approved != null ? String(viewApp.amount_approved) : "");
    setNewAppNote("");
    setDocsLoading(true);
    let cancelled = false;
    supabase.from("application_notes").select("*").eq("application_id", viewApp.id).order("created_at")
      .then(({ data }) => { if (!cancelled) setAppNotes(data ?? []); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewApp?.id]);

  // Where the student has pinned their house before (migration 076; empty before it runs).
  useEffect(() => {
    setPinHistory([]);
    if (!viewApp || !mapAccess) return;
    let cancelled = false;
    supabase.from("home_location_history").select("*").eq("user_id", viewApp.user_id).order("changed_at", { ascending: false }).limit(10)
      .then(({ data }) => { if (!cancelled) setPinHistory(data ?? []); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewApp?.id, viewApp?.user_id, mapAccess]);

  // Documents: loaded on open and re-read (without a loading state) when a document changes.
  useEffect(() => {
    if (!viewApp) return;
    let cancelled = false;
    loadSignedDocs(viewApp.user_id).then((docs) => { if (!cancelled) { setViewDocs(docs); setDocsLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewApp?.id, docsVersion]);

  useEffect(() => {
    if (!viewStudent) { setStudentDocs([]); return; }
    setStudentDocsLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStudent?.id]);
  useEffect(() => {
    if (!viewStudent) return;
    let cancelled = false;
    loadSignedDocs(viewStudent.id).then((docs) => { if (!cancelled) { setStudentDocs(docs); setStudentDocsLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStudent?.id, docsVersion]);

  // Today's date where the admin is (Philippine time), not UTC's, which is still yesterday until 8 AM.
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isClosed = (sch: Tables<"scholarships">) => !!sch.deadline && sch.deadline < localDate();
  // Slots and budgets are per academic year: they count that year's approvals (the current one by default).
  const currentAY = parseSettings(systemSettings).academic_year;
  const approvedCount = (schId: string, ay = currentAY) => applications.filter((a) => a.scholarship_id === schId && a.status === "Approved" && a.academic_year === ay).length;
  // Money committed to a program: approved awards for the year (the program amount where none was set, once per semester or month).
  const committedFor = (sch: Tables<"scholarships">, ay = currentAY) =>
    applications.filter((a) => a.scholarship_id === sch.id && a.status === "Approved" && a.academic_year === ay)
      .reduce((t, a) => t + yearlyAward(Number(a.amount_approved ?? sch.amount ?? 0), sch.release_schedule, sch.release_months), 0);
  // How an application's award is released, and which of its terms have no payment yet.
  const scheduleOf = (a: { scholarship_id: string | null }) => asSchedule(scholarships.find((x) => x.id === a.scholarship_id)?.release_schedule);
  const monthsOf = (a: { scholarship_id: string | null }) => asMonths(scholarships.find((x) => x.id === a.scholarship_id)?.release_months);
  const termsOf = (a: { scholarship_id: string | null }) => termsFor(scheduleOf(a), monthsOf(a));
  const awardOf = (a: { scholarship_id: string | null; amount_approved: number | null }) =>
    Number(a.amount_approved ?? scholarships.find((x) => x.id === a.scholarship_id)?.amount ?? 0);
  const paymentsOf = (appId: string) => payments.filter((p) => p.application_id === appId);
  const openTermsOf = (a: { id: string; scholarship_id: string | null; amount_approved: number | null }) =>
    openTerms(scheduleOf(a), awardOf(a), paymentsOf(a.id), monthsOf(a));
  // A term's default amount: the award (each semester or month pays it in full), but never more than
  // what's left of the year's total. The last open term gets whatever is left.
  const termDefaultAmount = (a: { id: string; scholarship_id: string | null; amount_approved: number | null }) => {
    const award = awardOf(a);
    const left = Math.round((yearlyAward(award, scheduleOf(a), monthsOf(a)) - paymentsOf(a.id).filter((p) => p.status !== "Cancelled").reduce((t, p) => t + Number(p.amount), 0)) * 100) / 100;
    const v = openTermsOf(a).length === 1 ? left : Math.min(award, left);
    return v > 0 ? v : "";
  };
  // Before a 2nd-semester payment: a verified 1st-semester grade that meets the application's minimum.
  const gradeWarningFor = (a: { user_id: string; scholarship_id: string | null; academic_year: string | null; is_renewal: boolean }, term: string | null) => {
    if (term !== "2nd Semester") return null;
    const s = parseSettings(systemSettings);
    const program = scholarships.find((x) => x.id === a.scholarship_id);
    const min = a.is_renewal && s.renewal_enabled ? s.renewal_min_grade : Math.max(Number(program?.min_grade ?? 0), s.min_grade_requirement);
    return secondSemesterGradeWarning(profiles.find((x) => x.id === a.user_id), a.academic_year, min);
  };
  // The first open term of an application, preferring the semester set in Settings.
  const defaultTermFor = (appId: string): PaymentTerm | null => {
    const a = applications.find((x) => x.id === appId);
    if (!a) return null;
    const open = openTermsOf(a);
    const sem = parseSettings(systemSettings).current_semester as PaymentTerm;
    return open.includes(sem) ? sem : open[0] ?? termsOf(a)[0];
  };
  // Periods the bulk dialog offers: both semesters, then every month a monthly program pays.
  const bulkTerms: PaymentTerm[] = [...termsFor("semester"), ...termsFor("monthly", 12)];
  // Scholars in the current academic year whose program pays by this kind of term and who still need its payment.
  const bulkCandidates = (term: PaymentTerm) => applications
    .filter((a) => a.status === "Approved" && a.academic_year === currentAY && scheduleOf(a) === (isMonthTerm(term) ? "monthly" : "semester") && openTermsOf(a).includes(term))
    .map((a) => ({ app: a, amount: Number(termDefaultAmount(a) || 0), warning: gradeWarningFor(a, term) }))
    .filter((c) => c.amount > 0);
  const scheduleBulk = async () => {
    const picked = bulkCandidates(bulkTerm).filter((c) => bulkPicked.has(c.app.id));
    if (picked.length === 0) return;
    const method = parseSettings(systemSettings).default_payment_method;
    const rows = picked.map((c) => ({
      application_id: c.app.id, user_id: c.app.user_id, amount: c.amount, method, term: bulkTerm,
      scheduled_date: bulkDate || null, status: "Pending",
    }));
    setBulkPayBusy(true);
    const { error } = await supabase.from("payments").insert(rows);
    setBulkPayBusy(false);
    if (error) { toast.error("Couldn't schedule the payments", { description: error.message }); return; }
    toast.success(`Scheduled ${rows.length} ${bulkTerm} payment${rows.length === 1 ? "" : "s"}`);
    setBulkOpen(false); loadData();
  };
  const applicantCount = (schId: string) => applications.filter((a) => a.scholarship_id === schId).length;
  const filteredScholarships = scholarships.filter((sch) => {
    const q = schSearch.trim().toLowerCase();
    if (q && !`${sch.name} ${sch.eligibility || ""}`.toLowerCase().includes(q)) return false;
    if (schFilter === "active") return sch.is_active && !isClosed(sch);
    if (schFilter === "inactive") return !sch.is_active;
    if (schFilter === "closed") return isClosed(sch);
    return true;
  });

  // Row-level security skips rows the account may not change without an error, so an update that
  // matched nothing has to be caught by counting the rows it returned.
  const NOT_SAVED = "Nothing was changed: your account may not edit this record, or it was deleted. Refresh and try again.";

  const saveScholarship = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (savingSch) return;
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? "");
    const num = (k: string) => (text(k).trim() === "" ? 0 : Number(text(k)));
    const parsed = scholarshipSchema.safeParse({
      name: text("name"), description: text("description"), eligibility: text("eligibility"),
      amount: num("amount"), total_budget: num("total_budget"), slots: num("slots"),
      open_date: text("open_date") || null, deadline: text("deadline") || null,
      min_grade: text("min_grade").trim() === "" ? null : Number(text("min_grade")),
      year_levels: schYearLevels, municipality: HOME_MUNICIPALITY, barangays: schBarangays, is_active: schActive,
      release_schedule: text("release_schedule") || "yearly",
      release_months: text("release_months").trim() === "" ? 10 : Number(text("release_months")),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check the form"); return; }
    const editing = schDialog && schDialog !== "new" ? schDialog : null;
    // Office staff's programs always belong to their office (the database sets it); the rest pick one.
    const payload = { ...parsed.data, ...(fd.has("office") ? { office: text("office") || null } : {}) };

    const today = localDate();
    if (payload.deadline && payload.deadline < today && (!editing || payload.deadline !== editing.deadline)) {
      toast.error("The deadline cannot be in the past"); return;
    }
    if (editing) {
      const approved = approvedCount(editing.id);
      if (payload.slots > 0 && payload.slots < approved) { toast.error(`Slots cannot be lower than the ${approved} scholar(s) already approved`); return; }
      const committed = committedFor(editing);
      if (payload.total_budget > 0 && payload.total_budget < committed) { toast.error(`The budget cannot be lower than the ${formatPHP(committed)} already committed`); return; }
    }

    // A schedule the database doesn't know yet means its migration hasn't been run.
    const saveError = (error: { message: string }) => error.message.includes("scholarships_release_schedule_check")
      ? toast.error("The database doesn't support this release schedule yet", { description: "Run migration 069_one_time_release.sql in the Supabase SQL Editor, then save again." })
      : toast.error(error.message);
    setSavingSch(true);
    try {
      if (editing) {
        const { data: rows, error } = await supabase.from("scholarships").update(payload).eq("id", editing.id).select("id");
        if (error) { saveError(error); return; }
        if (!rows?.length) { toast.error(NOT_SAVED); loadData(true); return; }
        toast.success("Scholarship updated");
      } else {
        const { error } = await supabase.from("scholarships").insert(payload);
        if (error) { saveError(error); return; }
        toast.success("Scholarship added");
      }
      setSchDialog(null); loadData();
    } finally {
      setSavingSch(false);
    }
  };

  // Start next year's program from an existing one: same rules, disabled and undated until reviewed.
  const duplicateScholarship = async (sch: Tables<"scholarships">) => {
    const copy = {
      name: `${sch.name} (copy)`, description: sch.description, eligibility: sch.eligibility,
      amount: sch.amount, total_budget: sch.total_budget, slots: sch.slots, min_grade: sch.min_grade,
      year_levels: sch.year_levels, municipality: sch.municipality, barangays: sch.barangays, open_date: null, deadline: null, is_active: false,
      release_schedule: sch.release_schedule, release_months: sch.release_months,
      ...("office" in sch ? { office: sch.office } : {}),
    };
    const { error } = await supabase.from("scholarships").insert(copy);
    if (error) { toast.error(error.message); return; }
    toast.success(`Created "${copy.name}"`, { description: "It's disabled and has no dates yet. Edit it to set them and enable it." });
    loadData();
  };

  const toggleScholarship = async (sch: Tables<"scholarships">) => {
    const { data: rows, error } = await supabase.from("scholarships").update({ is_active: !sch.is_active }).eq("id", sch.id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!rows?.length) { toast.error(NOT_SAVED); loadData(true); return; }
    toast.success(`${sch.name} ${sch.is_active ? "disabled" : "enabled"}`); loadData();
  };

  // Typing the name to confirm ignores case and extra spaces, so a name like "SBSJ  Merit " still matches.
  const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
  const confirmDeleteScholarship = async () => {
    if (!deleteSch || deletingSch) return;
    setDeletingSch(true);
    // Removes the program with its applications, documents, notes, payments and notifications in one
    // transaction, writes the audit entry, and returns the uploaded files nothing uses any more.
    const { data, error } = await supabase.rpc("delete_scholarship_cascade", { _scholarship_id: deleteSch.id });
    if (error) {
      setDeletingSch(false);
      toast.error("Could not delete", {
        description: error.code === "PGRST202" ? "The database is missing delete_scholarship_cascade. Run migrations 059 and 079 in Supabase." : error.message,
      });
      return;
    }
    const removed = (data ?? {}) as { applications?: number; payments?: number; paths?: string[] };
    // Before 079 the function neither wrote the audit entry nor returned the files.
    if (!removed.paths) await logAudit("delete_scholarship", "scholarships", deleteSch.id, { name: deleteSch.name, applications: removed.applications ?? 0, payments: removed.payments ?? 0 }, null);
    let filesLeft = 0;
    for (let i = 0; i < (removed.paths?.length ?? 0); i += 100) {
      const chunk = removed.paths!.slice(i, i + 100);
      const { error: rmError } = await supabase.storage.from("documents").remove(chunk);
      if (rmError) filesLeft += chunk.length;
    }
    setDeletingSch(false);
    toast.success("Scholarship deleted", removed.applications ? { description: `Also removed ${removed.applications} application${removed.applications === 1 ? "" : "s"} and ${removed.payments ?? 0} payment${removed.payments === 1 ? "" : "s"}.` } : undefined);
    if (filesLeft) toast.warning(`${filesLeft} uploaded file${filesLeft === 1 ? " was" : "s were"} not removed from storage`, { description: "The records are gone; the files can be cleared from the Supabase Storage dashboard." });
    setDeleteSch(null); setDeleteSchText(""); loadData();
  };

  // ── Disbursement management ──
  const PAY_PAGE_SIZE = 10;
  const payStudent = (p: Tables<"payments">) => {
    const prof = profiles.find((x) => x.id === p.user_id);
    return prof ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim() || prof.email || "Unknown" : "Unknown";
  };
  const payProgram = (p: Tables<"payments">) => applications.find((a) => a.id === p.application_id)?.scholarships?.name || "—";
  const filteredPayments = payments.filter((p) => {
    if (payFilter === "issues") { if (!openIssueFor(p.id)) return false; }
    else if (payFilter === "receipts") { if (!(p.student_receipt_at && p.receipt_review_status === "Pending")) return false; }
    else if (payFilter !== "all" && p.status !== payFilter) return false;
    const q = paySearch.trim().toLowerCase();
    return !q || `${payStudent(p)} ${payProgram(p)} ${p.reference || ""}`.toLowerCase().includes(q);
  });
  const payPages = Math.max(1, Math.ceil(filteredPayments.length / PAY_PAGE_SIZE));
  const currentPayPage = Math.min(payPage, payPages);
  const pagedPayments = filteredPayments.slice((currentPayPage - 1) * PAY_PAGE_SIZE, currentPayPage * PAY_PAGE_SIZE);

  const openNewPayment = (applicationId = "") => {
    setPayAppId(applicationId); setPayTerm(defaultTermFor(applicationId)); setPayMethod(parseSettings(systemSettings).default_payment_method); setPayDialog("new");
  };

  const savePayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (savingPay) return;
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount") || 0);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter an amount greater than 0"); return; }
    const fields = {
      amount,
      method: payMethod,
      reference: String(fd.get("reference") || "").trim() || null,
      scheduled_date: String(fd.get("scheduled_date") || "") || null,
      notes: String(fd.get("notes") || "").trim() || null,
      ...(payTerm ? { term: payTerm } : {}),
    };
    setSavingPay(true);
    try {
      if (payDialog && payDialog !== "new") {
        const { data: rows, error } = await supabase.from("payments").update(fields).eq("id", payDialog.id).select("id");
        if (error) { toast.error(error.message); return; }
        if (!rows?.length) { toast.error(NOT_SAVED); loadData(true); return; }
        toast.success("Payment updated");
      } else {
        const app = applications.find((a) => a.id === payAppId);
        if (!app) { toast.error("Select an approved applicant"); return; }
        const { error } = await supabase.from("payments").insert({ ...fields, application_id: app.id, user_id: app.user_id, status: "Pending" });
        if (error) { toast.error(error.message); return; }
        toast.success("Payment scheduled");
      }
      setPayDialog(null); loadData();
    } finally {
      setSavingPay(false);
    }
  };

  const setPaymentStatus = async (p: Tables<"payments">, status: "Processing" | "Cancelled", reason?: string) => {
    if (savingPay) return false;
    const cancel_reason = status === "Cancelled" ? reason?.trim() || null : null;
    setSavingPay(true);
    // Only from a status it can still leave, so a stale screen can't reopen a cancelled payment.
    const { data: rows, error } = await supabase.from("payments").update(status === "Cancelled" ? { status, cancel_reason } : { status })
      .eq("id", p.id).in("status", status === "Cancelled" ? ["Pending", "Processing"] : ["Pending"]).select("id");
    setSavingPay(false);
    if (error) { toast.error(error.message); return false; }
    if (!rows?.length) { toast.error("This payment was changed elsewhere. The list has been refreshed."); loadData(true); return false; }
    toast.success(status === "Cancelled" ? "Payment cancelled" : "Marked as processing");
    loadData();
    return true;
  };

  const openStoredFile = async (path: string | null, missingMsg: string) => {
    if (!path) { toast.error(missingMsg); return; }
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { win?.close(); toast.error("Could not open receipt", { description: error?.message }); return; }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };
  const viewReceipt = (p: Tables<"payments">) => openStoredFile(p.receipt_path, "No receipt on file for this payment");
  // Compare reference numbers the way people type them: case, spaces and dashes don't matter.
  const refKey = (r: string) => r.toUpperCase().replace(/[\s\-_./#]/g, "");
  const viewStudentReceipt = (p: Tables<"payments">) => openStoredFile(p.student_receipt_path, "The student hasn't submitted a receipt");
  // Office + student copy of the acknowledgment slip, for the student to sign when the money is released.
  const printSlip = (p: Tables<"payments">, method = p.method, reference = p.reference) => {
    const receiptNo = receiptNos[p.id];
    if (!receiptNo) { toast.error("This payment has no receipt number"); return; }
    printReceiptSlip({ receiptNo, studentName: payStudent(p), program: payProgram(p), period: termLabel(p.term, p.academic_year) || null, amount: p.amount, method, reference });
  };

  // Verify or disapprove a grade a student submitted. Verifying replaces their average grade; the student is notified.
  const reviewGrade = async (g: Tables<"grade_updates">, status: "Verified" | "Disapproved", note?: string) => {
    setPayBusy(true);
    const { error } = await supabase.rpc("review_grade_update", { _id: g.id, _status: status, _note: note ?? null });
    setPayBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(status === "Verified" ? "Grade verified" : "Grade disapproved — the student was asked to resubmit");
    if (status === "Verified") {
      setViewStudent((v) => (v && v.id === g.user_id ? { ...v, average_grade: g.grade, grade_verified_at: new Date().toISOString(), grade_term: g.term } : v));
    }
    loadData();
    return true;
  };

  const respondToRequest = async () => {
    if (!handleReq) return;
    setPayBusy(true);
    const { error } = await supabase.rpc("handle_data_request", { _id: handleReq.id, _status: "Declined", _response: reqResponse });
    setPayBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Request declined");
    setHandleReq(null); setReqResponse("");
    loadData();
  };

  // Accept or disapprove the receipt a student submitted. The student is notified by the database.
  const reviewReceipt = async (p: Tables<"payments">, status: "Accepted" | "Disapproved", note?: string) => {
    setPayBusy(true);
    const { error } = await supabase.rpc("review_student_receipt", { _payment_id: p.id, _status: status, _note: note ?? null });
    setPayBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(status === "Accepted" ? "Receipt accepted" : "Receipt disapproved — the student was asked to resubmit");
    loadData();
    return true;
  };

  const resolveIssue = async (issue: Tables<"payment_issues">) => {
    setPayBusy(true);
    const { error } = await supabase.rpc("resolve_payment_issue", { _issue_id: issue.id, _response: issueResponse });
    setPayBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Response sent to the student");
    setIssueResponse("");
    loadData();
  };
  const openIssueFor = (paymentId: string) => payIssues.find((i) => i.payment_id === paymentId && i.status === "Open");

  const disbPay = payments.find((pm) => pm.id === disbPaymentId);
  const disbLocked = !!disbPay?.preferred_method; // student chose the method; it is final

  const confirmDisbursement = async () => {
    if (!disbReceipt) return;
    const payment = payments.find((pm) => pm.id === disbPaymentId);
    if (!payment) return;
    const moa = moaBlocker(payment.application_id);
    if (moa) { toast.error("Can't release this payment yet", { description: moa }); return; }
    const maxMb = parseSettings(systemSettings).max_upload_mb;
    if (disbReceipt.size > maxMb * 1024 * 1024) { toast.error(`Receipt is too large (max ${maxMb} MB)`); return; }
    setDisbLoading(true);
    try {
      const safeName = disbReceipt.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `receipts/${payment.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(path, disbReceipt);
      if (uploadError) { toast.error("Receipt upload failed", { description: uploadError.message }); return; }
      const update = { status: "Disbursed", method: disbMethod, reference: disbRef.trim() || null, receipt_path: path, disbursed_at: new Date().toISOString() };
      const { data: rows, error } = await supabase.from("payments").update(update).eq("id", payment.id).neq("status", "Disbursed").select("id");
      if (error || !rows?.length) {
        await supabase.storage.from("documents").remove([path]);
        toast.error(error?.message ?? "This payment was already disbursed or changed elsewhere. The list has been refreshed.");
        if (!error) loadData(true);
        return;
      }
      toast.success("Payment marked as disbursed");
      setDisbDialog(false);
      loadData();
    } catch {
      toast.error("Failed to process disbursement");
    } finally {
      setDisbLoading(false);
    }
  };

  // ── Audit log browsing ──
  const AUDIT_PAGE_SIZE = 15;
  // Choices come from the recent entries; a chosen one stays listed even if it's only in older history.
  const auditActions = useMemo(() => [...new Set([...auditLogs.map((l) => l.action), ...(auditAction !== "all" ? [auditAction] : [])])].sort(), [auditLogs, auditAction]);
  const auditEntities = useMemo(() => [...new Set([...auditLogs.map((l) => l.entity_type), "system_settings", ...(auditEntity !== "all" ? [auditEntity] : [])])].sort(), [auditLogs, auditEntity]);
  // Searched and paged in the database, so the whole history is reachable, not just the entries loaded above.
  const auditQuery = useAuditLogQuery(supabase,
    { search: auditSearch, action: auditAction, entity: auditEntity, user: auditUser, from: auditFrom, to: auditTo },
    auditPage, AUDIT_PAGE_SIZE, activeSection === "audit-logs");
  const auditPages = Math.max(1, Math.ceil(auditQuery.count / AUDIT_PAGE_SIZE));
  const currentAuditPage = Math.min(auditPage, auditPages);
  const pagedLogs = auditQuery.rows;
  const [exportingAudit, setExportingAudit] = useState(false);
  const exportAudit = async (kind: "pdf" | "xlsx") => {
    setExportingAudit(true);
    try {
      const { rows, truncated } = await auditQuery.fetchAll();
      const def: ReportDef = {
        title: "Audit Log", count: rows.length, countLabel: "entries",
        filters: [truncated ? `First ${rows.length.toLocaleString()} of ${auditQuery.count.toLocaleString()} matching entries` : `${rows.length.toLocaleString()} matching entries`, ...(auditSearch.trim() ? [`Search: ${auditSearch.trim()}`] : []), ...(auditAction !== "all" ? [`Action: ${auditAction}`] : []), ...(auditEntity !== "all" ? [`Entity: ${auditEntity}`] : []), ...(auditUser !== "all" ? [`Staff: ${staff.find((m) => m.id === auditUser)?.name ?? auditUser}`] : []), ...(auditFrom || auditTo ? [`Dates: ${auditFrom || "…"} to ${auditTo || "…"}`] : [])],
        sections: [logsToSection(rows, reportData())],
      };
      await exportDef(def, "audit-log", kind, kind === "pdf");
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExportingAudit(false);
    }
  };

  // Account deletion requests waiting for the Mayor Office, oldest first. The student may not be a scholar,
  // so these are listed on their own rather than only as a badge in the Students table.
  const pendingDeletions = dataReqs.filter((r) => r.status === "Pending")
    .sort((x, y) => x.created_at.localeCompare(y.created_at))
    .map((r) => ({ req: r, profile: profiles.find((p) => p.id === r.user_id) ?? null }));

  const STUDENT_PAGE_SIZE = 10;
  // The Students section lists scholars only: accounts with at least one approved application.
  // Everyone else is reached through Applicants.
  // A student's payments, newest first; the "current" one is the newest that isn't cancelled.
  const studentPayments = (userId: string) => payments
    .filter((pm) => pm.user_id === userId)
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  const currentPayment = (userId: string) => {
    const list = studentPayments(userId);
    return list.find((pm) => pm.status !== "Cancelled") ?? list[0];
  };

  // A scholar's approved applications (newest first) and the award for each (for the year: every semester or month).
  const approvedApps = (userId: string) => applications.filter((a) => a.user_id === userId && a.status === "Approved");
  const appAward = (a: typeof applications[0]) => {
    const sch = scholarships.find((x) => x.id === a.scholarship_id);
    return yearlyAward(Number(a.amount_approved ?? sch?.amount ?? 0), sch?.release_schedule, sch?.release_months);
  };
  const disbursedTotal = (userId: string) => payments
    .filter((pm) => pm.user_id === userId && pm.status === "Disbursed")
    .reduce((t, pm) => t + Number(pm.amount), 0);

  const scholars = useMemo(() => {
    const ids = new Set(applications.filter((a) => a.status === "Approved").map((a) => a.user_id));
    return profiles.filter((p) => ids.has(p.id));
  }, [profiles, applications]);
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const list = scholars.filter((p) => {
      if (studentFilter === "active" && !p.is_active) return false;
      if (studentFilter === "inactive" && p.is_active) return false;
      if (studentProgram !== "all" && !approvedApps(p.id).some((a) => a.scholarship_id === studentProgram)) return false;
      if (studentDisb !== "all") {
        const pay = currentPayment(p.id);
        if (studentDisb === "none" ? !!pay : pay?.status !== studentDisb) return false;
      }
      if (!q) return true;
      return [`${p.first_name} ${p.last_name}`, p.email, p.school_name, p.course]
        .some((f) => (f || "").toLowerCase().includes(q));
    });
    return list.sort((x, y) => studentSort === "grade"
      ? (y.average_grade ?? -1) - (x.average_grade ?? -1)
      : `${x.last_name} ${x.first_name}`.localeCompare(`${y.last_name} ${y.first_name}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scholars, studentSearch, studentFilter, studentSort, studentProgram, studentDisb, payments]);
  const studentPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENT_PAGE_SIZE));
  const pagedStudents = filteredStudents.slice((studentPage - 1) * STUDENT_PAGE_SIZE, studentPage * STUDENT_PAGE_SIZE);

  const toggleStudentActive = async (p: Tables<"profiles">) => {
    const next = !p.is_active;
    // The server also blocks (or restores) their sign-in and ends their sessions, and writes the audit entry.
    const res = await fetch("/api/admin/students", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_active", userId: p.id, active: next }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) { toast.error((body?.error as string) ?? "Request failed"); if (res) loadData(); return; }
    toast.success(`${p.first_name || "Student"} ${next ? "activated" : "deactivated"}`);
    setViewStudent((cur) => (cur && cur.id === p.id ? { ...cur, is_active: next } : cur));
    loadData();
  };

  const selectEditDisbPayment = (pm: Tables<"payments"> | undefined) => {
    setEditDisbPayId(pm?.id ?? "");
    setEditDisbRef(pm?.reference ?? "");
    setEditDisbStatus(pm?.status ?? "Pending");
    setEditDisbReason("");
  };
  const openEditDisb = (p: Tables<"profiles">) => { selectEditDisbPayment(currentPayment(p.id)); setEditDisb(p); };

  const saveEditDisb = async () => {
    const pm = payments.find((x) => x.id === editDisbPayId);
    if (!pm) return;
    const reference = editDisbRef.trim() || null;
    // Marking disbursed needs a receipt upload, so hand off to the disbursement dialog.
    if (editDisbStatus === "Disbursed") {
      const moa = moaBlocker(pm.application_id);
      if (moa) { toast.error("Can't release this payment yet", { description: moa }); return; }
      setDisbPaymentId(pm.id);
      setDisbMethod((pm.preferred_method ?? pm.method) === "Cheque" ? "Cheque" : "Cash");
      setDisbRef(reference ?? "");
      setDisbReceipt(null);
      setEditDisb(null);
      setDisbDialog(true);
      return;
    }
    const update: Partial<Tables<"payments">> = { reference };
    if (editDisbStatus !== pm.status) update.status = editDisbStatus;
    if (editDisbStatus === "Cancelled" && pm.status !== "Cancelled") update.cancel_reason = editDisbReason.trim() || null;
    setPayBusy(true);
    const { data: rows, error } = await supabase.from("payments").update(update).eq("id", pm.id).select("id");
    setPayBusy(false);
    if (error) { toast.error(error.message); return; }
    if (!rows?.length) { toast.error(NOT_SAVED); loadData(true); return; }
    toast.success("Disbursement updated");
    setEditDisb(null);
    loadData();
  };

  const exportStudents = async () => {
    const XLSX = await import("xlsx");
    const rows = filteredStudents.map((p) => {
      const apps = approvedApps(p.id);
      const pay = currentPayment(p.id);
      return {
        Name: `${p.first_name || ""} ${p.middle_name || ""} ${p.last_name || ""}`.replace(/\s+/g, " ").trim(),
        Email: p.email || "—",
        Phone: p.phone || "—",
        Address: [p.street_address, p.barangay, p.municipality, p.province, p.zip_code].filter(Boolean).join(", ") || "—",
        Guardian: p.guardian_name || "—",
        "Guardian Phone": p.guardian_phone || "—",
        School: p.school_name || "—",
        Course: p.course || "—",
        "Year Level": p.year_level || "—",
        Grade: p.average_grade ?? "—",
        Program: apps.map((a) => a.scholarships?.name || "—").join(", ") || "—",
        "Award (PHP)": apps.reduce((t, a) => t + appAward(a), 0),
        "Reference No.": pay?.reference || "—",
        "Disbursement Status": pay?.status || "No payment",
        "Total Disbursed (PHP)": disbursedTotal(p.id),
        "Approved / Total": `${apps.length} / ${applications.filter((a) => a.user_id === p.id).length}`,
        Account: p.is_active ? "Active" : "Inactive",
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Students");
    XLSX.writeFile(wb, `students${fileOffice}.xlsx`);
    toast.success("Excel downloaded");
  };

  // MSWDO home visits (migration 071): staff schedule one, the student is notified, and approval needs it done.
  const saveHomeVisit = async (a: AppRow, clear = false) => {
    const at = clear ? null : visitAt ? new Date(visitAt).toISOString() : null;
    if (!clear && !at) { toast.error("Pick the visit date and time"); return; }
    setVisitBusy(true);
    const { error } = await supabase.rpc("set_home_visit", { _application_id: a.id, _at: at, _note: visitNote.trim() || null });
    setVisitBusy(false);
    if (error) { toast.error("Couldn't save the home visit", { description: error.message }); return; }
    toast.success(clear ? "Home visit cleared" : "Home visit scheduled — the student was notified");
    setViewApp({ ...a, home_visit_at: at, home_visit_note: at ? visitNote.trim() || null : null, home_visit_done_at: null });
    loadData(true);
  };
  const markVisitDone = async (a: AppRow, done: boolean) => {
    setVisitBusy(true);
    const { error } = await supabase.rpc("mark_home_visit_done", { _application_id: a.id, _done: done });
    setVisitBusy(false);
    if (error) { toast.error("Couldn't update the home visit", { description: error.message }); return; }
    toast.success(done ? "Home visit marked done" : "Home visit marked not done");
    setViewApp({ ...a, home_visit_done_at: done ? new Date().toISOString() : null });
    loadData(true);
  };

  // Each program (office) decides on its own: the student must pass that program's requirements and
  // have every required document verified. Each application has its own documents (migration 073).
  const requirementChecks = (a: { id: string; user_id: string; academic_year: string | null; scholarship_id: string | null; is_renewal: boolean; home_visit_at?: string | null; home_visit_done_at?: string | null }): RequirementCheck[] => {
    const settings = parseSettings(systemSettings);
    const program = scholarships.find((sc) => sc.id === a.scholarship_id);
    const profile = profiles.find((pr) => pr.id === a.user_id);
    // Each application has its own letter of intent. Applications from before letters were asked for have none.
    const letter = allDocs.filter((d) => d.application_id === a.id && d.document_type === LETTER_OF_INTENT)
      .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
    const letterCheck: RequirementCheck[] = letter
      ? [{ key: "doc-letter", label: "Letter of intent verified", ok: letter.status === "Verified", detail: letter.status }]
      : [];
    // The program's office may ask for its own documents (Barangay Affairs and MSWDO do), and MSWDO also
    // for follow-up documents, the house pinned on a map and a home visit (migration 071).
    const docs = approvalDocuments(program?.office, settings.required_documents).map((type): RequirementCheck => {
      // Latest copy wins.
      const latest = allDocs
        .filter((d) => d.application_id === a.id && d.document_type === type)
        .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
      return { key: `doc-${type}`, label: `${type} verified`, ok: latest?.status === "Verified", detail: latest ? latest.status : "Missing" };
    });
    const rules = program ? programChecks(program, profile, {
      globalMinGrade: settings.min_grade_requirement, renewalMinGrade: settings.renewal_min_grade,
      renewalEnabled: settings.renewal_enabled, isRenewal: a.is_renewal,
    }) : [];
    const office = program?.office;
    const steps: RequirementCheck[] = [
      ...(needsHousePin(office) ? [{ key: "house-pin", label: "House pinned on the map", ok: profile?.home_lat != null, detail: profile?.home_lat != null ? "Saved" : "Not yet" }] : []),
      ...(needsHomeVisit(office) ? [{
        key: "home-visit", label: "Home visit done", ok: !!a.home_visit_done_at,
        detail: a.home_visit_done_at ? "Done" : a.home_visit_at ? `Scheduled ${new Date(a.home_visit_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}` : "Not scheduled",
      }] : []),
    ];
    return [...rules, ...letterCheck, ...docs, ...steps];
  };

  // MSWDO payouts need the signed MOA verified first (the database enforces it). null = it can be released.
  const moaBlocker = (applicationId: string | null): string | null => {
    const app = applications.find((x) => x.id === applicationId);
    if (!app || !needsMoa(scholarships.find((sc) => sc.id === app.scholarship_id)?.office)) return null;
    const moa = allDocs.filter((d) => d.application_id === app.id && d.document_type === MOA)
      .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
    if (moa?.status === "Verified") return null;
    return `Verify the student's signed MOA agreement letter first (${moa ? moa.status.toLowerCase() : "not uploaded yet"}).`;
  };

  // Slots and budget left in the application's program for its academic year. The database enforces the same limits.
  const capacityFor = (a: AppRow, award?: number) => {
    const sch = scholarships.find((x) => x.id === a.scholarship_id);
    if (!sch) return null;
    const approved = approvedCount(sch.id, a.academic_year ?? currentAY);
    const committed = committedFor(sch, a.academic_year ?? currentAY);
    const amount = yearlyAward(award ?? Number(a.amount_approved ?? sch.amount ?? 0), sch.release_schedule, sch.release_months);
    const slotsFull = sch.slots > 0 && approved >= sch.slots;
    const overBudget = Number(sch.total_budget) > 0 && committed + amount > Number(sch.total_budget);
    return { sch, approved, committed, amount, slotsFull, overBudget };
  };
  // Why an application can't be approved yet (null = it can). The database enforces the same rules.
  const approveBlocker = (a: AppRow, award?: number): string | null => {
    const failed = requirementChecks(a).filter((c) => !c.ok);
    if (failed.length) return `Requirements not met: ${failed.map((c) => `${c.label} (${c.detail.toLowerCase()})`).join(", ")}`;
    const cap = capacityFor(a, award);
    if (cap?.slotsFull) return `All ${cap.sch.slots} slots for ${cap.sch.name} are filled`;
    if (cap?.overBudget) return `This would exceed the budget for ${cap.sch.name} (${formatPHP(cap.committed)} of ${formatPHP(Number(cap.sch.total_budget))} committed)`;
    return null;
  };
  type AppRow = typeof applications[number];
  type AppDecision = "Approved" | "Disapproved" | "Waitlisted" | "Pending";
  // The statuses each decision may be made from. The update only matches a row still in one of them,
  // so a decision made on a stale screen (another admin decided, or the student withdrew) changes nothing.
  const DECIDE_FROM: Record<AppDecision, string[]> = {
    Approved: ["Pending", "Waitlisted"],
    Disapproved: ["Pending", "Waitlisted"],
    Waitlisted: ["Pending"],
    Pending: ["Disapproved", "Waitlisted", "Approved"],
  };
  // A live (non-cancelled) payment ties an approval down: it can't be revoked until it's cancelled.
  const hasLivePayment = (appId: string) => payments.some((p) => p.application_id === appId && p.status !== "Cancelled");
  const hasDisbursed = (appId: string) => payments.some((p) => p.application_id === appId && p.status === "Disbursed");

  // Makes the decision without any toasts, so bulk actions can summarise. `note` is the message sent to
  // the student with this decision; each decision has its own, so an earlier one is never resent.
  const runDecision = async (a: AppRow, status: AppDecision, note?: string | null, award?: number | null): Promise<string | null> => {
    if (status === "Approved") {
      const blocker = approveBlocker(a, award ?? undefined);
      if (blocker) return blocker;
    }
    const update: { status: AppDecision; notes: string | null; amount_approved?: number } = { status, notes: note?.trim() || null };
    if (status === "Approved" && award != null) update.amount_approved = award;
    const { data, error } = await supabase.from("applications").update(update)
      .eq("id", a.id).in("status", DECIDE_FROM[status]).select("id");
    if (error) return error.message;
    if (!data?.length) {
      silentRefreshAdmin();
      return "This application was changed elsewhere (another reviewer, or the student withdrew it). The list has been refreshed.";
    }
    // The database notifies the student (migrations 031 and 041) and writes the audit entry (080).
    return null;
  };
  const decideApplication = async (a: AppRow, status: AppDecision, note?: string | null, award?: number | null) => {
    const problem = await runDecision(a, status, note, award);
    if (problem) {
      toast.error(status === "Approved" ? "Couldn't approve" : "Couldn't update the application", { description: problem });
      return false;
    }
    return true;
  };

  const bulkDecide = async (status: "Approved" | "Waitlisted" | "Disapproved", note?: string) => {
    const targets = applications.filter((a) => selectedApps.has(a.id) && DECIDE_FROM[status].includes(a.status));
    const skipped = selectedApps.size - targets.length;
    if (!targets.length) { toast.error("None of the selected applications can be changed that way"); return false; }
    setBulkBusy(true);
    const failures: string[] = [];
    // One at a time: each approval uses up a slot / budget that the next one is checked against.
    for (const a of targets) {
      const problem = await runDecision(a, status, note);
      if (problem) failures.push(`${personName(a.profiles)}: ${problem}`);
    }
    setBulkBusy(false);
    const done = targets.length - failures.length;
    const verb = { Approved: "approved", Waitlisted: "waitlisted", Disapproved: "disapproved" }[status];
    const summary = `${done} ${verb}${failures.length ? `, ${failures.length} failed` : ""}${skipped ? `, ${skipped} skipped (status didn't allow it)` : ""}`;
    if (failures.length) toast.warning(summary, { description: failures.slice(0, 3).join("\n") + (failures.length > 3 ? `\n…and ${failures.length - 3} more` : "") });
    else toast.success(summary);
    setSelectedApps(new Set());
    loadData(true);
    return true;
  };

  const saveAward = async (a: AppRow) => {
    const amount = Number(awardInput);
    if (awardInput.trim() === "" || !Number.isFinite(amount) || amount <= 0) { toast.error("Enter an award greater than 0"); return; }
    if (amount === Number(a.amount_approved)) { toast.info("No changes to save"); return; }
    const { data, error } = await supabase.from("applications").update({ amount_approved: amount })
      .eq("id", a.id).eq("status", "Approved").select("id");
    if (error) { toast.error("Couldn't update the award", { description: error.message }); return; }
    if (!data?.length) { toast.error("This application is no longer approved"); silentRefreshAdmin(); return; }
    toast.success("Award updated — the student was notified");
    loadData(true);
  };

  const addAppNote = async (a: AppRow) => {
    const body = newAppNote.trim();
    if (!body) return;
    setSavingAppNote(true);
    const { data, error } = await supabase.from("application_notes")
      .insert({ application_id: a.id, author_id: adminUserId, author_email: adminEmail, body }).select().single();
    setSavingAppNote(false);
    if (error || !data) { toast.error("Couldn't add the note", { description: error?.message }); return; }
    setAppNotes((prev) => [...prev, data]);
    setNewAppNote("");
  };
  const deleteAppNote = async (n: Tables<"application_notes">) => {
    const { data: rows, error } = await supabase.from("application_notes").delete().eq("id", n.id).select("id");
    if (error || !rows?.length) { toast.error("Couldn't delete the note", { description: error?.message ?? "Only the staff member who wrote it can delete it." }); return; }
    setAppNotes((prev) => prev.filter((x) => x.id !== n.id));
  };

  // Documents that count for an application: the ones filed with it (migration 073).
  const countsForApp = (a: AppRow) => (d: AdminDoc) => d.applicationId === a.id;
  const logAudit = async (action: string, entityType: string, entityId?: string, prev?: Json | null, next?: Json | null) => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    const { error } = await supabase.from("audit_logs").insert({
      user_id: user?.id, user_email: user?.email || adminEmail,
      action, entity_type: entityType, entity_id: entityId,
      previous_value: prev ?? null,
      new_value: next ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 250) : null,
    });
    if (error) {
      console.error("Audit log write failed", error);
      toast.error("Action saved, but the audit log entry failed", { description: error.message });
    }
  };

  const enabledMethods = parseSettings(systemSettings).payment_methods;
  const defaultScheduledDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + parseSettings(systemSettings).default_payment_lead_days);
    return localDate(d);
  })();
  // Keep the selected methods valid when a method gets turned off in Settings.
  useEffect(() => {
    if (!enabledMethods.includes(payMethod)) setPayMethod(enabledMethods[0]);
    if (!enabledMethods.includes(disbMethod)) setDisbMethod(enabledMethods[0]);
  }, [systemSettings, payDialog, disbDialog]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSettings = async (changes: Partial<AppSettings>, action: "update_setting" | "reset_settings" = "update_setting") => {
    const prev = parseSettings(systemSettings) as unknown as Record<string, Json>;
    const changed = Object.entries(changes).filter(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v));
    if (!changed.length) { toast.info("No changes to save"); return true; }

    // All changed keys in one transaction, audited by the database (migration 080): if one is refused, none are saved.
    const { error } = await supabase.rpc("save_settings", { _changes: Object.fromEntries(changed) as Json, _reset: action === "reset_settings" });
    const failed = error ? (error.code === "PGRST202" ? "The database is missing save_settings. Run migration 080 in Supabase." : error.message) : null;

    const [settingsRes, logsRes] = await Promise.all([
      supabase.from("system_settings").select("*"),
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    if (settingsRes.data) setSystemSettings(settingsRes.data);
    if (logsRes.data) setAuditLogs(logsRes.data);

    if (failed) { toast.error("Settings not saved", { description: failed }); return false; }
    toast.success(action === "reset_settings" ? "Settings reset to defaults" : "Settings saved");
    return true;
  };

  // ── Report exports outside the Reports section (Fund Management, Audit Logs) ──
  const reportData = (): ReportData => ({
    applications, scholarships, profiles, staff, payments, auditLogs, payIssues, gradeUpdates: gradeReviews, dataRequests: dataReqs, documents: allDocs,
    requiredDocuments: parseSettings(systemSettings).required_documents, minGrade: Number(parseSettings(systemSettings).min_grade_requirement),
  });
  const exportOpts = (landscape = false) => {
    const s = parseSettings(systemSettings);
    return {
      landscape, generatedBy: adminEmail, programName: s.program_name,
      signatories: { preparedBy: s.report_prepared_by, preparedTitle: s.report_prepared_title, approvedBy: s.report_approved_by, approvedTitle: s.report_approved_title },
    };
  };
  const exportDef = async (def: ReportDef, file: string, kind: "pdf" | "xlsx", landscape = false) => {
    try {
      if (kind === "pdf") await renderPDF(def, `${file}.pdf`, exportOpts(landscape));
      else await renderExcel(def, `${file}.xlsx`, exportOpts());
      toast.success(kind === "pdf" ? "PDF downloaded" : "Excel downloaded");
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : String(e) });
    }
  };


  const statusBadge = (status: string) => <StatusBadge status={status} />;

  const disbStatusBadge = (status: string) => <StatusBadge status={status} />;

  // Notification deep links look like /admin?section=disbursement
  const goToLink = (link: string) => {
    const u = new URL(link, window.location.origin);
    if (u.pathname === "/admin") {
      const sec = u.searchParams.get("section");
      if (sec && sidebarItems.some((i) => i.key === sec)) setActiveSection(sec);
      if (u.searchParams.get("view")) setPendingView(u.searchParams.get("view"));
    } else {
      router.push(link);
    }
  };

  activeSectionRef.current = activeSection;
  goToLinkRef.current = goToLink;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sec = params.get("section");
    if (sec && sidebarItems.some((i) => i.key === sec)) setActiveSection(sec);
    if (params.get("view")) setPendingView(params.get("view"));
  }, []);
  useEffect(() => {
    if (!pendingView) return;
    const a = applications.find((x) => x.id === pendingView);
    if (a) { setViewApp(a); setPendingView(null); }
  }, [pendingView, applications]);

  // A deep link or notification may point at a section this role doesn't use.
  useEffect(() => {
    if (!loading && !canSee(activeSection)) setActiveSection("overview");
  }, [loading, activeSection, adminRole, canManageSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  const APP_PAGE_SIZE = 10;
  // Registered students who haven't submitted an application yet. They count as applicants so
  // admins can see who is stuck (usually on the required documents) and follow up.
  // Students who haven't applied anywhere belong to no office, so they're left out of an office view.
  const notApplied = useMemo(() => {
    if (viewingOffice) return [];
    const applied = new Set(allApplications.map((a) => a.user_id));
    return profiles.filter((p) => !applied.has(p.id));
  }, [profiles, allApplications, viewingOffice]);
  // Required documents uploaded (and not disapproved) by a student who hasn't applied yet.
  const docsReady = (userId: string) => {
    const required = parseSettings(systemSettings).required_documents;
    const ok = required.filter((type) => {
      const latest = allDocs
        .filter((d) => d.user_id === userId && d.document_type === type && d.application_id === null)
        .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
      return latest && latest.status !== "Disapproved";
    });
    return { done: ok.length, total: required.length, missing: required.filter((t) => !ok.includes(t)) };
  };
  // Applicant pipeline: registered → applied (pending) → approved / disapproved → scholar → paid.
  const pipeline = useMemo(() => {
    const by = (st: string) => applications.filter((a) => a.status === st).length;
    const paidScholars = new Set(payments.filter((p) => p.status === "Disbursed").map((p) => p.user_id));
    return {
      total: notApplied.length + new Set(applications.map((a) => a.user_id)).size,
      notApplied: notApplied.length,
      pending: by("Pending"),
      waitlisted: by("Waitlisted"),
      approved: by("Approved"),
      disapproved: by("Disapproved"),
      scholars: scholars.length,
      disbursed: paidScholars.size,
    };
  }, [applications, payments, notApplied, scholars]);

  const showApplicants = (status: string) => { setStatusFilter(status); setAppPage(1); setActiveSection("applications"); };
  // Shown on Applicant Management; the Dashboard's stat cards follow the same order.
  const pipelineStrip = (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
      {([
        { label: "Total applicants", value: pipeline.total, sub: "registered students", go: () => showApplicants("all") },
        { label: "Not yet applied", value: pipeline.notApplied, sub: "registered, no application", go: () => showApplicants("not_applied"), warn: pipeline.notApplied > 0 },
        { label: "Pending", value: pipeline.pending, sub: pipeline.waitlisted ? `+ ${pipeline.waitlisted} waitlisted` : "awaiting review", go: () => showApplicants(pipeline.waitlisted ? "open" : "pending") },
        { label: "Approved", value: pipeline.approved, sub: "applications", go: () => showApplicants("approved") },
        { label: "Disapproved", value: pipeline.disapproved, sub: "applications", go: () => showApplicants("disapproved") },
        { label: "Students", value: pipeline.scholars, sub: "approved scholars", go: () => setActiveSection("students") },
        { label: "Disbursed", value: pipeline.disbursed, sub: "scholars paid", go: () => setActiveSection("disbursement") },
      ] as { label: string; value: number; sub: string; go: () => void; warn?: boolean }[]).map((t) => (
        <button key={t.label} type="button" onClick={t.go}
          className={`rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60 cursor-pointer ${t.warn ? "border-amber-300" : "border-border"}`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t.label}</p>
          <p className={`text-2xl font-bold tabular-nums ${t.warn ? "text-amber-700" : "text-foreground"}`}>{t.value}</p>
          <p className="text-[11px] text-muted-foreground truncate">{t.sub}</p>
        </button>
      ))}
    </div>
  );

  type ApplicantRow = { kind: "app"; app: typeof applications[number]; at: string } | { kind: "none"; profile: Tables<"profiles">; at: string };
  const q = appSearch.trim().toLowerCase();
  // Name, email and school for everyone; the program name for applications too.
  const personText = (p?: Tables<"profiles"> | null) => `${personName(p)} ${p?.email || ""} ${p?.school_name || ""}`.toLowerCase();
  const statusMatches = (st: string) =>
    statusFilter === "all" || (statusFilter === "open" ? st === "Pending" || st === "Waitlisted" : st.toLowerCase() === statusFilter);
  const filteredApps: ApplicantRow[] = [
    // Students who haven't applied have no program, so a program filter hides them.
    ...((statusFilter === "all" || statusFilter === "not_applied") && appProgram === "all"
      ? notApplied
          .filter((p) => !q || personText(p).includes(q))
          .map((p): ApplicantRow => ({ kind: "none", profile: p, at: p.created_at }))
      : []),
    ...applications
      .filter((a) => statusMatches(a.status))
      .filter((a) => appProgram === "all" || a.scholarship_id === appProgram)
      .filter((a) => !q || personText(a.profiles).includes(q) || (a.scholarships?.name || "").toLowerCase().includes(q) || a.id.startsWith(q))
      .map((a): ApplicantRow => ({ kind: "app", app: a, at: a.created_at })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  const appPages = Math.max(1, Math.ceil(filteredApps.length / APP_PAGE_SIZE));
  const currentAppPage = Math.min(appPage, appPages);
  const pagedApps = filteredApps.slice((currentAppPage - 1) * APP_PAGE_SIZE, currentAppPage * APP_PAGE_SIZE);
  // Bulk selection covers applications that can still be decided (Pending / Waitlisted).
  const isOpenApp = (a: AppRow) => a.status === "Pending" || a.status === "Waitlisted";
  const selectablePaged = pagedApps.flatMap((r) => (r.kind === "app" && isOpenApp(r.app) && can.review ? [r.app.id] : []));
  // Students who haven't applied can be selected too, for a bulk reminder.
  const selectableStudentsPaged = pagedApps.flatMap((r) => (r.kind === "none" ? [r.profile.id] : []));
  const allPagedSelected = selectablePaged.length + selectableStudentsPaged.length > 0
    && selectablePaged.every((id) => selectedApps.has(id))
    && selectableStudentsPaged.every((id) => selectedStudents.has(id));
  const toggleStudentSelected = (id: string, on: boolean) => setSelectedStudents((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const clearSelection = () => { setSelectedApps(new Set()); setSelectedStudents(new Set()); };
  const toggleSelected = (id: string, on: boolean) => setSelectedApps((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  // Drop selections that are no longer open (decided elsewhere, withdrawn) or no longer exist.
  useEffect(() => {
    setSelectedApps((prev) => {
      const open = new Set(applications.filter(isOpenApp).map((a) => a.id));
      const next = new Set([...prev].filter((id) => open.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applications]);
  useEffect(() => {
    setSelectedStudents((prev) => {
      const waiting = new Set(notApplied.map((p) => p.id));
      const next = new Set([...prev].filter((id) => waiting.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notApplied]);

  // ── Messages to students (migration 043) ──
  const reminderDefault = (userIds: string[]) => {
    const base = "Please finish uploading your required documents and submit your scholarship application before the deadline.";
    if (userIds.length !== 1) return base;
    const { missing } = docsReady(userIds[0]);
    return missing.length ? `${base} Still missing: ${missing.join(", ")}.` : base;
  };
  const openReminder = (userIds: string[]) => { setReminderText(reminderDefault(userIds)); setReminderFor(userIds); };
  const sendReminders = async () => {
    if (!reminderFor?.length) return;
    setMessaging(true);
    let sent = 0, already = 0;
    const failures: string[] = [];
    for (const id of reminderFor) {
      const { data, error } = await supabase.rpc("message_student", { _user_id: id, _kind: "apply_reminder", _message: reminderText });
      if (error) failures.push(`${personName(profiles.find((p) => p.id === id))}: ${error.message}`);
      else if (data) sent += 1;
      else already += 1;
    }
    setMessaging(false);
    const summary = [`${sent} reminder${sent === 1 ? "" : "s"} sent`, already ? `${already} already reminded today` : "", failures.length ? `${failures.length} failed` : ""].filter(Boolean).join(", ");
    if (failures.length) toast.warning(summary, { description: failures.slice(0, 3).join("\n") });
    else if (sent) toast.success(summary);
    else toast.info(summary);
    setReminderFor(null);
    setSelectedStudents(new Set());
  };
  const sendChangeRequest = async () => {
    if (!changesFor) return;
    setMessaging(true);
    const { error } = await supabase.rpc("message_student", {
      _user_id: changesFor.user_id, _kind: "request_changes", _message: changesText, _application_id: changesFor.id,
    });
    setMessaging(false);
    if (error) { toast.error("Couldn't send the request", { description: error.message }); return; }
    toast.success("Request sent — the student was notified");
    setChangesFor(null);
  };

  // Approved applications move on to Disbursement: schedule the payment, or look at the ones scheduled.
  const scheduleFor = (a: AppRow) => { setViewApp(null); setActiveSection("disbursement"); openNewPayment(a.id); };
  const paymentsFor = (a: AppRow) => {
    setViewApp(null);
    setPaySearch(personName(a.profiles) === "—" ? "" : personName(a.profiles));
    setPayFilter("all"); setPayPage(1);
    setActiveSection("disbursement");
  };

  const exportApplicants = async () => {
    const XLSX = await import("xlsx");
    const date = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-PH") : "—");
    const rows = filteredApps.map((r) => {
      if (r.kind === "none") {
        const p = r.profile;
        return {
          Name: personName(p), Email: p.email || "—", School: p.school_name || "—",
          Scholarship: "—", Type: "—", Term: "—", "Grade when applied": "—", "Current grade": p.average_grade ?? "—",
          Status: "Not yet applied", "Applied / Registered": date(p.created_at), Decided: "—", "Award (PHP)": "—", "Message to student": "—",
        };
      }
      const a = r.app;
      return {
        Name: personName(a.profiles), Email: a.profiles?.email || "—",
        School: a.profiles?.school_name || "—", Scholarship: a.scholarships?.name || "—",
        Type: a.is_renewal ? "Renewal" : "New", Term: [a.academic_year, a.semester].filter(Boolean).join(" · ") || "—",
        "Grade when applied": a.average_grade ?? "—", "Current grade": a.profiles?.average_grade ?? "—",
        Status: a.status, "Applied / Registered": date(a.created_at), Decided: date(a.decided_at),
        "Award (PHP)": a.status === "Approved" ? appAward(a) : "—", "Message to student": a.notes || "—",
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Applicants");
    XLSX.writeFile(wb, `applicants${fileOffice}.xlsx`);
    toast.success("Excel downloaded");
  };

  // ── Fund management (derived from payments + applications) ──
  const fundData = useMemo(() => {
    const payDate = (p: Tables<"payments">) => p.disbursed_at || p.scheduled_date || p.created_at;
    const { since, until } = getRange(fundPeriod, fromDate, toDate);
    const inRange = payments.filter((p) => {
      const d = new Date(payDate(p));
      return (!since || d >= since) && (!until || d <= until);
    });

    const sum = (list: Tables<"payments">[]) => list.reduce((t, p) => t + Number(p.amount || 0), 0);
    const pipeline = (["Pending", "Processing", "Disbursed"] as const).map((st) => {
      const list = inRange.filter((p) => p.status === st);
      return { status: st, count: list.length, amount: sum(list) };
    });

    const programOf = (p: Tables<"payments">) => applications.find((a) => a.id === p.application_id)?.scholarship_id ?? null;
    const byProgram = scholarships.map((sch) => {
      const list = inRange.filter((p) => programOf(p) === sch.id);
      const paid = list.filter((p) => p.status === "Disbursed");
      return {
        id: sch.id, name: sch.name,
        scholars: new Set(paid.map((p) => p.user_id)).size,
        disbursed: sum(paid),
        queued: sum(list.filter((p) => p.status === "Pending" || p.status === "Processing")),
      };
    });
    const unassigned = inRange.filter((p) => !programOf(p));
    if (unassigned.length) {
      const paid = unassigned.filter((p) => p.status === "Disbursed");
      byProgram.push({ id: "none", name: "Unassigned", scholars: new Set(paid.map((p) => p.user_id)).size, disbursed: sum(paid), queued: sum(unassigned.filter((p) => p.status === "Pending" || p.status === "Processing")) });
    }

    const methods = new Map<string, { count: number; amount: number }>();
    inRange.filter((p) => p.status === "Disbursed").forEach((p) => {
      const m = methods.get(p.method || "Other") ?? { count: 0, amount: 0 };
      m.count += 1; m.amount += Number(p.amount || 0);
      methods.set(p.method || "Other", m);
    });
    const disbursedTotal = pipeline[2].amount;
    const byMethod = [...methods.entries()].map(([method, v]) => ({ method, ...v, share: disbursedTotal ? Math.round((v.amount / disbursedTotal) * 100) : 0 }))
      .sort((x, y) => y.amount - x.amount);


    const recent = [...inRange].sort((x, y) => new Date(payDate(y)).getTime() - new Date(payDate(x)).getTime()).slice(0, 8);


    return { pipeline, byProgram, byMethod, recent, disbursedTotal };
  }, [payments, applications, scholarships, fundPeriod, fromDate, toDate]);
  // Approved applications with a term that has no payment yet (a per-semester award has two).
  const awaitingPayment = applications.filter((a) => a.status === "Approved" && openTermsOf(a).length > 0);

  if (loading) {
    return <DashboardSkeleton variant="admin" />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r flex flex-col transform transition-transform lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 p-4 border-b">
          <Image src={officeLogo(myOffice)} alt={myOffice ? `${OFFICE_FULL_NAME[myOffice]} seal` : "Municipality of San Jose seal"} width={32} height={32} className="h-8 w-8" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" title={myOffice ? OFFICE_FULL_NAME[myOffice] : undefined}>{myOffice ? OFFICE_LABEL[myOffice] : "Mayor Office"}</p>
            <p className="text-xs text-muted-foreground truncate">Scholarship System</p>
          </div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}><X className="h-5 w-5" /></button>
        </div>
        {!myOffice && officesReady && (
          <div className="px-3 pt-3">
            <Select value={officeView} onValueChange={setOfficeView}>
              <SelectTrigger aria-label="Office shown" className={officeView !== "all" ? "border-primary text-primary" : undefined}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All offices</SelectItem>
                {STAFF_OFFICES.map((o) => <SelectItem key={o} value={o}>{OFFICE_LABEL[o]}</SelectItem>)}
                <SelectItem value="municipal">Mayor Office programs</SelectItem>
              </SelectContent>
            </Select>
            {officeView !== "all" && <p className="mt-1 px-1 text-[11px] text-muted-foreground">Every page shows only this office&apos;s programs, applicants and payments.</p>}
          </div>
        )}
        <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
          {sidebarItems.filter((item) => canSee(item.key)).map((item, i, items) => {
            const unread = item.key === "notifications" ? unreadTotal : 0;
            const startsGroup = item.group && item.group !== items[i - 1]?.group;
            return (
              <Fragment key={item.key}>
              {startsGroup && <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.group}</p>}
              <button onClick={() => { setActiveSection(item.key); setSidebarOpen(false); }}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeSection === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <item.icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span>
                {unread > 0 && (
                  <span className={`ml-auto text-xs font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1 ${activeSection === item.key ? "bg-white/25 text-primary-foreground" : "bg-primary text-primary-foreground"}`}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
              </Fragment>
            );
          })}
        </nav>
        <div className="p-3 border-t">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted mb-2">
            <div className="h-8 w-8 rounded-xl overflow-hidden shrink-0">
              <ProfileImage value={adminProfile?.profile_picture_url} className="h-full w-full object-cover"
                fallback={<div className="h-full w-full bg-primary flex items-center justify-center"><User className="h-4 w-4 text-primary-foreground" /></div>} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{adminProfile?.first_name ? `${adminProfile.first_name} ${adminProfile.last_name || ""}`.trim() : "Admin"}</p>
              <p className="text-xs text-muted-foreground truncate">{adminEmail}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-card/80 backdrop-blur-md px-4 h-14">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu className="h-5 w-5" /></button>
          <h1 className="text-lg font-display font-bold capitalize">{sidebarItems.find((s) => s.key === activeSection)?.label || activeSection}</h1>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {/* OVERVIEW */}
          {activeSection === "overview" && (
            <OverviewPanel
              applications={applications}
              scholarships={scholarships}
              profiles={scholars}
              notApplied={notApplied}
              payments={payments}
              auditLogs={auditLogs}
              firstName={adminProfile?.first_name}
              refreshing={refreshing}
              lastUpdated={lastUpdated}
              loadError={loadError}
              onRefresh={() => loadData(true)}
              onViewApp={setViewApp}
              deletionRequests={can.super ? pendingDeletions.length : 0}
              officeBreakdown={officeView === "all" ? officeBreakdown : []}
              onViewOffice={setOfficeView}
              onNavigate={(section, opts) => {
                setActiveSection(section);
                if (opts?.status !== undefined) { setStatusFilter(opts.status); setAppPage(1); }
              }}
            />
          )}

          {/* APPLICATIONS */}
          {activeSection === "visits" && mapAccess && (
            <HomeVisitsPanel applications={applications} scholarships={scholarships} onOpen={(a) => setViewApp(a)} />
          )}

          {activeSection === "applications" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Applicant Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search name, email, ID, school, program..." value={appSearch} onChange={(e) => { setAppSearch(e.target.value); setAppPage(1); }} className="pl-9 w-72" />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setAppPage(1); clearSelection(); }}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="not_applied">Not yet applied</SelectItem>
                      <SelectItem value="open">Pending + waitlisted</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="waitlisted">Waitlisted</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="disapproved">Disapproved</SelectItem>
                      <SelectItem value="withdrawn">Withdrawn</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={appProgram} onValueChange={(v) => { setAppProgram(v); setAppPage(1); clearSelection(); }}>
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All programs</SelectItem>
                      {scholarships.map((sch) => <SelectItem key={sch.id} value={sch.id}>{sch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={exportApplicants} disabled={filteredApps.length === 0}>
                    <FileDown className="mr-1 h-4 w-4" /> Export
                  </Button>
                </div>
              </div>
              {pipelineStrip}
              {selectedStudents.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/20">
                  <span className="font-medium">{selectedStudents.size} not yet applied selected</span>
                  <Button size="sm" variant="outline" disabled={messaging} onClick={() => openReminder([...selectedStudents])}>
                    <Bell className="mr-1 h-4 w-4" /> Send reminder
                  </Button>
                  <Button size="sm" variant="ghost" disabled={messaging} onClick={() => setSelectedStudents(new Set())}>Clear</Button>
                </div>
              )}
              {selectedApps.size > 0 && can.review && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-accent px-3 py-2 text-sm">
                  <span className="font-medium">{selectedApps.size} application{selectedApps.size === 1 ? "" : "s"} selected</span>
                  <Button size="sm" disabled={bulkBusy} onClick={() => bulkDecide("Approved")}>
                    {bulkBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />} Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkDecide("Waitlisted")}>
                    <Hourglass className="mr-1 h-4 w-4" /> Waitlist
                  </Button>
                  <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => { setBulkNote(""); setBulkDisapprove(true); }}>
                    <XCircle className="mr-1 h-4 w-4" /> Disapprove
                  </Button>
                  <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelectedApps(new Set())}>Clear</Button>
                  <span className="text-xs text-muted-foreground">Each one is checked on its own; any that can&apos;t be changed are listed afterwards.</span>
                </div>
              )}
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-10">
                      <Checkbox aria-label="Select everything selectable on this page" disabled={selectablePaged.length + selectableStudentsPaged.length === 0}
                        checked={allPagedSelected}
                        onCheckedChange={(on) => {
                          const apply = (ids: string[]) => (prev: Set<string>) => {
                            const next = new Set(prev);
                            ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
                            return next;
                          };
                          setSelectedApps(apply(selectablePaged));
                          setSelectedStudents(apply(selectableStudentsPaged));
                        }} />
                    </TableHead>
                    <TableHead>Applicant</TableHead><TableHead>Scholarship</TableHead><TableHead>Grade</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredApps.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No applicants found</TableCell></TableRow>}
                    {pagedApps.map((row) => {
                      if (row.kind === "none") {
                        const p = row.profile;
                        const docs = docsReady(p.id);
                        return (
                          <TableRow key={`none-${p.id}`} className="bg-amber-50/40 dark:bg-amber-950/10">
                            <TableCell>
                              <Checkbox aria-label={`Select ${personName(p)}`} checked={selectedStudents.has(p.id)} onCheckedChange={(on) => toggleStudentSelected(p.id, on === true)} />
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">{personName(p)}</p>
                              <p className="text-xs text-muted-foreground">{p.email}</p>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground" title={docs.missing.length ? `Missing: ${docs.missing.join(", ")}` : undefined}>
                              No application yet
                              <span className="block">Documents {docs.done}/{docs.total}</span>
                            </TableCell>
                            <TableCell>{p.average_grade ?? "—"}</TableCell>
                            <TableCell title="Registered">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                                <Clock className="h-3 w-3" />Not yet applied
                              </span>
                            </TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button size="icon" variant="ghost" title="View profile" onClick={() => setViewStudent(p)}><Eye className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" title="Send reminder to apply" onClick={() => openReminder([p.id])}><Bell className="h-4 w-4 text-warning" /></Button>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const a = row.app;
                      const name = personName(a.profiles);
                      const blocker = isOpenApp(a) ? approveBlocker(a) : null;
                      const currentGrade = a.profiles?.average_grade ?? null;
                      return (
                        <TableRow key={a.id} data-state={selectedApps.has(a.id) ? "selected" : undefined}>
                          <TableCell>
                            {isOpenApp(a) && can.review && (
                              <Checkbox aria-label={`Select ${name}`} checked={selectedApps.has(a.id)} onCheckedChange={(on) => toggleSelected(a.id, on === true)} />
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{name}</p>
                            {a.profiles?.email && <p className="text-xs text-muted-foreground">{a.profiles.email}</p>}
                            <div className="mt-1 flex gap-1 flex-wrap empty:hidden">
                              {gradeReviews.some((g) => g.user_id === a.user_id && g.status === "Pending") && <Badge variant="secondary" className="text-[10px]">Grade to review</Badge>}
                              {dataReqs.some((r) => r.user_id === a.user_id && r.status === "Pending") && <Badge variant="destructive" className="text-[10px]">Deletion requested</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>{a.scholarships?.name || "—"}</TableCell>
                          <TableCell title="Grade when applied">
                            {a.average_grade ?? currentGrade ?? "—"}
                            {a.average_grade != null && currentGrade != null && Number(currentGrade) !== Number(a.average_grade) && (
                              <span className="block text-xs text-muted-foreground" title="Current grade on the profile">now {currentGrade}</span>
                            )}
                          </TableCell>
                          <TableCell>{new Date(a.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{statusBadge(a.status)}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="icon" variant="ghost" onClick={() => setViewApp(a)} title="View"><Eye className="h-4 w-4" /></Button>
                            {isOpenApp(a) && can.review && (<>
                              <Button size="icon" variant="ghost" disabled={!!blocker} title={blocker ?? "Approve"} onClick={async () => {
                                if (await decideApplication(a, "Approved", null)) { toast.success(`${name} approved!`); loadData(true); }
                              }}><CheckCircle className="h-4 w-4 text-success" /></Button>
                              {a.status === "Pending" && (
                                <Button size="icon" variant="ghost" title="Waitlist" onClick={async () => {
                                  if (await decideApplication(a, "Waitlisted", null)) { toast.info(`${name} waitlisted`); loadData(true); }
                                }}><Hourglass className="h-4 w-4 text-warning" /></Button>
                              )}
                              <Button size="icon" variant="ghost" title="Disapprove" onClick={() => { setDisapproveAppNote(""); setDisapproveApp(a); }}>
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </>)}
                            {a.status === "Disapproved" && can.review && (
                              <Button size="icon" variant="ghost" title="Reopen" onClick={async () => {
                                if (await decideApplication(a, "Pending", null)) { toast.success(`${name} reopened`); loadData(true); }
                              }}><RotateCcw className="h-4 w-4" /></Button>
                            )}
                            {a.status === "Approved" && can.finance && (hasLivePayment(a.id) ? (
                              <Button size="icon" variant="ghost" title="View payments" onClick={() => paymentsFor(a)}><Wallet className="h-4 w-4 text-primary" /></Button>
                            ) : (
                              <Button size="icon" variant="ghost" title="Schedule payment" onClick={() => scheduleFor(a)}><Banknote className="h-4 w-4 text-success" /></Button>
                            ))}
                            {a.status === "Approved" && can.review && (
                              <Button size="icon" variant="ghost" disabled={hasLivePayment(a.id)}
                                title={hasLivePayment(a.id) ? "This application has payments. Cancel them before revoking the approval" : "Revoke approval"}
                                onClick={() => { setRevokeNote(""); setRevokeApp(a); }}><Undo2 className="h-4 w-4 text-destructive" /></Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{filteredApps.length === 0 ? "0 applicants" : `Showing ${(currentAppPage - 1) * APP_PAGE_SIZE + 1}–${Math.min(currentAppPage * APP_PAGE_SIZE, filteredApps.length)} of ${filteredApps.length}`}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={currentAppPage <= 1} onClick={() => setAppPage(currentAppPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span>Page {currentAppPage} of {appPages}</span>
                  <Button size="sm" variant="outline" disabled={currentAppPage >= appPages} onClick={() => setAppPage(currentAppPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>

              {(() => {
                const va = viewApp;
                const open = va ? isOpenApp(va) : false;
                const awardOverride = open && awardInput.trim() !== "" ? Number(awardInput) : undefined;
                const awardValid = awardOverride === undefined || (Number.isFinite(awardOverride) && awardOverride > 0);
                const blocker = va && open ? (awardValid ? approveBlocker(va, awardOverride) : "Enter an award greater than 0") : null;
                const cap = va ? capacityFor(va, awardOverride) : null;
                const counts = va ? countsForApp(va) : null;
                const currentDocs = counts ? viewDocs.filter(counts) : [];
                const olderDocs = counts ? viewDocs.filter((d) => !counts(d)) : [];
                const livePay = va ? hasLivePayment(va.id) : false;
                const close = () => setViewApp(null);
                return (
                  <AppDialog open={!!va} onOpenChange={(o) => !o && close()} size="lg"
                    title="Application Details"
                    description={va ? <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">{personName(va.profiles)} · {va.scholarships?.name || "—"} {statusBadge(va.status)}</span> : undefined}
                    footer={va && (!can.review ? <Button variant="outline" onClick={close}>Close</Button> : open ? <>
                      <Button variant="ghost" className="sm:mr-auto" onClick={() => { setChangesText(""); setChangesFor(va); }}>
                        <Pencil className="mr-1 h-4 w-4" /> Request changes
                      </Button>
                      {va.status === "Pending" && (
                        <Button variant="outline" onClick={async () => {
                          if (await decideApplication(va, "Waitlisted", remarks)) { toast.info("Waitlisted"); close(); loadData(true); }
                        }}><Hourglass className="mr-1 h-4 w-4" /> Waitlist</Button>
                      )}
                      <Button variant="destructive" disabled={!remarks.trim()} title={remarks.trim() ? undefined : "Write the reason in the message first — it is shown to the student"} onClick={async () => {
                        if (await decideApplication(va, "Disapproved", remarks)) { toast.error("Disapproved"); close(); loadData(true); }
                      }}><XCircle className="mr-1 h-4 w-4" /> Disapprove</Button>
                      <Button disabled={!!blocker} title={blocker ?? undefined} onClick={async () => {
                        if (await decideApplication(va, "Approved", remarks, awardOverride ?? null)) { toast.success("Approved!"); close(); loadData(true); }
                      }}><CheckCircle className="mr-1 h-4 w-4" /> Approve</Button>
                    </> : <>
                      {va.status === "Approved" && (
                        <Button variant="outline" className="text-destructive sm:mr-auto" disabled={livePay}
                          title={livePay ? "This application has payments. Cancel them before revoking the approval" : undefined}
                          onClick={() => { setRevokeNote(""); setRevokeApp(va); }}>
                          <Undo2 className="mr-1 h-4 w-4" /> Revoke approval
                        </Button>
                      )}
                      {va.status === "Disapproved" && (
                        <Button variant="outline" className="sm:mr-auto" onClick={async () => {
                          // The disapproval reason is cleared, so it isn't resent with a later decision.
                          if (await decideApplication(va, "Pending", null)) { toast.success("Reopened"); close(); loadData(true); }
                        }}><RotateCcw className="mr-1 h-4 w-4" /> Reopen for review</Button>
                      )}
                      <Button variant="outline" onClick={close}>Close</Button>
                      {va.status === "Approved" && !livePay && can.finance && (
                        <Button onClick={() => scheduleFor(va)}><Banknote className="mr-1 h-4 w-4" /> Schedule payment</Button>
                      )}
                    </>)}>
                    {viewApp && (<>
                      <DetailGrid>
                        <div>
                          <dt className="text-xs text-muted-foreground">Applicant</dt>
                          <dd className="mt-0.5 text-sm font-medium">{personName(viewApp.profiles)}</dd>
                          <div className="flex flex-wrap gap-x-3">
                            {profiles.some((p) => p.id === viewApp.user_id) && (
                              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setViewStudent(profiles.find((p) => p.id === viewApp.user_id) ?? null)}>View full profile</button>
                            )}
                            {payments.some((p) => p.application_id === viewApp.id) && (
                              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => paymentsFor(viewApp)}>View payments</button>
                            )}
                          </div>
                        </div>
                        <Detail label="Email">{viewApp.profiles?.email || "—"}</Detail>
                        <Detail label="School">{viewApp.profiles?.school_name || "—"}</Detail>
                        <Detail label="Course">{viewApp.profiles?.course || "—"}</Detail>
                        <Detail label="Year Level">{viewApp.profiles?.year_level || "—"}</Detail>
                        <Detail label="Current grade">{viewApp.profiles?.average_grade ?? "—"}</Detail>
                        <Detail label="Scholarship">{viewApp.scholarships?.name || "—"}</Detail>
                        <Detail label="Status">{statusBadge(viewApp.status)}</Detail>
                        <Detail label="Type">{viewApp.is_renewal ? "Renewal" : "New application"}</Detail>
                        <Detail label="Term">{[viewApp.academic_year, viewApp.semester].filter(Boolean).join(" · ") || "—"}</Detail>
                        <Detail label="Grade when applied">{viewApp.average_grade ?? "—"}</Detail>
                        <Detail label="Household income">{peso(viewApp.household_income)}</Detail>
                        <Detail label="Household size">{viewApp.household_size ?? "—"}</Detail>
                        {cap && (
                          <div>
                            <dt className="text-xs text-muted-foreground">Program capacity</dt>
                            <p className={`mt-0.5 text-sm font-medium ${open && (cap.slotsFull || cap.overBudget) ? "text-destructive" : ""}`}>
                              {cap.sch.slots > 0 ? `${cap.approved} of ${cap.sch.slots} slots filled` : `${cap.approved} approved (no slot limit)`}
                            </p>
                            {Number(cap.sch.total_budget) > 0 && (
                              <p className="text-xs text-muted-foreground">{formatPHP(cap.committed)} of {formatPHP(Number(cap.sch.total_budget))} committed</p>
                            )}
                          </div>
                        )}
                      </DetailGrid>
                      <div>
                        <h3 className="mb-1.5 text-sm font-semibold">Applicant statement</h3>
                        <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{viewApp.statement || "—"}</p>
                      </div>
                      <div>
                        <h3 className="mb-1.5 text-sm font-semibold">Requirements for {viewApp.scholarships?.name || "this program"}</h3>
                        <ul className="space-y-1 rounded-md border px-3 py-2">
                          {requirementChecks(viewApp).map((c) => (
                            <li key={c.key} className="flex items-start gap-2 text-sm">
                              {c.ok ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-success" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />}
                              <span><span className="font-medium">{c.label}</span> <span className="text-muted-foreground">· {c.detail}</span></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {(() => {
                        const office = scholarships.find((sc) => sc.id === viewApp.scholarship_id)?.office;
                        if (!needsHomeVisit(office) && !needsHousePin(office)) return null;
                        const pr = profiles.find((x) => x.id === viewApp.user_id);
                        const pin = pr?.home_lat != null && pr?.home_lng != null ? { lat: pr.home_lat, lng: pr.home_lng } : null;
                        return (
                          <div>
                            <h3 className="mb-1.5 text-sm font-semibold">House and home visit</h3>
                            <div className="space-y-3 rounded-md border px-3 py-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                                {!mapAccess ? (
                                  <span className="text-muted-foreground">{pin ? "The student has pinned their house. Only MSWDO staff can see where." : "The student hasn\u2019t pinned their house yet."}</span>
                                ) : pin ? (
                                  <>
                                    <span>{pr?.home_landmark || "No landmark given"}</span>
                                    {[["Google Maps", googleMapsLink(pin)], ["Directions", directionsLink(pin)], ["Street View", streetViewLink(pin)], ["Google Earth (3D)", earthLink(pin)]].map(([label, href]) => (
                                      <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                        {label} <ExternalLink className="h-3 w-3" />
                                      </a>
                                    ))}
                                  </>
                                ) : <span className="text-muted-foreground">The student hasn&apos;t pinned their house yet.</span>}
                              </div>
                              {mapAccess && pin && <HouseMap pin={pin} readOnly className="h-56" />}
                              {mapAccess && (() => {
                                // Moved since the visit was done (or, without a visit, just the history).
                                const latest = pinHistory[0];
                                const before = pinHistory.slice(1).find((h) => h.home_lat != null && h.home_lng != null);
                                const movedAfterVisit = latest && viewApp.home_visit_done_at && latest.changed_at > viewApp.home_visit_done_at;
                                if (pinHistory.length < 2 && !movedAfterVisit) return null;
                                return (
                                  <div className="space-y-1 text-xs">
                                    {movedAfterVisit && (
                                      <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-800">
                                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                        The student {latest.home_lat == null ? "removed" : "changed"} their house pin after the visit was done
                                        {latest.home_lat != null && before?.home_lat != null && before.home_lng != null
                                          ? ` (moved ${fmtDistance(distanceKm({ lat: before.home_lat, lng: before.home_lng }, { lat: latest.home_lat, lng: latest.home_lng! }))})` : ""}.
                                      </p>
                                    )}
                                    <details>
                                      <summary className="cursor-pointer text-muted-foreground">Pin history ({pinHistory.length})</summary>
                                      <ul className="mt-1 space-y-0.5">
                                        {pinHistory.map((h) => (
                                          <li key={h.id} className="text-muted-foreground">
                                            {new Date(h.changed_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                                            {h.home_lat == null || h.home_lng == null ? "Pin removed" : (
                                              <a href={googleMapsLink({ lat: h.home_lat, lng: h.home_lng })} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                                {h.home_lat.toFixed(5)}, {h.home_lng.toFixed(5)}
                                              </a>
                                            )}
                                            {h.home_landmark ? ` · ${h.home_landmark}` : ""}
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  </div>
                                );
                              })()}
                              {needsHomeVisit(office) && (
                                <>
                                  <p className={viewApp.home_visit_done_at ? "text-success font-medium" : "text-muted-foreground"}>
                                    {viewApp.home_visit_done_at
                                      ? `Visit done ${new Date(viewApp.home_visit_done_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}`
                                      : viewApp.home_visit_at
                                        ? `Scheduled ${new Date(viewApp.home_visit_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}${viewApp.home_visit_note ? ` · ${viewApp.home_visit_note}` : ""}`
                                        : "Not scheduled yet."}
                                  </p>
                                  {can.review && open && (
                                    <div className="space-y-2">
                                      <div className="grid gap-2 sm:grid-cols-2">
                                        <Input type="datetime-local" value={visitAt} onChange={(e) => setVisitAt(e.target.value)} aria-label="Visit date and time" />
                                        <Input value={visitNote} maxLength={500} onChange={(e) => setVisitNote(e.target.value)} placeholder="Note for the student (optional)" />
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <Button size="sm" variant="outline" disabled={visitBusy || !visitAt} onClick={() => saveHomeVisit(viewApp)}>
                                          {viewApp.home_visit_at ? "Reschedule & notify" : "Schedule & notify"}
                                        </Button>
                                        {viewApp.home_visit_at && (
                                          <Button size="sm" variant="outline" disabled={visitBusy} onClick={() => markVisitDone(viewApp, !viewApp.home_visit_done_at)}>
                                            {viewApp.home_visit_done_at ? "Mark not done" : "Mark visit done"}
                                          </Button>
                                        )}
                                        {viewApp.home_visit_at && !viewApp.home_visit_done_at && (
                                          <Button size="sm" variant="ghost" disabled={visitBusy} onClick={() => saveHomeVisit(viewApp, true)}>Clear</Button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div>
                        <h3 className="mb-1.5 text-sm font-semibold">Documents for this application</h3>
                        {docList(currentDocs, docsLoading)}
                        {!docsLoading && olderDocs.length > 0 && (
                          <details className="mt-2 text-sm">
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              {olderDocs.length} document{olderDocs.length === 1 ? "" : "s"} filed with the student&apos;s other applications or not yet filed (don&apos;t count for this one)
                            </summary>
                            {docList(olderDocs, false)}
                          </details>
                        )}
                      </div>

                      {viewApp.status === "Approved" && (
                        <div>
                          <h3 className="mb-1.5 text-sm font-semibold">Award amount (₱){(scheduleOf(viewApp) === "semester" || scheduleOf(viewApp) === "monthly") && <span className="font-normal text-muted-foreground">{scheduleOf(viewApp) === "semester" ? " per semester" : " a month"}</span>}</h3>
                          <div className="mt-1 flex items-start gap-2">
                            <MoneyInput wrapperClassName="flex-1" min={1} value={awardInput} onValueChange={setAwardInput} disabled={!can.manage || hasDisbursed(viewApp.id)} />
                            {can.manage && <Button variant="outline" disabled={hasDisbursed(viewApp.id)} onClick={() => saveAward(viewApp)}>Save award</Button>}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {!can.manage ? "Only an admin can change an award after approval." : hasDisbursed(viewApp.id) ? "Locked: a payment for this award has been disbursed." : "The student is notified. Payments already scheduled keep their amount."}
                          </p>
                        </div>
                      )}
                      {open && (
                        <div>
                          <h3 className="mb-1.5 text-sm font-semibold">Award amount (₱{cap?.sch.release_schedule === "semester" ? " per semester" : cap?.sch.release_schedule === "monthly" ? " a month" : ""}, optional)</h3>
                          <MoneyInput wrapperClassName="mt-1" min={1} value={awardInput} onValueChange={setAwardInput}
                            placeholder={cap?.sch.amount ? `Program award: ${formatPHP(Number(cap.sch.amount))}${cap.sch.release_schedule === "semester" ? " per semester" : cap.sch.release_schedule === "monthly" ? " a month" : ""}` : "Program award"} />
                        </div>
                      )}

                      {!can.review ? (viewApp.notes && (
                        <div>
                          <h3 className="mb-1.5 text-sm font-semibold">{viewApp.status === "Disapproved" ? "Reason (shown to the student)" : "Message to the student"}</h3>
                          <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{viewApp.notes}</p>
                        </div>
                      )) : (
                      <div>
                        <h3 className="mb-1.5 text-sm font-semibold">{viewApp.status === "Disapproved" ? "Reason (shown to the student)" : "Message to the student"}</h3>
                        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
                          placeholder={open ? "Sent with your decision and shown on the student's application. Required to disapprove." : "Shown on the student's application."} />
                        {open && viewApp.notes && (
                          <p className="mt-1 text-xs text-muted-foreground">Last message sent: “{viewApp.notes}”. It isn&apos;t sent again unless you write it here.</p>
                        )}
                        {["Approved", "Disapproved"].includes(viewApp.status) && (
                          <Button size="sm" variant="outline" className="mt-2" disabled={viewApp.status === "Disapproved" && !remarks.trim()} onClick={async () => {
                            const prev = viewApp.notes?.trim() || null;
                            const notes = remarks.trim() || null;
                            if (notes === prev) { toast.info("No changes to save"); return; }
                            const { data, error } = await supabase.from("applications").update({ notes })
                              .eq("id", viewApp.id).eq("status", viewApp.status).select("id");
                            if (error) { toast.error(error.message); return; }
                            if (!data?.length) { toast.error("This application was changed elsewhere. The list has been refreshed."); silentRefreshAdmin(); return; }
                            setViewApp({ ...viewApp, notes });
                            // For a disapproved application the database notifies the student (see migration 040).
                            toast.success(viewApp.status === "Disapproved" ? "Reason updated — the student was notified" : "Message saved");
                            loadData(true);
                          }}>{viewApp.status === "Disapproved" ? "Save reason" : "Save message"}</Button>
                        )}
                      </div>
                      )}

                      <div>
                        <h3 className="mb-1.5 text-sm font-semibold">Internal notes (staff only — never shown to the student)</h3>
                        {appNotes.length > 0 && (
                          <ul className="mt-1 space-y-2">
                            {appNotes.map((n) => (
                              <li key={n.id} className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                                <p className="whitespace-pre-wrap">{n.body}</p>
                                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                  <span>{n.author_email || "Staff"} · {new Date(n.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span>
                                  {n.author_id === adminUserId && (
                                    <button type="button" className="hover:text-destructive" title="Delete note" onClick={() => deleteAppNote(n)}><Trash2 className="h-3.5 w-3.5" /></button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2 flex gap-2">
                          <Textarea rows={2} value={newAppNote} onChange={(e) => setNewAppNote(e.target.value)} placeholder="e.g. Called the guardian to confirm household income." maxLength={2000} />
                          <Button variant="outline" className="self-end" disabled={savingAppNote || !newAppNote.trim()} onClick={() => addAppNote(viewApp)}>Add</Button>
                        </div>
                      </div>

                      {open && blocker && (
                        <DialogNote tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>Can&apos;t approve yet. {blocker}.</DialogNote>
                      )}
                      {open && viewApp.changes_requested && (
                        <DialogNote tone="warning" icon={<Hourglass className="h-3.5 w-3.5" />}>
                          <span className="font-semibold">Waiting on the student{viewApp.changes_requested_at ? ` since ${new Date(viewApp.changes_requested_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : ""}: </span>
                          <span className="whitespace-pre-wrap">{viewApp.changes_requested}</span>
                        </DialogNote>
                      )}
                      {viewApp.status === "Approved" && livePay && (
                        <DialogNote>To revoke this approval, cancel its payments in Disbursement first.</DialogNote>
                      )}
                    </>)}
                  </AppDialog>
                );
              })()}
            </div>
          )}

          {/* SCHOLARSHIPS */}
          {activeSection === "scholarships" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Scholarship Programs</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search programs..." value={schSearch} onChange={(e) => setSchSearch(e.target.value)} className="pl-9 w-52" />
                  </div>
                  <Select value={schFilter} onValueChange={setSchFilter}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All programs</SelectItem>
                      <SelectItem value="active">Open</SelectItem>
                      <SelectItem value="closed">Past deadline</SelectItem>
                      <SelectItem value="inactive">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                  {can.manage && (
                    <Button className="bg-gradient-primary shadow-primary" onClick={() => { setSchActive(true); setSchYearLevels([]); setSchBarangays([]); setSchBarangaySearch(""); setSchDialog("new"); }}>
                      <Plus className="mr-1 h-4 w-4" /> Add Scholarship
                    </Button>
                  )}
                </div>
              </div>

              {(() => {
                const cur = schDialog && schDialog !== "new" ? schDialog : null;
                return (
                  <AppDialog open={schDialog !== null} onOpenChange={(o) => !o && setSchDialog(null)} size="xl"
                    title={cur ? "Edit Scholarship" : "Add New Scholarship"}
                    description="Students see the program card once it's accepting applications."
                    onSubmit={saveScholarship} formKey={cur?.id ?? "new"}
                    footer={<>
                      <Button type="button" variant="outline" onClick={() => setSchDialog(null)}>Cancel</Button>
                      <Button type="submit" className="bg-gradient-primary" disabled={savingSch}>{cur ? "Save Changes" : "Add Scholarship"}</Button>
                    </>}>
                    <ScholarshipFormFields
                      cur={cur}
                      yearLevels={schYearLevels} setYearLevels={setSchYearLevels}
                      barangays={schBarangays} setBarangays={setSchBarangays}
                      barangaySearch={schBarangaySearch} setBarangaySearch={setSchBarangaySearch}
                      active={schActive} setActive={setSchActive}
                      committedNote={cur && cur.total_budget > 0 ? `${formatPHP(committedFor(cur))} of ${formatPHP(cur.total_budget)} committed in ${currentAY}.` : null}
                      office={myOffice ?? (officesReady ? "choose" : undefined)}
                    />
                  </AppDialog>
                );
              })()}

              <AppDialog open={!!deleteSch} onOpenChange={(o) => { if (!o) { setDeleteSch(null); setDeleteSchText(""); } }} size="sm"
                title={`Delete ${deleteSch?.name ?? "program"}?`}
                description="This permanently removes the program and can't be undone."
                footer={<>
                  <Button variant="outline" onClick={() => { setDeleteSch(null); setDeleteSchText(""); }}>Cancel</Button>
                  <Button variant="destructive" disabled={!deleteSch || deletingSch || !sameName(deleteSchText, deleteSch.name)} onClick={confirmDeleteScholarship}>
                    {deletingSch && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Delete program
                  </Button>
                </>}>
                {deleteSch && applicantCount(deleteSch.id) > 0 && (
                  <DialogNote tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                    It has {applicantCount(deleteSch.id)} application{applicantCount(deleteSch.id) === 1 ? "" : "s"}
                    {payments.some((p) => applications.some((a) => a.id === p.application_id && a.scholarship_id === deleteSch.id)) ? " with payments" : ""}.
                    {" "}Deleting the program also deletes {applicantCount(deleteSch.id) === 1 ? "it" : "them"} with their uploaded files, notes, notifications and payment records. To keep the records, turn off &ldquo;Accepting applications&rdquo; instead.
                  </DialogNote>
                )}
                {deleteSch && (
                  <DialogField label={<>Type <strong>{deleteSch.name}</strong> to confirm</>} htmlFor="delete-sch-name">
                    <Input id="delete-sch-name" value={deleteSchText} onChange={(e) => setDeleteSchText(e.target.value)} autoComplete="off" />
                  </DialogField>
                )}
              </AppDialog>

              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Program</TableHead><TableHead>Award &amp; budget</TableHead><TableHead>Slots</TableHead><TableHead>Applicants</TableHead><TableHead>Dates</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredScholarships.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No scholarship programs found</TableCell></TableRow>}
                    {filteredScholarships.map((sch) => {
                      const approved = approvedCount(sch.id);
                      const full = sch.slots > 0 && approved >= sch.slots;
                      return (
                        <TableRow key={sch.id}>
                          <TableCell className="max-w-[260px]">
                            <p className="font-medium">{sch.name}</p>
                            {!myOffice && isOffice(sch.office) && <Badge variant="outline" className="my-0.5 text-[10px]">{OFFICE_LABEL[sch.office]}</Badge>}
                            {sch.eligibility && <p className="text-xs text-muted-foreground line-clamp-2" title={sch.eligibility}>{sch.eligibility}</p>}
                          </TableCell>
                          <TableCell className="text-sm">
                            <p>{Number(sch.amount) > 0 ? `${formatPHP(Number(sch.amount))} each` : <span className="text-muted-foreground">No award set</span>}</p>
                            <p className="text-xs text-muted-foreground">{
                              sch.release_schedule === "semester" ? `Per semester${Number(sch.amount) > 0 ? ` (${formatPHP(yearlyAward(Number(sch.amount), "semester"))} a year)` : ""}`
                              : sch.release_schedule === "monthly" ? `Monthly for ${asMonths(sch.release_months)} months${Number(sch.amount) > 0 ? ` (${formatPHP(yearlyAward(Number(sch.amount), "monthly", sch.release_months))} a year)` : ""}`
                              : sch.release_schedule === "one_time" ? "One-time, no renewal"
                              : "Once a year"}</p>
                            {Number(sch.total_budget) > 0 && (() => {
                              const committed = committedFor(sch);
                              const pct = Math.min(100, Math.round((committed / Number(sch.total_budget)) * 100));
                              return (
                                <p className={`text-xs ${committed >= Number(sch.total_budget) ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                  {formatPHP(committed)} of {formatPHP(Number(sch.total_budget))} ({pct}%)
                                </p>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {sch.slots > 0 ? `${Math.max(sch.slots - approved, 0)} left of ${sch.slots}` : "Unlimited"}
                            {full && <Badge variant="secondary" className="ml-2">Full</Badge>}
                          </TableCell>
                          <TableCell>{applicantCount(sch.id)}</TableCell>
                          <TableCell className="text-sm">
                            {sch.open_date && <p className="text-xs text-muted-foreground">Opens {sch.open_date}</p>}
                            <p>{sch.deadline || "—"}{isClosed(sch) && <Badge variant="secondary" className="ml-2">Closed</Badge>}</p>
                          </TableCell>
                          <TableCell><Badge variant={sch.is_active ? "default" : "secondary"}>{sch.is_active ? "Active" : "Disabled"}</Badge></TableCell>
                          <TableCell className="text-right space-x-1">
                            {can.manage && <>
                            <Button size="icon" variant="ghost" title="Edit" onClick={() => { setSchActive(sch.is_active); setSchYearLevels(sch.year_levels ?? []); setSchBarangays(sch.barangays ?? []); setSchBarangaySearch(""); setSchDialog(sch); }}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" title="Duplicate for next year" onClick={() => duplicateScholarship(sch)}><Copy className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" title={sch.is_active ? "Disable" : "Enable"} onClick={() => toggleScholarship(sch)}>
                              {sch.is_active ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4 text-success" />}
                            </Button>
                            </>}
                            {can.super && <Button size="icon" variant="ghost" title="Delete" onClick={() => { setDeleteSchText(""); setDeleteSch(sch); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* STUDENTS */}
          {activeSection === "students" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Student Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Name, email, school, course, ID..." value={studentSearch} onChange={(e) => { setStudentSearch(e.target.value); setStudentPage(1); }} className="pl-9 w-64" />
                  </div>
                  <Select value={studentFilter} onValueChange={(v) => { setStudentFilter(v); setStudentPage(1); }}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All scholars</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={studentProgram} onValueChange={(v) => { setStudentProgram(v); setStudentPage(1); }}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All programs</SelectItem>
                      {scholarships.map((sch) => <SelectItem key={sch.id} value={sch.id}>{sch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={studentDisb} onValueChange={(v) => { setStudentDisb(v); setStudentPage(1); }}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All disbursements</SelectItem>
                      <SelectItem value="none">No payment yet</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Processing">Processing</SelectItem>
                      <SelectItem value="Disbursed">Disbursed</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={studentSort} onValueChange={setStudentSort}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name">Sort: Name</SelectItem>
                      <SelectItem value="grade">Sort: Grade</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={exportStudents}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
                </div>
              </div>
              {can.super && pendingDeletions.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Account deletion requests ({pendingDeletions.length})</CardTitle>
                    <CardDescription>Open each student to delete their account, or decline with a reason.</CardDescription>
                  </CardHeader>
                  <Table>
                    <TableBody>
                      {pendingDeletions.map(({ req, profile }) => (
                        <TableRow key={req.id}>
                          <TableCell>
                            <p className="font-medium">{profile ? personName(profile) : "Unknown student"}</p>
                            <p className="text-xs text-muted-foreground">{profile?.email ?? req.user_id}</p>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[320px]">{req.reason ? <span className="line-clamp-2" title={req.reason}>{req.reason}</span> : "No reason given"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">Requested {new Date(req.created_at).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" disabled={!profile} onClick={() => profile && setViewStudent(profile)}><Eye className="mr-1 h-4 w-4" /> Open</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Name</TableHead><TableHead>School / Course</TableHead><TableHead>Year</TableHead><TableHead>Grade</TableHead><TableHead title="Approved applications / total applications">Approved / Total</TableHead><TableHead>Program / Award</TableHead><TableHead>Reference No.</TableHead><TableHead>Disbursement</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagedStudents.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">{scholars.length === 0 ? "No scholars yet. Applicants appear here once approved." : "No scholars match your search"}</TableCell></TableRow>}
                    {pagedStudents.map((p) => { const pay = currentPayment(p.id); const apps = approvedApps(p.id); return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <p className="font-medium">{p.first_name} {p.last_name}</p><p className="text-xs text-muted-foreground">{p.email}</p>
                          <div className="mt-1 flex gap-1 flex-wrap">
                            {gradeReviews.some((g) => g.user_id === p.id && g.status === "Pending") && <Badge variant="secondary" className="text-[10px]">Grade to review</Badge>}
                            {dataReqs.some((r) => r.user_id === p.id && r.status === "Pending") && <Badge variant="destructive" className="text-[10px]">Deletion requested</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs"><p>{p.school_name || "—"}</p><p className="text-muted-foreground">{p.course || "—"}</p></TableCell>
                        <TableCell>{p.year_level || "—"}</TableCell>
                        <TableCell>{p.average_grade ?? "—"}</TableCell>
                        <TableCell>{apps.length} / {applications.filter((a) => a.user_id === p.id).length}</TableCell>
                        <TableCell className="text-xs">
                          {apps.length === 0 ? "—" : (<>
                            <p className="font-medium">{apps[0].scholarships?.name || "—"}{apps.length > 1 && <span className="text-muted-foreground font-normal"> +{apps.length - 1} more</span>}</p>
                            <p className="text-muted-foreground">{formatPHP(apps.reduce((t, a) => t + appAward(a), 0))}{disbursedTotal(p.id) > 0 && ` · ${formatPHP(disbursedTotal(p.id))} paid`}</p>
                          </>)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{pay?.reference || "—"}</TableCell>
                        <TableCell>{pay ? disbStatusBadge(pay.status) : <span className="text-xs text-muted-foreground">No payment</span>}</TableCell>
                        <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="icon" variant="ghost" title="View" onClick={() => setViewStudent(p)}><Eye className="h-4 w-4" /></Button>
                          {can.finance && <Button size="icon" variant="ghost" title="Edit reference number / disbursement status" onClick={() => openEditDisb(p)}><Pencil className="h-4 w-4" /></Button>}
                          {can.manage && <Button size="icon" variant="ghost" title={p.is_active ? "Deactivate" : "Activate"} onClick={() => toggleStudentActive(p)}>
                            <Power className={`h-4 w-4 ${p.is_active ? "text-destructive" : "text-success"}`} />
                          </Button>}
                        </TableCell>
                      </TableRow>
                    ); })}
                  </TableBody>
                </Table>
              </Card>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {filteredStudents.length === 0 ? "0 students" : `Showing ${(studentPage - 1) * STUDENT_PAGE_SIZE + 1}–${Math.min(studentPage * STUDENT_PAGE_SIZE, filteredStudents.length)} of ${filteredStudents.length}`}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={studentPage <= 1} onClick={() => setStudentPage((n) => n - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span>Page {Math.min(studentPage, studentPages)} of {studentPages}</span>
                  <Button size="sm" variant="outline" disabled={studentPage >= studentPages} onClick={() => setStudentPage((n) => n + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          )}

          {/* FUNDS */}
          {activeSection === "funds" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Fund Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <Select value={fundPeriod} onValueChange={setFundPeriod}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="year">This year</SelectItem>
                      <SelectItem value="6m">Last 6 months</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="custom">Custom range (set in Reports)</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Charts and the Fund Utilization export live in Reports; this page is the day-to-day view. */}
                  <Button variant="outline" onClick={() => setActiveSection("reports")}><BarChart3 className="mr-1 h-4 w-4" /> Charts &amp; exports</Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {fundData.pipeline.map((r) => (
                  <Card key={r.status}><CardContent className="py-5">
                    <p className="text-xs text-muted-foreground">{r.status === "Disbursed" ? "Total Disbursed" : r.status}</p>
                    <p className={`text-2xl font-bold font-display ${r.status === "Disbursed" ? "text-success" : r.status === "Processing" ? "text-primary" : "text-warning"}`}>{formatPHP(r.amount)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{r.count} payment{r.count === 1 ? "" : "s"}</p>
                  </CardContent></Card>
                ))}
              </div>


              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">By Scholarship Program</CardTitle></CardHeader>
                  <Table>
                    <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60"><TableHead>Program</TableHead><TableHead>Scholars</TableHead><TableHead>Disbursed</TableHead><TableHead>Queued</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {fundData.byProgram.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No programs</TableCell></TableRow>}
                      {fundData.byProgram.map((r) => (
                        <TableRow key={r.id}><TableCell className="font-medium">{r.name}</TableCell><TableCell>{r.scholars}</TableCell><TableCell>{formatPHP(r.disbursed)}</TableCell><TableCell className="text-muted-foreground">{formatPHP(r.queued)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">By Payment Method</CardTitle></CardHeader>
                  <Table>
                    <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60"><TableHead>Method</TableHead><TableHead>Payments</TableHead><TableHead>Amount</TableHead><TableHead>Share</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {fundData.byMethod.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No disbursements</TableCell></TableRow>}
                      {fundData.byMethod.map((r) => (
                        <TableRow key={r.method}><TableCell className="font-medium">{r.method}</TableCell><TableCell>{r.count}</TableCell><TableCell>{formatPHP(r.amount)}</TableCell><TableCell>{r.share}%</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">Recent Payments</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => setActiveSection("disbursement")}>Open Disbursement <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                  </CardHeader>
                  <Table>
                    <TableBody>
                      {fundData.recent.length === 0 && <TableRow><TableCell className="text-center py-6 text-muted-foreground">No payments</TableCell></TableRow>}
                      {fundData.recent.map((p) => {
                        const prof = profiles.find((x) => x.id === p.user_id);
                        return (
                          <TableRow key={p.id}>
                            <TableCell><p className="font-medium">{prof ? `${prof.first_name || ""} ${prof.last_name || ""}`.trim() : "Unknown"}</p><p className="text-xs text-muted-foreground">{p.method} · {p.reference || "no reference"}</p></TableCell>
                            <TableCell>{formatPHP(Number(p.amount))}</TableCell>
                            <TableCell className="text-right">{disbStatusBadge(p.status)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">Awaiting Payment ({awaitingPayment.length})</CardTitle>
                    {can.finance && <Button size="sm" variant="ghost" onClick={() => { openNewPayment(); setActiveSection("disbursement"); }}>Schedule payment <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>}
                  </CardHeader>
                  <Table>
                    <TableBody>
                      {awaitingPayment.length === 0 && <TableRow><TableCell className="text-center py-6 text-muted-foreground">Every approved award is fully scheduled</TableCell></TableRow>}
                      {awaitingPayment.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell><p className="font-medium">{a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "Unknown"}</p><p className="text-xs text-muted-foreground">{a.scholarships?.name || "—"}{scheduleOf(a) === "semester" && ` · ${openTermsOf(a).join(", ")}`}{scheduleOf(a) === "monthly" && openTermsOf(a).length > 0 && ` · next ${openTermsOf(a)[0]} (${openTermsOf(a).length} of ${monthsOf(a)} left)`}</p></TableCell>
                          <TableCell className="text-right">{can.finance && <Button size="sm" variant="outline" onClick={() => { openNewPayment(a.id); setActiveSection("disbursement"); }}>Schedule payment</Button>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            </div>
          )}

          {/* DISBURSEMENT */}
          {activeSection === "disbursement" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Disbursement Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Student, program, reference..." value={paySearch} onChange={(e) => { setPaySearch(e.target.value); setPayPage(1); }} className="pl-9 w-60" />
                  </div>
                  <Select value={payFilter} onValueChange={(v) => { setPayFilter(v); setPayPage(1); }}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All status</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Processing">Processing</SelectItem>
                      <SelectItem value="Disbursed">Disbursed</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                      <SelectItem value="receipts">Receipts to review</SelectItem>
                      <SelectItem value="issues">Open problems</SelectItem>
                    </SelectContent>
                  </Select>
                  {can.finance && <>
                  <Button variant="outline" onClick={() => {
                    // Start on the current semester, or the first month someone still needs when only monthly programs have scholars waiting.
                    const sem = parseSettings(systemSettings).current_semester;
                    const semTerm: PaymentTerm = sem === "2nd Semester" ? "2nd Semester" : "1st Semester";
                    const term = bulkCandidates(semTerm).length > 0 ? semTerm : bulkTerms.find((t) => isMonthTerm(t) && bulkCandidates(t).length > 0) ?? semTerm;
                    setBulkTerm(term); setBulkDate(defaultScheduledDate); setBulkPicked(new Set(bulkCandidates(term).filter((c) => !c.warning).map((c) => c.app.id))); setBulkOpen(true);
                  }}>Schedule payments in bulk</Button>
                  <Button className="bg-gradient-primary shadow-primary" onClick={() => openNewPayment()}><Plus className="mr-1 h-4 w-4" /> Schedule Payment</Button>
                  </>}
                </div>
              </div>
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-3 flex items-start gap-2">
                  <Lock className="h-4 w-4 text-warning mt-0.5" />
                  <p className="text-sm text-muted-foreground">Payments can only be created for <strong className="text-foreground">approved</strong> applications. Disbursed payments are <strong className="text-foreground">locked</strong>. Only the methods enabled in <strong className="text-foreground">Settings</strong> ({enabledMethods.join(" and ")}) are accepted, and a receipt upload is required before marking as disbursed.</p>
                </CardContent>
              </Card>
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Student</TableHead><TableHead>Reference / Cheque No.</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Student prefers</TableHead><TableHead>Scheduled</TableHead><TableHead>Status</TableHead><TableHead>Student receipt</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagedPayments.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No payments found</TableCell></TableRow>}
                    {pagedPayments.map((p) => {
                      const open = p.status === "Pending" || p.status === "Processing";
                      return (
                        <TableRow key={p.id} className={p.status === "Cancelled" ? "opacity-60" : undefined}>
                          <TableCell><p className="font-medium">{payStudent(p)}</p><p className="text-xs text-muted-foreground">{payProgram(p)}{termLabel(p.term, p.academic_year) && ` · ${termLabel(p.term, p.academic_year)}`}</p></TableCell>
                          <TableCell className="font-mono text-xs">{p.reference || "—"}</TableCell>
                          <TableCell className="font-medium">{formatPHP(p.amount)}</TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                              p.method === "Cheque" ? "bg-accent text-accent-foreground"
                              : p.method === "Cash" ? "bg-success/10 text-success"
                              : "bg-muted text-muted-foreground"
                            }`}>
                              {p.method || "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {p.preferred_method ? (
                              <Badge variant={p.preferred_method === p.method ? "default" : "secondary"} title="Chosen by the student — the payment method is fixed">
                                {p.preferred_method}
                              </Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>{p.scheduled_date || "—"}</TableCell>
                          <TableCell>{disbStatusBadge(p.status)}</TableCell>
                          <TableCell>
                            {p.status !== "Disbursed" ? <span className="text-muted-foreground">—</span>
                              : p.student_receipt_at ? (
                                <div className="space-y-1">
                                  {p.student_receipt_ref ? (
                                    <div className="space-y-0.5">
                                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                        <CheckCircle className="h-3.5 w-3.5" /> Ref. <span className="font-mono">{p.student_receipt_ref}</span> · {new Date(p.student_receipt_at).toLocaleDateString()}
                                      </span>
                                      {receiptNos[p.id] ? (
                                        refKey(receiptNos[p.id]) === refKey(p.student_receipt_ref)
                                          ? <p className="text-[11px] text-success">Matches the receipt number{p.receipt_review_status === "Accepted" && !p.receipt_reviewed_by ? " · accepted automatically" : ""}</p>
                                          : <p className="text-[11px] text-destructive">Doesn&apos;t match receipt no. <span className="font-mono">{receiptNos[p.id]}</span></p>
                                      ) : p.reference && (
                                        refKey(p.reference) === refKey(p.student_receipt_ref)
                                          ? <p className="text-[11px] text-success">Matches the payment reference</p>
                                          : <p className="text-[11px] text-muted-foreground">Payment reference: <span className="font-mono">{p.reference}</span></p>
                                      )}
                                    </div>
                                  ) : p.student_receipt_path ? (
                                    <button type="button" onClick={() => viewStudentReceipt(p)} className="inline-flex items-center gap-1 text-xs font-medium text-success hover:underline cursor-pointer">
                                      <CheckCircle className="h-3.5 w-3.5" /> Received · {new Date(p.student_receipt_at).toLocaleDateString()}
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success" title="Student confirmed receiving the cash without a receipt number (before reference numbers were required)">
                                      <CheckCircle className="h-3.5 w-3.5" /> Confirmed (no file) · {new Date(p.student_receipt_at).toLocaleDateString()}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant={p.receipt_review_status === "Accepted" ? "default" : "secondary"} className={p.receipt_review_status === "Disapproved" ? "text-destructive" : undefined}>
                                      {p.receipt_review_status === "Pending" ? "To review" : p.receipt_review_status}
                                    </Badge>
                                    {p.receipt_review_status !== "Accepted" && can.finance && (
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={payBusy} onClick={() => reviewReceipt(p, "Accepted")}>Accept</Button>
                                    )}
                                    {p.receipt_review_status !== "Disapproved" && can.finance && (
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-destructive" disabled={payBusy} onClick={() => { setReceiptNote(""); setDisapproveReceipt(p); }}>Disapprove</Button>
                                    )}
                                  </div>
                                  {p.receipt_review_status === "Disapproved" && p.receipt_review_note && <p className="text-xs text-destructive">{p.receipt_review_note}</p>}
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <Badge variant="secondary">Awaiting</Badge>
                                  {receiptNos[p.id] && <p className="text-[11px] text-muted-foreground">Receipt no. <span className="font-mono">{receiptNos[p.id]}</span></p>}
                                </div>
                              )}
                          </TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            {payIssues.some((i) => i.payment_id === p.id) && (
                              <Button size="icon" variant="ghost" title={openIssueFor(p.id) ? "Open problem reported by the student" : "Problem reports"} onClick={() => { setIssueResponse(""); setIssueDialog(p); }}>
                                <AlertTriangle className={`h-4 w-4 ${openIssueFor(p.id) ? "text-warning" : "text-muted-foreground"}`} />
                              </Button>
                            )}
                            {p.status !== "Cancelled" && receiptNos[p.id] && can.finance && (
                              <Button size="icon" variant="ghost" title={`Print acknowledgment slip (${receiptNos[p.id]})`} onClick={() => printSlip(p)}><Printer className="h-4 w-4" /></Button>
                            )}
                            {p.status === "Disbursed" && (
                              <Button size="icon" variant="ghost" title="View receipt" onClick={() => viewReceipt(p)}><Receipt className="h-4 w-4" /></Button>
                            )}
                            {open && can.finance && (<>
                              <Button size="icon" variant="ghost" title="Edit" onClick={() => { setPayMethod((p.preferred_method ?? p.method) === "Cheque" ? "Cheque" : "Cash"); setPayTerm((p.term as PaymentTerm | null) ?? null); setPayDialog(p); }}><Pencil className="h-4 w-4" /></Button>
                              {p.status === "Pending" && (
                                <Button size="sm" variant="outline" disabled={savingPay} onClick={() => setPaymentStatus(p, "Processing")}>Process</Button>
                              )}
                              <Button size="sm" onClick={() => {
                                setDisbPaymentId(p.id);
                                setDisbMethod((p.preferred_method ?? p.method) === "Cheque" ? "Cheque" : "Cash");
                                setDisbRef(p.reference || "");
                                setDisbReceipt(null);
                                setDisbDialog(true);
                              }}>
                                Mark Disbursed
                              </Button>
                              <Button size="icon" variant="ghost" title="Cancel payment" onClick={() => { setCancelReason(""); setCancelPay(p); }}><XCircle className="h-4 w-4 text-destructive" /></Button>
                            </>)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{filteredPayments.length === 0 ? "0 payments" : `Showing ${(currentPayPage - 1) * PAY_PAGE_SIZE + 1}–${Math.min(currentPayPage * PAY_PAGE_SIZE, filteredPayments.length)} of ${filteredPayments.length}`}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={currentPayPage <= 1} onClick={() => setPayPage(currentPayPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span>Page {currentPayPage} of {payPages}</span>
                  <Button size="sm" variant="outline" disabled={currentPayPage >= payPages} onClick={() => setPayPage(currentPayPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Create / edit payment dialog */}
              {(() => {
                const cur = payDialog && payDialog !== "new" ? payDialog : null;
                const payApp = applications.find((a) => a.id === (cur ? cur.application_id : payAppId));
                const payWarning = payApp ? gradeWarningFor(payApp, payTerm) : null;
                return (
                  <AppDialog open={payDialog !== null} onOpenChange={(o) => !o && setPayDialog(null)} size="md"
                    title={cur ? "Edit Payment" : "Schedule Payment"}
                    description={cur ? `${payStudent(cur)} · ${payProgram(cur)}` : "For an approved scholar. The student is notified."}
                    onSubmit={savePayment} formKey={cur?.id ?? `new-${payAppId}`}
                    footer={<>
                      <Button type="button" variant="outline" onClick={() => setPayDialog(null)}>Cancel</Button>
                      <Button type="submit" className="bg-gradient-primary" disabled={savingPay || (!cur && !payAppId)}>{cur ? "Save Changes" : "Schedule Payment"}</Button>
                    </>}>
                    {!cur && (
                      <DialogField label="Scholar">
                        <Select value={payAppId} onValueChange={(v) => { setPayAppId(v); setPayTerm(defaultTermFor(v)); }}>
                          <SelectTrigger><SelectValue placeholder={awaitingPayment.length ? "Select an approved scholar" : "No approved scholars awaiting payment"} /></SelectTrigger>
                          <SelectContent>
                            {awaitingPayment.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "Unknown"} — {a.scholarships?.name || "—"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </DialogField>
                    )}
                    {payApp && (
                      <DialogField label="Period">
                        <div role="radiogroup" aria-label="Period" className={`grid gap-3 ${scheduleOf(payApp) === "monthly" ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2"}`}>
                          {termsOf(payApp).map((t) => {
                            const taken = t !== cur?.term && !openTermsOf(payApp).includes(t);
                            return (
                              <ChoiceButton key={t} selected={payTerm === t} disabled={taken || cur?.status === "Disbursed"} onClick={() => setPayTerm(t)}>
                                {t === "Yearly" ? `Whole year${payApp.academic_year ? ` ${payApp.academic_year}` : ""}` : t}{taken && " · scheduled"}
                              </ChoiceButton>
                            );
                          })}
                        </div>
                      </DialogField>
                    )}
                    {payWarning && (
                      <DialogNote tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{payWarning}. You can still schedule this payment if the office approves it.</DialogNote>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <DialogField label="Amount (₱)" htmlFor="pay-amount">
                        <MoneyInput id="pay-amount" key={cur?.id ?? `${payAppId}-${payTerm}`} name="amount" min={0.01} required defaultValue={cur?.amount ?? (payApp ? termDefaultAmount(payApp) : "")} />
                      </DialogField>
                      <DialogField label="Scheduled date" htmlFor="pay-date">
                        <Input id="pay-date" name="scheduled_date" type="date" defaultValue={cur ? (cur.scheduled_date ?? "") : defaultScheduledDate} />
                      </DialogField>
                    </div>
                    <DialogField label="Method" hint={cur?.preferred_method ? `The student chose ${cur.preferred_method}, so the method is fixed.` : undefined}>
                      <div role="radiogroup" aria-label="Method" className="grid grid-cols-2 gap-3">
                        {enabledMethods.map((m) => (
                          <ChoiceButton key={m} selected={payMethod === m} disabled={!!cur?.preferred_method} onClick={() => setPayMethod(m)}>
                            {m === "Cash" ? <Banknote className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}{m}
                          </ChoiceButton>
                        ))}
                      </div>
                    </DialogField>
                    <DialogField label={payMethod === "Cheque" ? "Cheque number" : "Reference number"} htmlFor="pay-ref" hint={payMethod === "Cheque" ? "Optional now; required before the cheque is disbursed." : "Optional."}>
                      <Input id="pay-ref" name="reference" defaultValue={cur?.reference ?? ""} placeholder={payMethod === "Cheque" ? "e.g. CHK-2026-001" : "e.g. REF-001"} />
                    </DialogField>
                    <DialogField label="Notes" htmlFor="pay-notes" hint="Optional. Staff only.">
                      <Textarea id="pay-notes" name="notes" rows={2} defaultValue={cur?.notes ?? ""} />
                    </DialogField>
                  </AppDialog>
                );
              })()}

              {/* Schedule one semester's or one month's payments for every eligible scholar */}
              {(() => {
                const list = bulkOpen ? bulkCandidates(bulkTerm) : [];
                const picked = list.filter((c) => bulkPicked.has(c.app.id));
                const pickDefaults = (t: PaymentTerm) => setBulkPicked(new Set(bulkCandidates(t).filter((c) => !c.warning).map((c) => c.app.id)));
                return (
                  <AppDialog open={bulkOpen} onOpenChange={setBulkOpen} size="lg"
                    title="Schedule payments in bulk"
                    description={isMonthTerm(bulkTerm)
                      ? `Approved scholars of monthly programs in A.Y. ${currentAY} who don't have a ${bulkTerm} payment yet. Each gets their award divided by their program's number of months.`
                      : `Approved scholars of per-semester programs in A.Y. ${currentAY} who don't have a ${bulkTerm} payment yet. Each gets half of their yearly award.`}
                    footer={<>
                      <p className="w-full self-center text-sm text-muted-foreground sm:mr-auto sm:w-auto">{picked.length} selected · {formatPHP(picked.reduce((t, c) => t + c.amount, 0))}</p>
                      <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
                      <Button className="bg-gradient-primary" disabled={bulkPayBusy || picked.length === 0} onClick={scheduleBulk}>
                        {bulkPayBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Schedule {picked.length} payment{picked.length === 1 ? "" : "s"}
                      </Button>
                    </>}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <DialogField label="Period">
                        <Select value={bulkTerm} onValueChange={(v) => { setBulkTerm(v as PaymentTerm); pickDefaults(v as PaymentTerm); }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectGroup><SelectLabel>Per-semester programs</SelectLabel>
                              {bulkTerms.filter((t) => !isMonthTerm(t)).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectGroup>
                            <SelectGroup><SelectLabel>Monthly programs</SelectLabel>
                              {bulkTerms.filter(isMonthTerm).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </DialogField>
                      <DialogField label="Scheduled date" htmlFor="bulk-date">
                        <Input id="bulk-date" type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
                      </DialogField>
                    </div>
                    {bulkTerm === "2nd Semester" && (
                      <DialogNote icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />}>
                        Scholars without a verified 1st-semester grade that meets the minimum are left unticked. Tick them to pay anyway.
                      </DialogNote>
                    )}
                    <DialogSection title={`Scholars (${list.length})`} action={list.length > 0 && (
                      <button type="button" className="text-xs font-medium text-primary hover:underline cursor-pointer"
                        onClick={() => setBulkPicked(picked.length === list.length ? new Set() : new Set(list.map((c) => c.app.id)))}>
                        {picked.length === list.length ? "Clear all" : "Select all"}
                      </button>
                    )}>
                      <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
                        {list.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No scholars need a {bulkTerm} payment.</p>}
                        {list.map((c) => (
                          <label key={c.app.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/40">
                            <Checkbox className="mt-0.5 rounded-[4px]" checked={bulkPicked.has(c.app.id)}
                              onCheckedChange={(v) => setBulkPicked((prev) => { const n = new Set(prev); if (v) n.add(c.app.id); else n.delete(c.app.id); return n; })} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">
                                {c.app.profiles ? `${c.app.profiles.first_name || ""} ${c.app.profiles.last_name || ""}`.trim() : "Unknown"}
                                <span className="text-xs font-normal text-muted-foreground"> · {c.app.scholarships?.name || "—"}</span>
                              </p>
                              {c.warning
                                ? <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> {c.warning}</p>
                                : bulkTerm === "2nd Semester" && <p className="text-xs text-muted-foreground">1st-semester grade verified</p>}
                            </div>
                            <p className="text-sm font-medium tabular-nums">{formatPHP(c.amount)}</p>
                          </label>
                        ))}
                      </div>
                    </DialogSection>
                  </AppDialog>
                );
              })()}

              {/* Cancel confirmation */}
              <ReasonDialog open={!!cancelPay} onClose={() => setCancelPay(null)}
                title="Cancel this payment?"
                description={cancelPay ? `${formatPHP(cancelPay.amount)} for ${payStudent(cancelPay)} is cancelled and the student notified. This can't be undone, but you can schedule a new payment.` : undefined}
                label="Reason" hint="Optional. Shown to the student." rows={2} maxLength={300} required={false}
                placeholder="e.g. Rescheduled to next month."
                value={cancelReason} onChange={setCancelReason}
                cancelLabel="Keep payment" confirmLabel="Cancel payment"
                onConfirm={async () => { if (cancelPay && await setPaymentStatus(cancelPay, "Cancelled", cancelReason)) setCancelPay(null); }} />

            </div>
          )}

          {/* REPORTS */}
          {activeSection === "reports" && (
            <ReportsPanel
              data={{ applications, scholarships, profiles, staff, payments, payIssues, gradeUpdates: gradeReviews, dataRequests: dataReqs, documents: allDocs }}
              settings={parseSettings(systemSettings)} adminEmail={adminEmail}
              period={fundPeriod} setPeriod={setFundPeriod} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate}
              office={myOffice ? OFFICE_LABEL[myOffice] : viewingOffice ? (isOffice(officeView) ? OFFICE_LABEL[officeView] : "Mayor Office programs") : null}
            />
          )}

          {/* NOTIFICATIONS */}
          {activeSection === "notifications" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Notifications</h2>
              <NotificationInbox notifications={notifications} setNotifications={setNotifications} onNavigate={goToLink}
                userId={adminUserId} unreadTotal={unreadTotal} onUnreadChange={refreshAdminUnread} />
              {can.manage && <AnnouncementsPanel />}
              <Card>
                <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle><CardDescription>Choose what reaches you in the dashboard and by email.</CardDescription></CardHeader>
                <CardContent>
                  <NotificationPreferences userId={adminUserId} email={adminEmail} categories={[
                    { key: "application", label: "Applications", hint: "New applications submitted" },
                    { key: "payment", label: "Payments", hint: "Receipts, method choices and unpaid approvals" },
                  ]} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* SETTINGS */}
          {/* AUDIT LOGS */}
          {activeSection === "audit-logs" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Audit Logs</h2>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" disabled={exportingAudit || auditQuery.count === 0} onClick={() => exportAudit("pdf")}>{exportingAudit ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} PDF</Button>
                  <Button variant="outline" disabled={exportingAudit || auditQuery.count === 0} onClick={() => exportAudit("xlsx")}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="User, action, entity, ID..." value={auditSearch} onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1); }} className="pl-9 w-56" />
                </div>
                <Select value={auditAction} onValueChange={(v) => { setAuditAction(v); setAuditPage(1); }}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {auditActions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={auditEntity} onValueChange={(v) => { setAuditEntity(v); setAuditPage(1); }}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All entities</SelectItem>
                    {auditEntities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={auditUser} onValueChange={(v) => { setAuditUser(v); setAuditPage(1); }}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All staff</SelectItem>
                    {staff.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} · {staffLabel(m.role, m.office)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" value={auditFrom} onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(1); }} className="w-40" aria-label="From date" />
                <Input type="date" value={auditTo} onChange={(e) => { setAuditTo(e.target.value); setAuditPage(1); }} className="w-40" aria-label="To date" />
                {(auditSearch || auditAction !== "all" || auditEntity !== "all" || auditUser !== "all" || auditFrom || auditTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setAuditSearch(""); setAuditAction("all"); setAuditEntity("all"); setAuditUser("all"); setAuditFrom(""); setAuditTo(""); setAuditPage(1); }}>Clear</Button>
                )}
              </div>
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Changed</TableHead><TableHead className="text-right">Details</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagedLogs.length === 0 && auditQuery.loading && Array.from({ length: 6 }, (_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">{[28, 36, 24, 20, 32, 12].map((w, j) => <TableCell key={j}><Skeleton className={`h-4 ${j === 5 ? "ml-auto " : ""}`} style={{ width: `${w * 4}px` }} /></TableCell>)}</TableRow>
                    ))}
                    {pagedLogs.length === 0 && !auditQuery.loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {auditQuery.error ? `Couldn't load the audit log: ${auditQuery.error}` : "No audit logs found"}
                    </TableCell></TableRow>}
                    {pagedLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</TableCell>
                        <TableCell className="text-sm">{log.user_email || "System"}</TableCell>
                        <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                        <TableCell className="text-xs">{log.entity_type}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">{Object.keys({ ...asObj(log.previous_value), ...asObj(log.new_value) }).join(", ") || "—"}</TableCell>
                        <TableCell className="text-right"><Button size="icon" variant="ghost" title="View details" onClick={() => setViewLog(log)}><Eye className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{auditQuery.count === 0 ? "0 entries" : `Showing ${((currentAuditPage - 1) * AUDIT_PAGE_SIZE + 1).toLocaleString()}–${Math.min(currentAuditPage * AUDIT_PAGE_SIZE, auditQuery.count).toLocaleString()} of ${auditQuery.count.toLocaleString()}`}{auditQuery.loading && pagedLogs.length > 0 && " · updating…"}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={currentAuditPage <= 1} onClick={() => setAuditPage(currentAuditPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span>Page {currentAuditPage} of {auditPages}</span>
                  <Button size="sm" variant="outline" disabled={currentAuditPage >= auditPages} onClick={() => setAuditPage(currentAuditPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>

              <AppDialog open={!!viewLog} onOpenChange={(o) => !o && setViewLog(null)} size="lg"
                title="Audit entry"
                description={viewLog ? new Date(viewLog.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "medium" }) : undefined}
                footer={<Button variant="outline" onClick={() => setViewLog(null)}>Close</Button>}>
                {viewLog && (() => {
                  const prev = asObj(viewLog.previous_value);
                  const next = asObj(viewLog.new_value);
                  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
                  return (<>
                    <DetailGrid>
                      <Detail label="User">{viewLog.user_email || "System"}</Detail>
                      <Detail label="Action"><span className="font-mono text-xs">{viewLog.action}</span></Detail>
                      <Detail label="Record type">{viewLog.entity_type}</Detail>
                      <Detail label="Record ID"><span className="font-mono text-xs break-all">{viewLog.entity_id || "—"}</span></Detail>
                      {viewLog.user_agent && <Detail label="Device" wide><span className="text-xs font-normal text-muted-foreground break-all">{viewLog.user_agent}</span></Detail>}
                    </DetailGrid>
                    <DialogSection title="Changes">
                      {keys.length === 0 ? <p className="text-sm text-muted-foreground">No values recorded</p> : (
                        <div className="overflow-x-auto rounded-lg border">
                          <Table>
                            <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60"><TableHead>Field</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {keys.map((k) => (
                                <TableRow key={k}>
                                  <TableCell className="font-mono text-xs">{k}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground break-all">{fmtVal(prev[k])}</TableCell>
                                  <TableCell className={`text-xs break-all ${fmtVal(prev[k]) !== fmtVal(next[k]) ? "font-semibold" : "text-muted-foreground"}`}>{fmtVal(next[k])}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </DialogSection>
                  </>);
                })()}
              </AppDialog>
            </div>
          )}

          {/* ADMIN PROFILE */}
          {activeSection === "profile" && (
            <AdminProfilePanel
              profile={adminProfile}
              email={adminEmail}
              userId={adminUserId}
              role={adminRole}
              office={adminOffice}
              auditLogs={auditLogs}
              logAudit={logAudit}
              onChanged={() => loadData(true)}
            />
          )}

          {/* STAFF (the Mayor Office, or an office Admin for their own office) */}
          {activeSection === "staff" && (canManageSettings || managedOffice) && (
            <StaffPanel userId={adminUserId} onChanged={() => loadData(true)} managerOffice={canManageSettings ? null : managedOffice}
              onShowActivity={(id) => { setAuditUser(id); setAuditPage(1); setActiveSection("audit-logs"); }} />
          )}

          {/* SETTINGS */}
          {activeSection === "settings" && (
            <div className="space-y-4">
              <SettingsPanel rows={systemSettings} onSave={saveSettings} readOnly={!canManageSettings}
                onShowHistory={() => { setAuditSearch(""); setAuditAction("all"); setAuditUser("all"); setAuditFrom(""); setAuditTo(""); setAuditEntity("system_settings"); setAuditPage(1); setActiveSection("audit-logs"); }} />
              {can.manage && <ReminderJobsCard />}
            </div>
          )}
        </main>
      </div>

      {/* Student Management: edit reference number / disbursement status */}
      {(() => {
        const list = editDisb ? studentPayments(editDisb.id) : [];
        const pm = list.find((x) => x.id === editDisbPayId);
        const locked = pm?.status === "Disbursed" || pm?.status === "Cancelled";
        return (
          <AppDialog open={!!editDisb} onOpenChange={(o) => !o && setEditDisb(null)} size="md"
            title="Edit Disbursement"
            description={editDisb ? `${editDisb.first_name || ""} ${editDisb.last_name || ""}`.trim() || editDisb.email : undefined}
            footer={<>
              <Button variant="outline" onClick={() => setEditDisb(null)}>{locked || list.length === 0 ? "Close" : "Cancel"}</Button>
              {list.length > 0 && !locked && (
                <Button className="bg-gradient-primary" disabled={payBusy || !pm} onClick={saveEditDisb}>
                  {payBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {editDisbStatus === "Disbursed" ? "Continue" : "Save Changes"}
                </Button>
              )}
            </>}>
            {editDisb && (list.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">This scholar has no payment yet. Schedule one first, then set its reference number and status.</p>
                <Button variant="outline" onClick={() => {
                  const app = awaitingPayment.find((a) => a.user_id === editDisb.id);
                  setEditDisb(null); openNewPayment(app?.id ?? ""); setActiveSection("disbursement");
                }}>Schedule payment <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
              </div>
            ) : (<>
              {list.length > 1 ? (
                <DialogField label="Payment">
                  <Select value={editDisbPayId} onValueChange={(id) => selectEditDisbPayment(list.find((x) => x.id === id))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {list.map((x) => (
                        <SelectItem key={x.id} value={x.id}>{payProgram(x)}{x.term ? ` · ${termLabel(x.term, x.academic_year)}` : ""} · {formatPHP(Number(x.amount))} · {x.status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DialogField>
              ) : pm && (
                <DetailGrid>
                  <Detail label="Program">{payProgram(pm)}</Detail>
                  <Detail label="Amount">{formatPHP(Number(pm.amount))}</Detail>
                  <Detail label="Method">{pm.method || "—"}</Detail>
                  <Detail label="Period">{termLabel(pm.term, pm.academic_year) || "—"}</Detail>
                </DetailGrid>
              )}
              <DialogField label={pm?.method === "Cheque" ? "Cheque number" : "Reference number"} htmlFor="edit-disb-ref">
                <Input id="edit-disb-ref" value={editDisbRef} onChange={(e) => setEditDisbRef(e.target.value)} disabled={locked} placeholder={pm?.method === "Cheque" ? "e.g. CHK-2026-001" : "e.g. REF-001"} />
              </DialogField>
              <DialogField label="Disbursement status"
                hint={!locked && editDisbStatus === "Disbursed" ? "Next, you'll upload the signed receipt or voucher to confirm the disbursement." : undefined}>
                <Select value={editDisbStatus} onValueChange={setEditDisbStatus} disabled={locked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {pm?.status === "Pending" && <SelectItem value="Pending">Pending</SelectItem>}
                    <SelectItem value="Processing">Processing</SelectItem>
                    <SelectItem value="Disbursed">Disbursed</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </DialogField>
              {locked && <DialogNote icon={<Lock className="h-3.5 w-3.5" />}>{pm?.status} payments are locked and can&apos;t be edited.</DialogNote>}
              {!locked && editDisbStatus === "Cancelled" && (
                <DialogField label="Cancellation reason" htmlFor="edit-disb-reason" hint="Optional. Shown to the student.">
                  <Textarea id="edit-disb-reason" rows={2} maxLength={300} value={editDisbReason} onChange={(e) => setEditDisbReason(e.target.value)} />
                </DialogField>
              )}
            </>))}
          </AppDialog>
        );
      })()}

      {/* Disburse dialog */}
      <AppDialog open={disbDialog} onOpenChange={setDisbDialog} size="md"
        title="Confirm Disbursement"
        description={disbPay ? `${payStudent(disbPay)} · ${formatPHP(Number(disbPay.amount))}${disbPay.term ? ` · ${termLabel(disbPay.term, disbPay.academic_year)}` : ""}` : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setDisbDialog(false)}>Cancel</Button>
          <Button className="bg-gradient-primary" disabled={disbLoading || !disbReceipt || (disbMethod === "Cheque" && !disbRef.trim())} onClick={confirmDisbursement}>
            {disbLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirm Disbursement
          </Button>
        </>}>
        <DialogField label="Payment method" hint={disbLocked ? `The student chose ${disbPay?.preferred_method} for this payment, so the method is fixed.` : undefined}>
          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-3">
            {enabledMethods.map((m) => (
              <ChoiceButton key={m} selected={disbMethod === m} disabled={disbLocked} onClick={() => { setDisbMethod(m); setDisbRef(""); }}>
                {m === "Cash" ? <Banknote className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}{m}
              </ChoiceButton>
            ))}
          </div>
        </DialogField>
        <DialogField label={disbMethod === "Cheque" ? "Cheque number" : "Reference number"} htmlFor="disb-ref" hint={disbMethod === "Cheque" ? "Required for cheques." : "Optional."}>
          <Input id="disb-ref" placeholder={disbMethod === "Cheque" ? "e.g. CHK-2026-001" : "e.g. REF-001"} value={disbRef} onChange={(e) => setDisbRef(e.target.value)} />
        </DialogField>
        {disbPay && receiptNos[disbPay.id] && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Receipt No.</p>
                <p className="font-mono text-sm font-semibold">{receiptNos[disbPay.id]}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => printSlip(disbPay, disbMethod, disbRef.trim() || null)}>
                <Printer className="mr-1 h-3.5 w-3.5" /> Print slip
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Print the acknowledgment slip, have the student sign both copies and give them the student copy. They enter this number in the portal to confirm they received the money.</p>
          </div>
        )}
        <DialogField label="Signed receipt or voucher" hint="Upload the signed acknowledgment slip (office copy) or the disbursement voucher. PDF, JPG or PNG.">
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 transition-colors hover:bg-muted/30 ${disbReceipt ? "border-primary/40 bg-primary/5" : ""}`}>
            <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className={`min-w-0 truncate text-sm ${disbReceipt ? "font-medium text-foreground" : "text-muted-foreground"}`}>
              {disbReceipt ? disbReceipt.name : "Choose a file"}
            </span>
            {disbReceipt && <span className="ml-auto shrink-0 text-xs text-primary">Change</span>}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setDisbReceipt(e.target.files?.[0] ?? null)} />
          </label>
        </DialogField>
      </AppDialog>

      <AppDialog open={!!viewStudent} onOpenChange={(open) => !open && setViewStudent(null)} size="lg"
        title="Student Details"
        description={viewStudent ? `${`${viewStudent.first_name || ""} ${viewStudent.last_name || ""}`.trim() || viewStudent.email}` : undefined}
        footer={viewStudent && <>
          {can.manage && (
            <div className="flex gap-2 sm:mr-auto">
              <Button variant={viewStudent.is_active ? "outline" : "default"} className={viewStudent.is_active ? "text-destructive" : ""} onClick={() => toggleStudentActive(viewStudent)}>
                <Power className="mr-1 h-4 w-4" /> {viewStudent.is_active ? "Deactivate account" : "Activate account"}
              </Button>
              <StudentAccountActions
                student={{ id: viewStudent.id, name: `${viewStudent.first_name || ""} ${viewStudent.last_name || ""}`.trim() || viewStudent.email || "this student", email: viewStudent.email }}
                canDelete={can.super}
                disbursedPayments={studentPayments(viewStudent.id).filter((pm) => pm.status === "Disbursed").length}
                requestId={dataReqs.find((r) => r.user_id === viewStudent.id && r.status === "Pending")?.id}
                onDeleted={() => { setViewStudent(null); loadData(); }} />
            </div>
          )}
          <Button variant="outline" onClick={() => setViewStudent(null)}>Close</Button>
        </>}>
          {viewStudent && (() => {
            const stuApps = applications.filter((a) => a.user_id === viewStudent.id);
            const field = (label: string, value: React.ReactNode) => <Detail label={label}>{value || "—"}</Detail>;
            return (
              <div className="space-y-5">
                <DetailGrid>
                  {field("Name", `${viewStudent.first_name || ""} ${viewStudent.middle_name || ""} ${viewStudent.last_name || ""}`.replace(/\s+/g, " ").trim())}
                  {field("Email", viewStudent.email)}
                  {field("Phone", viewStudent.phone)}
                  {field("Sex · Civil status", [viewStudent.sex, viewStudent.civil_status].filter(Boolean).join(" · "))}
                  {field("Date of birth", viewStudent.dob)}
                  {field("Nationality", viewStudent.nationality)}
                  {field("Address", [viewStudent.street_address, viewStudent.barangay, viewStudent.municipality, viewStudent.province, viewStudent.zip_code].filter(Boolean).join(", "))}
                  {field("Guardian", [viewStudent.guardian_name, viewStudent.guardian_relationship && `(${viewStudent.guardian_relationship})`].filter(Boolean).join(" "))}
                  {field("Guardian phone", viewStudent.guardian_phone)}
                  {field("School", viewStudent.school_name)}
                  {field("Course", viewStudent.course)}
                  {field("Year Level", viewStudent.year_level)}
                  {field("Average Grade", viewStudent.average_grade != null ? (
                    <span className="inline-flex items-center gap-2">{viewStudent.average_grade}
                      <Badge variant={viewStudent.grade_verified_at ? "default" : "secondary"}>{viewStudent.grade_verified_at ? `Verified${viewStudent.grade_term ? ` · ${viewStudent.grade_term}` : ""}` : "Self-declared"}</Badge>
                    </span>) : null)}
                  {field("Account", <Badge variant={viewStudent.is_active ? "default" : "secondary"}>{viewStudent.is_active ? "Active" : "Inactive"}</Badge>)}
                </DetailGrid>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">Applications ({stuApps.length})</h3>
                  {stuApps.length === 0 ? <p className="text-sm text-muted-foreground">No applications</p> : (
                    <ul className="space-y-1.5">
                      {stuApps.map((a) => (
                        <li key={a.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                          <span>{a.scholarships?.name || "—"} <span className="text-xs text-muted-foreground">· {new Date(a.created_at).toLocaleDateString()}</span></span>
                          {statusBadge(a.status)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {(() => {
                  const pays = studentPayments(viewStudent.id);
                  return (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Payments ({pays.length}){pays.length > 0 && <span className="font-normal text-muted-foreground"> · {formatPHP(disbursedTotal(viewStudent.id))} disbursed</span>}</h3>
                        {can.finance && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const v = viewStudent; setViewStudent(null); openEditDisb(v); }}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit disbursement
                        </Button>}
                      </div>
                      {pays.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet</p> : (
                        <ul className="space-y-1.5">
                          {pays.map((pm) => (
                            <li key={pm.id} className="rounded-md border px-3 py-1.5 text-sm">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span>
                                  <span className="font-medium">{formatPHP(Number(pm.amount))}</span> · {payProgram(pm)}
                                  <span className="text-xs text-muted-foreground"> · {pm.method || "—"} · Ref: <span className="font-mono">{pm.reference || "—"}</span></span>
                                </span>
                                <span className="flex items-center gap-1.5">
                                  {pm.status === "Disbursed" && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => viewReceipt(pm)}><Receipt className="mr-1 h-3.5 w-3.5" /> Receipt</Button>
                                  )}
                                  {disbStatusBadge(pm.status)}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {pm.status === "Disbursed" && pm.disbursed_at ? `Disbursed ${new Date(pm.disbursed_at).toLocaleDateString()}` : pm.scheduled_date ? `Scheduled ${pm.scheduled_date}` : `Created ${new Date(pm.created_at).toLocaleDateString()}`}
                                {pm.status === "Disbursed" && ` · Student receipt: ${pm.student_receipt_at ? pm.receipt_review_status : "awaiting"}`}
                                {pm.status === "Cancelled" && pm.cancel_reason && ` · ${pm.cancel_reason}`}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}
                {(() => {
                  const grades = gradeReviews.filter((g) => g.user_id === viewStudent.id);
                  if (grades.length === 0) return null;
                  return (
                    <div>
                      <h3 className="mb-1.5 text-sm font-semibold">Grade submissions</h3>
                      <ul className="space-y-1.5">
                        {grades.map((g) => (
                          <li key={g.id} className="rounded-md border px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span><span className="font-medium">{g.grade}</span> · {g.term} · {new Date(g.created_at).toLocaleDateString()}</span>
                              <span className="flex items-center gap-1.5">
                                <Badge variant={g.status === "Verified" ? "default" : "secondary"} className={g.status === "Disapproved" ? "text-destructive" : undefined}>{g.status}</Badge>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openStoredFile(g.file_path, "No grade report on file")}>View report</Button>
                                {g.status === "Pending" && can.review && (<>
                                  <Button size="sm" className="h-7 text-xs" disabled={payBusy} onClick={() => reviewGrade(g, "Verified")}>Verify</Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={payBusy} onClick={() => { setGradeNote(""); setDisapproveGrade(g); }}>Disapprove</Button>
                                </>)}
                              </span>
                            </div>
                            {g.status === "Disapproved" && g.review_note && <p className="mt-1 text-xs text-destructive">Reason: {g.review_note}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                {(() => {
                  const reqs = dataReqs.filter((r) => r.user_id === viewStudent.id);
                  if (reqs.length === 0) return null;
                  return (
                    <div>
                      <h3 className="mb-1.5 text-sm font-semibold">Privacy requests</h3>
                      <ul className="space-y-1.5">
                        {reqs.map((r) => (
                          <li key={r.id} className={`rounded-md border px-3 py-2 text-sm ${r.status === "Pending" ? "border-warning/40 bg-warning/5" : ""}`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-medium">Account deletion · {r.status} <span className="font-normal text-muted-foreground">· {new Date(r.created_at).toLocaleDateString()}</span></span>
                              {r.status === "Pending" && !can.super && <span className="text-xs text-muted-foreground">The Mayor Office handles this</span>}
                              {r.status === "Pending" && can.super && (
                                <span className="flex gap-1.5">
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setReqResponse(""); setHandleReq(r); }}>Decline</Button>
                                </span>
                              )}
                            </div>
                            {r.reason && <p className="mt-1 text-xs text-muted-foreground">Student&apos;s reason: {r.reason}</p>}
                            {r.response && <p className="mt-1 text-xs"><span className="font-medium">Response: </span>{r.response}</p>}
                          </li>
                        ))}
                      </ul>
                      {reqs.some((r) => r.status === "Pending") && (
                        <p className="mt-1 text-xs text-muted-foreground">To honour it, use Account → Delete account below. That removes their login, records and files, and the request with them.</p>
                      )}
                    </div>
                  );
                })()}
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">Documents</h3>
                  {docList(studentDocs, studentDocsLoading)}
                </div>
              </div>
            );
          })()}
      </AppDialog>
      <ReasonDialog open={!!disapproveGrade} onClose={() => setDisapproveGrade(null)}
        title="Disapprove grade submission"
        description="The student is notified and asked to submit their grade again."
        hint="Shown to the student."
        placeholder="e.g. The grade report is unreadable or doesn't show the average."
        value={gradeNote} onChange={setGradeNote} busy={payBusy}
        confirmLabel="Disapprove grade"
        onConfirm={async () => { if (disapproveGrade && await reviewGrade(disapproveGrade, "Disapproved", gradeNote)) setDisapproveGrade(null); }} />

      <ReasonDialog open={!!handleReq} onClose={() => setHandleReq(null)}
        title="Decline deletion request"
        description="The student's account and data are kept."
        label="Message to the student"
        placeholder="Explain why, e.g. payment records must be kept for audit."
        value={reqResponse} onChange={setReqResponse} busy={payBusy}
        confirmLabel="Decline request"
        confirmVariant="default"
        onConfirm={respondToRequest} />

      <ReasonDialog open={!!disapproveReceipt} onClose={() => setDisapproveReceipt(null)}
        title="Disapprove student's receipt"
        description="The student is notified and asked to submit their receipt again."
        hint="Shown to the student."
        placeholder="e.g. The signature is missing. Please upload the signed voucher."
        value={receiptNote} onChange={setReceiptNote} busy={payBusy}
        confirmLabel="Disapprove receipt"
        onConfirm={async () => { if (disapproveReceipt && await reviewReceipt(disapproveReceipt, "Disapproved", receiptNote)) setDisapproveReceipt(null); }} />

      <AppDialog open={!!issueDialog} onOpenChange={(o) => { if (!o) setIssueDialog(null); }} size="md"
        title="Payment problem reports"
        description={issueDialog ? `${payStudent(issueDialog)} · ${formatPHP(issueDialog.amount)} · ${issueDialog.status}` : undefined}
        footer={<Button variant="outline" onClick={() => setIssueDialog(null)}>Close</Button>}>
        {issueDialog && payIssues.filter((i) => i.payment_id === issueDialog.id).map((i) => (
          <div key={i.id} className={`rounded-lg border p-4 text-sm ${i.status === "Open" ? "border-warning/40 bg-warning/5" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{{ not_received: "Not received", wrong_amount: "Wrong amount", other: "Other" }[i.kind] ?? i.kind}</p>
              <Badge variant={i.status === "Open" ? "default" : "secondary"}>{i.status}</Badge>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{i.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">Reported {new Date(i.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</p>
            {i.response && <p className="mt-3 whitespace-pre-wrap border-t pt-3"><span className="font-medium">Response: </span>{i.response}</p>}
            {i.status === "Open" && can.finance && (
              <div className="mt-4 space-y-2 border-t pt-4">
                <DialogField label="Response to the student" htmlFor={`issue-${i.id}`}>
                  <Textarea id={`issue-${i.id}`} rows={3} value={issueResponse} onChange={(e) => setIssueResponse(e.target.value)} placeholder="Explain what you found or what happens next." />
                </DialogField>
                <div className="flex justify-end">
                  <Button size="sm" disabled={payBusy || !issueResponse.trim()} onClick={() => resolveIssue(i)}>Send response &amp; resolve</Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </AppDialog>

      <ReasonDialog open={!!disapproveApp} onClose={() => setDisapproveApp(null)}
        title="Disapprove application"
        description={disapproveApp ? `${personName(disapproveApp.profiles)} · ${disapproveApp.scholarships?.name || "—"}` : undefined}
        hint="Shown to the student."
        placeholder="e.g. Your average grade is below the program's minimum."
        value={disapproveAppNote} onChange={setDisapproveAppNote} busy={disapprovingApp}
        confirmLabel="Disapprove application"
        onConfirm={async () => {
          if (!disapproveApp) return;
          setDisapprovingApp(true);
          const ok = await decideApplication(disapproveApp, "Disapproved", disapproveAppNote);
          setDisapprovingApp(false);
          if (ok) { toast.error("Application disapproved"); setDisapproveApp(null); loadData(true); }
        }} />

      <ReasonDialog open={!!revokeApp} onClose={() => setRevokeApp(null)}
        title="Revoke approval"
        description={`${personName(revokeApp?.profiles)}'s application for ${revokeApp?.scholarships?.name || "this program"} goes back to Pending, and its slot and award are released.`}
        hint="Shown to the student."
        placeholder="e.g. Approved by mistake: your residency could not be confirmed."
        value={revokeNote} onChange={setRevokeNote} busy={revokingApp}
        confirmLabel="Revoke approval"
        onConfirm={async () => {
          if (!revokeApp) return;
          setRevokingApp(true);
          const ok = await decideApplication(revokeApp, "Pending", revokeNote);
          setRevokingApp(false);
          if (ok) { toast.success("Approval revoked — the student was notified"); setRevokeApp(null); loadData(true); }
        }} />

      <ReasonDialog open={!!reminderFor} onClose={() => setReminderFor(null)}
        title={`Send reminder${reminderFor && reminderFor.length > 1 ? ` to ${reminderFor.length} students` : reminderFor?.[0] ? ` to ${personName(profiles.find((p) => p.id === reminderFor[0]))}` : ""}`}
        description="Sent as a notification that links to their Documents page. Each student gets at most one reminder a day."
        label="Message" rows={4} maxLength={1000}
        value={reminderText} onChange={setReminderText} busy={messaging}
        confirmLabel="Send reminder" confirmVariant="default"
        onConfirm={sendReminders} />

      <ReasonDialog open={!!changesFor} onClose={() => setChangesFor(null)}
        title="Request changes"
        description={`${personName(changesFor?.profiles)} is asked to fix something on their ${changesFor?.scholarships?.name || ""} application. Its status doesn't change.`}
        label="What the student needs to do"
        hint="To have a document re-uploaded, also mark it Disapproved so the student can replace it."
        placeholder="e.g. Your Certificate of Enrollment is blurry. Please upload a clearer copy."
        maxLength={1000}
        value={changesText} onChange={setChangesText} busy={messaging}
        confirmLabel="Send request" confirmVariant="default"
        onConfirm={sendChangeRequest} />

      <ReasonDialog open={bulkDisapprove} onClose={() => setBulkDisapprove(false)}
        title={`Disapprove ${selectedApps.size} application${selectedApps.size === 1 ? "" : "s"}`}
        description="Every selected student is notified."
        hint="Sent to every selected student."
        placeholder="e.g. All slots for this program have been filled."
        value={bulkNote} onChange={setBulkNote} busy={bulkBusy}
        confirmLabel="Disapprove"
        onConfirm={async () => { if (await bulkDecide("Disapproved", bulkNote)) setBulkDisapprove(false); }} />

      <ReasonDialog open={!!disapproveDoc} onClose={() => setDisapproveDoc(null)}
        title={`Disapprove ${disapproveDoc?.type ?? "document"}`}
        description="The student is notified and can upload a replacement."
        hint="Shown to the student."
        placeholder="e.g. The photo is blurry. Please upload a clear copy."
        value={disapproveNote} onChange={setDisapproveNote} busy={reviewingDoc}
        confirmLabel="Disapprove document"
        onConfirm={async () => { if (disapproveDoc && await reviewDocument(disapproveDoc, "Disapproved", disapproveNote)) setDisapproveDoc(null); }} />
    </div>
  );
}
