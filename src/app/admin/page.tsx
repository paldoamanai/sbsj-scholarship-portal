"use client";

import { useHistorySync } from "@/hooks/use-history-sync";
import { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  LayoutDashboard, GraduationCap, FileText, Users, ShieldCheck,
  Plus, Pencil, Trash2, CheckCircle, XCircle, Clock, Eye,
  Menu, X, Search, BookOpen, LogOut, Wallet, Banknote, BarChart3,
  Bell, ScrollText, Settings as SettingsIcon, Lock, Download,
  FileDown, Receipt, Loader2, User, Upload, ArrowRight,
   ChevronRight, ChevronLeft, ExternalLink, Power, Hourglass, RotateCcw, Copy, AlertTriangle,
  ClipboardCheck, UserCog, Send, Undo2, Ban, History,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { scholarshipSchema } from "@/validations/scholarship";
import ProfileImage from "@/components/ProfileImage";
import { YEAR_LEVELS } from "@/lib/scholarships";
import NotificationInbox, { NOTIFICATION_PAGE } from "@/components/notifications/NotificationInbox";
import AnnouncementsPanel from "@/components/admin/AnnouncementsPanel";
import ReminderJobsCard from "@/components/admin/ReminderJobsCard";
import { useUnreadTitle } from "@/hooks/use-unread-title";
import { showDesktopAlert } from "@/lib/desktop-alerts";
import NotificationPreferences from "@/components/notifications/NotificationPreferences";
import OverviewPanel from "@/components/admin/OverviewPanel";
import AdminProfilePanel from "@/components/admin/AdminProfilePanel";
import SettingsPanel from "@/components/admin/SettingsPanel";
import StaffPanel from "@/components/admin/StaffPanel";
import { Checkbox } from "@/components/ui/checkbox";
import { parseSettings, isAdminRole, staffCan, type AppSettings, type StaffArea } from "@/lib/settings";
import type { Tables, Json } from "@/integrations/supabase/types";

// Ordered like the scholarship process: set up a program, take in and screen applicants, keep the
// scholars, pay them, then report. `group` is the heading shown above each step in the sidebar.
// `area` limits a section to the staff roles that work in it (see staffCan); no area = every role.
const sidebarItems: { icon: typeof LayoutDashboard; label: string; key: string; group: string; area?: StaffArea }[] = [
  { icon: LayoutDashboard, label: "Dashboard", key: "overview", group: "Overview" },
  { icon: ClipboardCheck, label: "Review Queue", key: "queue", group: "Overview" },
  { icon: GraduationCap, label: "Scholarships", key: "scholarships", group: "1 · Programs" },
  { icon: FileText, label: "Applicants", key: "applications", group: "2 · Screening", area: "review" },
  { icon: ShieldCheck, label: "Verification", key: "verification", group: "2 · Screening", area: "review" },
  { icon: Users, label: "Students", key: "students", group: "3 · Scholars" },
  { icon: Wallet, label: "Funds", key: "funds", group: "4 · Payment", area: "finance" },
  { icon: Banknote, label: "Disbursement", key: "disbursement", group: "4 · Payment", area: "finance" },
  { icon: BarChart3, label: "Reports", key: "reports", group: "5 · Records" },
  { icon: ScrollText, label: "Audit Logs", key: "audit-logs", group: "5 · Records", area: "manage" },
  { icon: Bell, label: "Notifications", key: "notifications", group: "Account & system" },
  { icon: UserCog, label: "Staff", key: "staff", group: "Account & system", area: "manage" },
  { icon: SettingsIcon, label: "Settings", key: "settings", group: "Account & system", area: "manage" },
  { icon: User, label: "Profile", key: "profile", group: "Account & system" },
];

const formatPHP = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Status badge (pastel pill + icon, mirrors student-dashboard's pattern) ──────
function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "—") return <span className="text-sm text-muted-foreground">—</span>;
  const map: Record<string, { icon: typeof CheckCircle; cls: string }> = {
    Approved:   { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Pending:    { icon: Clock,        cls: "bg-amber-50 text-amber-700 border-amber-200" },
    Rejected:   { icon: XCircle,      cls: "bg-red-50 text-red-700 border-red-200" },
    Disbursed:  { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Processing: { icon: Clock,        cls: "bg-accent text-primary border-primary/20" },
    Waitlisted: { icon: Clock,        cls: "bg-muted text-muted-foreground border-border" },
    Cancelled:  { icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" },
    Withdrawn:  { icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" },
    Revoked:    { icon: XCircle,      cls: "bg-red-50 text-red-700 border-red-200" },
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
type DocSummary = { id: string; user_id: string; application_id: string | null; document_type: string; status: string; uploaded_at: string };
type AdminDoc = { id: string; name: string; type: string; url: string; status: string; note: string | null; size: number | null; uploadedAt: string };
type ReportSection = { name: string; head: string[]; rows: (string | number)[][]; money?: string[] };
type ReportDef = { title: string; filters: string[]; sections: ReportSection[]; count: number; countLabel: string };

function getRange(period: string, from: string, to: string): { since: Date | null; until: Date | null } {
  const now = new Date();
  if (period === "year") return { since: new Date(now.getFullYear(), 0, 1), until: null };
  if (period === "6m") return { since: new Date(now.getFullYear(), now.getMonth() - 5, 1), until: null };
  if (period === "30d") return { since: new Date(now.getTime() - 30 * 86400000), until: null };
  if (period === "custom") {
    return {
      since: from ? new Date(`${from}T00:00:00`) : null,
      until: to ? new Date(`${to}T23:59:59.999`) : null,
    };
  }
  return { since: null, until: null };
}

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
const jsonText = (v: Json | null | undefined) => { const x = parseJson(v); return x === null ? "—" : typeof x === "string" ? x : JSON.stringify(x); };

export default function AdminDashboardPage() {
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
  const [deleteSch, setDeleteSch] = useState<Tables<"scholarships"> | null>(null);
  const [fundPeriod, setFundPeriod] = useState("all"); // shared by Fund Management and Reports
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reportProgram, setReportProgram] = useState("all");
  const [reportPayStatus, setReportPayStatus] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditEntity, setAuditEntity] = useState("all");
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
  const [cancelPay, setCancelPay] = useState<Tables<"payments"> | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [payIssues, setPayIssues] = useState<Tables<"payment_issues">[]>([]);
  const [issueDialog, setIssueDialog] = useState<Tables<"payments"> | null>(null);
  const [issueResponse, setIssueResponse] = useState("");
  const [rejectReceipt, setRejectReceipt] = useState<Tables<"payments"> | null>(null);
  const [receiptNote, setReceiptNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [gradeReviews, setGradeReviews] = useState<Tables<"grade_updates">[]>([]);
  const [dataReqs, setDataReqs] = useState<Tables<"data_requests">[]>([]);
  const [rejectGrade, setRejectGrade] = useState<Tables<"grade_updates"> | null>(null);
  const [gradeNote, setGradeNote] = useState("");
  const [handleReq, setHandleReq] = useState<{ req: Tables<"data_requests">; status: "Completed" | "Declined" } | null>(null);
  const [reqResponse, setReqResponse] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentFilter, setStudentFilter] = useState("all");
  const [studentSort, setStudentSort] = useState("name");
  const [studentPage, setStudentPage] = useState(1);
  const [viewStudent, setViewStudent] = useState<Tables<"profiles"> | null>(null);
  const [studentDocs, setStudentDocs] = useState<AdminDoc[]>([]);
  const [studentDocsLoading, setStudentDocsLoading] = useState(false);
  const [appProgram, setAppProgram] = useState("all");
  const [appTerm, setAppTerm] = useState("all");
  const [appSort, setAppSort] = useState("newest");
  // Applicant rows ticked for a bulk action: application ids, and "none-<profile id>" for students who haven't applied.
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  // Reject and revoke always ask for a reason, which the student sees.
  const [decisionDialog, setDecisionDialog] = useState<{ ids: string[]; status: "Rejected" | "Revoked" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [remindDialog, setRemindDialog] = useState<string[] | null>(null);
  const [remindMsg, setRemindMsg] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [closeCycle, setCloseCycle] = useState<Tables<"scholarships"> | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [reversePay, setReversePay] = useState<Tables<"payments"> | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [bulkSchedule, setBulkSchedule] = useState(false);
  const [bulkScheduleDate, setBulkScheduleDate] = useState("");
  const [selectedPays, setSelectedPays] = useState<Set<string>>(new Set());
  const [verifSearch, setVerifSearch] = useState("");
  const [verifPage, setVerifPage] = useState(1);
  const [selectedVerifs, setSelectedVerifs] = useState<Set<string>>(new Set());
  const [queueTab, setQueueTab] = useState("");
  const [auditExhausted, setAuditExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [applications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string } | null, profiles?: Tables<"profiles"> | null })[]>([]);
  const [scholarships, setScholarships] = useState<Tables<"scholarships">[]>([]);
  const [profiles, setProfiles] = useState<Tables<"profiles">[]>([]);
  const [payments, setPayments] = useState<Tables<"payments">[]>([]);
  const [viewApp, setViewApp] = useState<typeof applications[0] | null>(null);
  const [remarks, setRemarks] = useState("");
  const [appPage, setAppPage] = useState(1);
  const [viewDocs, setViewDocs] = useState<AdminDoc[]>([]);
  const [allDocs, setAllDocs] = useState<DocSummary[]>([]);
  const [rejectDoc, setRejectDoc] = useState<AdminDoc | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [reviewingDoc, setReviewingDoc] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<Tables<"audit_logs">[]>([]);
  const [verifications, setVerifications] = useState<Tables<"scholar_verifications">[]>([]);
  const [systemSettings, setSystemSettings] = useState<Tables<"system_settings">[]>([]);
  const [adminProfile, setAdminProfile] = useState<Tables<"profiles"> | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [adminRole, setAdminRole] = useState("admin");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verifFilter, setVerifFilter] = useState("all");
  const [verifAction, setVerifAction] = useState<{ v: Tables<"scholar_verifications">; status: "Verified" | "Flagged" | "Cleared" } | null>(null);
  const [verifNotes, setVerifNotes] = useState("");
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

  // What this staff member may do. The database enforces the same split (migration 033).
  const canReview = staffCan(adminRole, "review");
  const canManage = staffCan(adminRole, "manage");
  const canOpen = (key: string) => {
    if (key === "scholarships:edit") return canManage;
    if (key.startsWith("queue:")) return staffCan(adminRole, key.slice(6) as StaffArea);
    const item = sidebarItems.find((i) => i.key === key);
    return !!item && (!item.area || staffCan(adminRole, item.area));
  };

  // Disburse dialog state
  const [disbDialog, setDisbDialog] = useState(false);
  const [disbPaymentId, setDisbPaymentId] = useState<string>("");
  const [disbMethod, setDisbMethod] = useState<"Cheque" | "Cash">("Cash");
  const [disbRef, setDisbRef] = useState("");
  const [disbReceipt, setDisbReceipt] = useState<File | null>(null);
  const [disbLoading, setDisbLoading] = useState(false);

  useEffect(() => { loadData(); }, []);

  // Profiles of students only — staff accounts (anyone with a non-student role) are excluded.
  const withoutStaff = async (rows: Tables<"profiles">[]) => {
    const { data } = await supabase.from("user_roles").select("user_id").neq("role", "student");
    const staff = new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
    return rows.filter((p) => !staff.has(p.id));
  };

  const joinProfiles = (apps: (Tables<"applications"> & { scholarships: { name: string } | null })[], rows: Tables<"profiles">[]) => {
    const byId = new Map(rows.map((p) => [p.id, p]));
    return apps.map((a) => ({ ...a, profiles: byId.get(a.user_id) ?? null }));
  };

  const loadData = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    setAdminEmail(user.email || "");
    setAdminUserId(user.id);
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    const role = (roleData as { role?: string } | null)?.role;
    if (!isAdminRole(role)) { router.push("/student-dashboard"); return; }
    setAdminRole(role as string);

    const [appsRes, scholsRes, profilesRes, paymentsRes, logsRes, verifRes, settingsRes, adminProfRes, notifsRes, unreadRes, docsRes, issuesRes, gradesRes, reqsRes] = await Promise.all([
      supabase.from("applications").select("*, scholarships(name)").order("created_at", { ascending: false }),
      supabase.from("scholarships").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*"),
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("scholar_verifications").select("*").order("created_at", { ascending: false }),
      supabase.from("system_settings").select("*"),
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("notifications").select("*").eq("user_id", user.id).eq("muted", false).order("created_at", { ascending: false }).limit(NOTIFICATION_PAGE),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("muted", false).eq("read", false),
      supabase.from("documents").select("id, user_id, application_id, document_type, status, uploaded_at"),
      supabase.from("payment_issues").select("*").order("created_at", { ascending: false }),
      supabase.from("grade_updates").select("*").order("created_at", { ascending: false }),
      supabase.from("data_requests").select("*").order("created_at", { ascending: false }),
    ]);

    const failed = [appsRes, scholsRes, profilesRes, paymentsRes, logsRes, verifRes, settingsRes, adminProfRes, notifsRes, unreadRes, docsRes, issuesRes, gradesRes, reqsRes].find((r) => r.error);
    setLoadError(failed?.error ? failed.error.message : null);
    if (appsRes.data) setApplications(joinProfiles(appsRes.data, profilesRes.data ?? []));
    if (scholsRes.data) setScholarships(scholsRes.data);
    if (profilesRes.data) setProfiles(await withoutStaff(profilesRes.data));
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (logsRes.data) { setAuditLogs(logsRes.data); setAuditExhausted(logsRes.data.length < 1000); }
    if (verifRes.data) setVerifications(verifRes.data);
    if (settingsRes.data) setSystemSettings(settingsRes.data);
    if (adminProfRes.data) setAdminProfile(adminProfRes.data);
    if (notifsRes.data) setNotifications(notifsRes.data);
    if (unreadRes.count != null) setUnreadTotal(unreadRes.count);
    if (docsRes.data) setAllDocs(docsRes.data);
    if (issuesRes.data) setPayIssues(issuesRes.data);
    if (gradesRes.data) setGradeReviews(gradesRes.data);
    if (reqsRes.data) setDataReqs(reqsRes.data);
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  };

  // Re-fetch applications/payments in the background (no loading flicker) —
  // used when a live change comes in over realtime.
  const silentRefreshAdmin = async () => {
    const [appsRes, paymentsRes, profilesRes, docsRes] = await Promise.all([
      supabase.from("applications").select("*, scholarships(name)").order("created_at", { ascending: false }),
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*"),
      supabase.from("documents").select("id, user_id, application_id, document_type, status, uploaded_at"),
    ]);
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
      return { id: d.id, name: d.file_name, type: d.document_type, url, status: d.status, note: d.review_note, size: d.file_size, uploadedAt: d.uploaded_at };
    }));
  };

  // Verify or reject a document. The database records who reviewed it, audits it and notifies the student.
  const reviewDocument = async (doc: AdminDoc, status: "Verified" | "Rejected" | "Pending", note?: string) => {
    setReviewingDoc(true);
    const { data, error } = await supabase.from("documents")
      .update({ status, review_note: status === "Rejected" ? note?.trim() || null : null })
      .eq("id", doc.id).select("status, review_note").single();
    setReviewingDoc(false);
    if (error || !data) { toast.error(error?.message ?? "Could not update the document"); return false; }
    const patch = (list: AdminDoc[]) => list.map((x) => (x.id === doc.id ? { ...x, status: data.status, note: data.review_note } : x));
    setViewDocs(patch); setStudentDocs(patch);
    setAllDocs((prev) => prev.map((x) => (x.id === doc.id ? { ...x, status: data.status } : x)));
    toast.success(status === "Verified" ? `${doc.type} verified` : status === "Rejected" ? `${doc.type} rejected` : `${doc.type} reopened`);
    return true;
  };

  const docList = (docs: AdminDoc[], loading: boolean) => {
    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (docs.length === 0) return <p className="text-sm text-muted-foreground">No documents uploaded</p>;
    const tone = (st: string) => st === "Verified" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : st === "Rejected" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200";
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
              <span className={`flex gap-1.5 ${canReview ? "" : "hidden"}`}>
                {d.status !== "Verified" && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={reviewingDoc} onClick={() => reviewDocument(d, "Verified")}>Verify</Button>}
                {d.status !== "Rejected" && <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={reviewingDoc} onClick={() => { setRejectNote(""); setRejectDoc(d); }}>Reject</Button>}
                {d.status !== "Pending" && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={reviewingDoc} onClick={() => reviewDocument(d, "Pending")}>Reset</Button>}
              </span>
            </div>
            {d.status === "Rejected" && d.note && <p className="mt-1 text-xs text-destructive">Reason: {d.note}</p>}
          </li>
        ))}
      </ul>
    );
  };

  useEffect(() => {
    if (!viewApp) { setViewDocs([]); return; }
    setRemarks(viewApp.notes || "");
    let cancelled = false;
    setDocsLoading(true);
    loadSignedDocs(viewApp.user_id).then((docs) => { if (!cancelled) { setViewDocs(docs); setDocsLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewApp?.id]);

  useEffect(() => {
    if (!viewStudent) { setStudentDocs([]); return; }
    let cancelled = false;
    setStudentDocsLoading(true);
    loadSignedDocs(viewStudent.id).then((docs) => { if (!cancelled) { setStudentDocs(docs); setStudentDocsLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStudent?.id]);

  const isClosed = (sch: Tables<"scholarships">) => !!sch.deadline && sch.deadline < new Date().toISOString().slice(0, 10);
  const approvedCount = (schId: string) => applications.filter((a) => a.scholarship_id === schId && a.status === "Approved").length;
  // Money committed to a program: approved awards (the program amount where none was set).
  const committedFor = (sch: Tables<"scholarships">) =>
    applications.filter((a) => a.scholarship_id === sch.id && a.status === "Approved")
      .reduce((t, a) => t + Number(a.amount_approved ?? sch.amount ?? 0), 0);
  // An application's award: its approved amount, else the program's award (0 = none set).
  const awardOf = (a: { amount_approved: number | null; scholarship_id: string | null } | undefined) =>
    Number(a?.amount_approved ?? scholarships.find((x) => x.id === a?.scholarship_id)?.amount ?? 0);
  // Scheduled or paid so far; cancelled payments don't count.
  const liveTotal = (appId: string) =>
    payments.filter((p) => p.application_id === appId && p.status !== "Cancelled").reduce((t, p) => t + Number(p.amount || 0), 0);
  // What's left of the award to schedule (instalments), or null when the award has no amount.
  const remainingFor = (appId: string) => {
    const award = awardOf(applications.find((x) => x.id === appId));
    return award > 0 ? Math.max(Math.round((award - liveTotal(appId)) * 100) / 100, 0) : null;
  };
  // Default amount for a new payment: the rest of the award.
  const awardFor = (appId: string) => { const left = remainingFor(appId); return left ? left : ""; };
  const applicantCount = (schId: string) => applications.filter((a) => a.scholarship_id === schId).length;
  const filteredScholarships = scholarships.filter((sch) => {
    const q = schSearch.trim().toLowerCase();
    if (q && !`${sch.name} ${sch.eligibility || ""}`.toLowerCase().includes(q)) return false;
    if (schFilter === "active") return sch.is_active && !isClosed(sch);
    if (schFilter === "inactive") return !sch.is_active;
    if (schFilter === "closed") return isClosed(sch);
    return true;
  });

  const saveScholarship = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? "");
    const num = (k: string) => (text(k).trim() === "" ? 0 : Number(text(k)));
    const parsed = scholarshipSchema.safeParse({
      name: text("name"), description: text("description"), eligibility: text("eligibility"),
      amount: num("amount"), total_budget: num("total_budget"), slots: num("slots"),
      open_date: text("open_date") || null, deadline: text("deadline") || null,
      min_grade: text("min_grade").trim() === "" ? null : Number(text("min_grade")),
      year_levels: schYearLevels, municipality: text("municipality"), is_active: schActive,
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check the form"); return; }
    const payload = parsed.data;
    const editing = schDialog && schDialog !== "new" ? schDialog : null;

    const today = new Date().toISOString().slice(0, 10);
    if (payload.deadline && payload.deadline < today && (!editing || payload.deadline !== editing.deadline)) {
      toast.error("The deadline cannot be in the past"); return;
    }
    if (editing) {
      const approved = approvedCount(editing.id);
      if (payload.slots > 0 && payload.slots < approved) { toast.error(`Slots cannot be lower than the ${approved} scholar(s) already approved`); return; }
      const committed = committedFor(editing);
      if (payload.total_budget > 0 && payload.total_budget < committed) { toast.error(`The budget cannot be lower than the ${formatPHP(committed)} already committed`); return; }
    }

    if (editing) {
      const { error } = await supabase.from("scholarships").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Scholarship updated");
    } else {
      const { error } = await supabase.from("scholarships").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Scholarship added");
    }
    setSchDialog(null); loadData();
  };

  // Start next year's program from an existing one: same rules, disabled and undated until reviewed.
  const duplicateScholarship = async (sch: Tables<"scholarships">) => {
    const copy = {
      name: `${sch.name} (copy)`, description: sch.description, eligibility: sch.eligibility,
      amount: sch.amount, total_budget: sch.total_budget, slots: sch.slots, min_grade: sch.min_grade,
      year_levels: sch.year_levels, municipality: sch.municipality, open_date: null, deadline: null, is_active: false,
    };
    const { error } = await supabase.from("scholarships").insert(copy);
    if (error) { toast.error(error.message); return; }
    toast.success(`Created "${copy.name}"`, { description: "It's disabled and has no dates yet. Edit it to set them and enable it." });
    loadData();
  };

  const toggleScholarship = async (sch: Tables<"scholarships">) => {
    const { error } = await supabase.from("scholarships").update({ is_active: !sch.is_active }).eq("id", sch.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${sch.name} ${sch.is_active ? "disabled" : "enabled"}`); loadData();
  };

  const confirmDeleteScholarship = async () => {
    if (!deleteSch) return;
    const { error } = await supabase.from("scholarships").delete().eq("id", deleteSch.id);
    if (error) {
      toast.error("Could not delete", {
        description: error.code === "23503" ? "This program has applications, so it can't be deleted. Disable it instead." : error.message,
      });
      return;
    }
    toast.success("Scholarship deleted");
    setDeleteSch(null); loadData();
  };

  // End of cycle: disable the program and reject whoever is still pending or waitlisted.
  const confirmCloseCycle = async () => {
    if (!closeCycle) return;
    setBulkBusy(true);
    const { data, error } = await supabase.rpc("close_scholarship_cycle", { _id: closeCycle.id, _note: closeNote.trim() || null });
    setBulkBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${closeCycle.name} closed`, { description: `${data ?? 0} remaining application${data === 1 ? "" : "s"} rejected and notified.` });
    setCloseCycle(null); setCloseNote(""); loadData();
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
    setPayAppId(applicationId); setPayMethod(parseSettings(systemSettings).default_payment_method); setPayDialog("new");
  };

  const savePayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount") || 0);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter an amount greater than 0"); return; }
    const fields = {
      amount,
      method: payMethod,
      reference: String(fd.get("reference") || "").trim() || null,
      scheduled_date: String(fd.get("scheduled_date") || "") || null,
      notes: String(fd.get("notes") || "").trim() || null,
    };
    if (payDialog && payDialog !== "new") {
      const { error } = await supabase.from("payments").update(fields).eq("id", payDialog.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Payment updated");
    } else {
      const app = applications.find((a) => a.id === payAppId);
      if (!app) { toast.error("Select an approved applicant"); return; }
      const { error } = await supabase.from("payments").insert({ ...fields, application_id: app.id, user_id: app.user_id, status: "Pending" });
      if (error) { toast.error(error.message); return; }
      toast.success("Payment scheduled");
    }
    setPayDialog(null); loadData();
  };

  const setPaymentStatus = async (p: Tables<"payments">, status: "Processing" | "Cancelled", reason?: string) => {
    const cancel_reason = status === "Cancelled" ? reason?.trim() || null : null;
    const { error } = await supabase.from("payments").update(status === "Cancelled" ? { status, cancel_reason } : { status }).eq("id", p.id);
    if (error) { toast.error(error.message); return false; }
    toast.success(status === "Cancelled" ? "Payment cancelled" : "Marked as processing");
    loadData();
    return true;
  };

  // Undo a disbursement recorded by mistake. The payment is kept as Cancelled with who, when and why.
  const confirmReverse = async () => {
    if (!reversePay) return;
    setPayBusy(true);
    const { error } = await supabase.rpc("reverse_disbursement", { _payment_id: reversePay.id, _reason: reverseReason });
    setPayBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Disbursement reversed");
    setReversePay(null); setReverseReason(""); loadData();
  };

  // Schedule the remaining balance of every awaiting award at once.
  const scheduleAllAwaiting = async (scheduled: string) => {
    setBulkBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const a of fundData.awaiting) {
      const amount = remainingFor(a.id);
      if (!amount) { failures.push(`${personName(a.profiles)}: no award amount set`); continue; }
      const { error } = await supabase.from("payments").insert({
        application_id: a.id, user_id: a.user_id, amount, status: "Pending",
        method: parseSettings(systemSettings).default_payment_method, scheduled_date: scheduled || null,
      });
      if (error) failures.push(`${personName(a.profiles)}: ${error.message}`); else ok++;
    }
    setBulkBusy(false);
    setBulkSchedule(false);
    if (ok) toast.success(`${ok} payment${ok === 1 ? "" : "s"} scheduled`);
    if (failures.length) toast.error(`${failures.length} not scheduled`, { description: failures.slice(0, 3).join(" · ") });
    loadData();
  };

  const processSelectedPayments = async () => {
    setBulkBusy(true);
    const list = payments.filter((p) => selectedPays.has(p.id) && p.status === "Pending");
    let ok = 0;
    for (const p of list) {
      const { error } = await supabase.from("payments").update({ status: "Processing" }).eq("id", p.id);
      if (!error) ok++;
    }
    setBulkBusy(false);
    setSelectedPays(new Set());
    toast.success(`${ok} of ${list.length} marked as processing`);
    loadData();
  };

  const openStoredFile = async (path: string | null, missingMsg: string) => {
    if (!path) { toast.error(missingMsg); return; }
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { win?.close(); toast.error("Could not open receipt", { description: error?.message }); return; }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };
  const viewReceipt = (p: Tables<"payments">) => openStoredFile(p.receipt_path, "No receipt on file for this payment");
  const viewStudentReceipt = (p: Tables<"payments">) => openStoredFile(p.student_receipt_path, "The student hasn't submitted a receipt");

  // Verify or reject a grade a student submitted. Verifying replaces their average grade; the student is notified.
  const reviewGrade = async (g: Tables<"grade_updates">, status: "Verified" | "Rejected", note?: string) => {
    setPayBusy(true);
    const { error } = await supabase.rpc("review_grade_update", { _id: g.id, _status: status, _note: note ?? null });
    setPayBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(status === "Verified" ? "Grade verified" : "Grade rejected — the student was asked to resubmit");
    if (status === "Verified") {
      setViewStudent((v) => (v && v.id === g.user_id ? { ...v, average_grade: g.grade, grade_verified_at: new Date().toISOString(), grade_term: g.term } : v));
    }
    loadData();
    return true;
  };

  const respondToRequest = async () => {
    if (!handleReq) return;
    setPayBusy(true);
    const { error } = await supabase.rpc("handle_data_request", { _id: handleReq.req.id, _status: handleReq.status, _response: reqResponse });
    setPayBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(handleReq.status === "Completed" ? "Marked as completed" : "Request declined");
    setHandleReq(null); setReqResponse("");
    loadData();
  };

  // Accept or reject the receipt a student submitted. The student is notified by the database.
  const reviewReceipt = async (p: Tables<"payments">, status: "Accepted" | "Rejected", note?: string) => {
    setPayBusy(true);
    const { error } = await supabase.rpc("review_student_receipt", { _payment_id: p.id, _status: status, _note: note ?? null });
    setPayBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(status === "Accepted" ? "Receipt accepted" : "Receipt rejected — the student was asked to resubmit");
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
    const maxMb = parseSettings(systemSettings).max_upload_mb;
    if (disbReceipt.size > maxMb * 1024 * 1024) { toast.error(`Receipt is too large (max ${maxMb} MB)`); return; }
    setDisbLoading(true);
    try {
      const safeName = disbReceipt.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `receipts/${payment.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(path, disbReceipt);
      if (uploadError) { toast.error("Receipt upload failed", { description: uploadError.message }); return; }
      const update = { status: "Disbursed", method: disbMethod, reference: disbRef.trim() || null, receipt_path: path, disbursed_at: new Date().toISOString() };
      const { error } = await supabase.from("payments").update(update).eq("id", payment.id);
      if (error) {
        await supabase.storage.from("documents").remove([path]);
        toast.error(error.message);
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
  const auditActions = useMemo(() => [...new Set(auditLogs.map((l) => l.action))].sort(), [auditLogs]);
  const auditEntities = useMemo(() => [...new Set(auditLogs.map((l) => l.entity_type))].sort(), [auditLogs]);
  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    const from = auditFrom ? new Date(`${auditFrom}T00:00:00`) : null;
    const to = auditTo ? new Date(`${auditTo}T23:59:59.999`) : null;
    return auditLogs.filter((l) => {
      if (auditAction !== "all" && l.action !== auditAction) return false;
      if (auditEntity !== "all" && l.entity_type !== auditEntity) return false;
      const t = new Date(l.created_at);
      if ((from && t < from) || (to && t > to)) return false;
      return !q || `${l.user_email || ""} ${l.action} ${l.entity_type} ${l.entity_id || ""}`.toLowerCase().includes(q);
    });
  }, [auditLogs, auditSearch, auditAction, auditEntity, auditFrom, auditTo]);
  const auditPages = Math.max(1, Math.ceil(filteredLogs.length / AUDIT_PAGE_SIZE));
  const currentAuditPage = Math.min(auditPage, auditPages);
  const pagedLogs = filteredLogs.slice((currentAuditPage - 1) * AUDIT_PAGE_SIZE, currentAuditPage * AUDIT_PAGE_SIZE);
  const auditDef = (): ReportDef => ({
    title: "Audit Log", count: filteredLogs.length, countLabel: "entries",
    filters: [`${filteredLogs.length} of ${auditLogs.length} loaded entries`, ...(auditAction !== "all" ? [`Action: ${auditAction}`] : []), ...(auditEntity !== "all" ? [`Entity: ${auditEntity}`] : []), ...(auditFrom || auditTo ? [`Dates: ${auditFrom || "…"} to ${auditTo || "…"}`] : [])],
    sections: [logsToSection(filteredLogs)],
  });

  const STUDENT_PAGE_SIZE = 10;
  const verificationForUser = (userId: string) => verifications.find((v) => v.user_id === userId);
  // The Students section lists scholars only: accounts with at least one approved application.
  // Everyone else is reached through Applicants.
  const scholars = useMemo(() => {
    const ids = new Set(applications.filter((a) => a.status === "Approved").map((a) => a.user_id));
    return profiles.filter((p) => ids.has(p.id));
  }, [profiles, applications]);
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const list = scholars.filter((p) => {
      if (studentFilter === "active" && !p.is_active) return false;
      if (studentFilter === "inactive" && p.is_active) return false;
      if (!q) return true;
      return [`${p.first_name} ${p.last_name}`, p.email, p.school_name, p.course, p.student_id_number]
        .some((f) => (f || "").toLowerCase().includes(q));
    });
    return list.sort((x, y) => studentSort === "grade"
      ? (y.average_grade ?? -1) - (x.average_grade ?? -1)
      : `${x.last_name} ${x.first_name}`.localeCompare(`${y.last_name} ${y.first_name}`));
  }, [scholars, studentSearch, studentFilter, studentSort]);
  const studentPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENT_PAGE_SIZE));
  const pagedStudents = filteredStudents.slice((studentPage - 1) * STUDENT_PAGE_SIZE, studentPage * STUDENT_PAGE_SIZE);

  const toggleStudentActive = async (p: Tables<"profiles">) => {
    const next = !p.is_active;
    const { error } = await supabase.rpc("set_student_active", { _user_id: p.id, _active: next });
    if (error) { toast.error(error.message); return; }
    toast.success(`${p.first_name || "Student"} ${next ? "activated" : "deactivated"}`);
    setViewStudent((cur) => (cur && cur.id === p.id ? { ...cur, is_active: next } : cur));
    loadData();
  };

  const exportStudents = async () => {
    const XLSX = await import("xlsx");
    const rows = filteredStudents.map((p) => ({
      Name: `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      Email: p.email || "—",
      "Student ID": p.student_id_number || "—",
      School: p.school_name || "—",
      Course: p.course || "—",
      "Year Level": p.year_level || "—",
      Grade: p.average_grade ?? "—",
      Applications: applications.filter((a) => a.user_id === p.id).length,
      Verification: verificationForUser(p.id)?.verification_status || "—",
      Status: p.is_active ? "Active" : "Inactive",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Students");
    XLSX.writeFile(wb, "students.xlsx");
    toast.success("Excel downloaded");
  };

  const verificationFor = (applicationId: string) => verifications.find((v) => v.application_id === applicationId);
  // Why an application can't be approved yet (null = it can). The database enforces the same rules.
  const approveBlocker = (a: { id: string; user_id: string }): string | null => {
    const st = verificationFor(a.id)?.verification_status;
    if (st !== "Verified" && st !== "Cleared") return "Verify the scholar first";
    const outstanding = parseSettings(systemSettings).required_documents.flatMap((type) => {
      // Latest copy wins: this application's own upload, or one still unattached.
      const latest = allDocs
        .filter((d) => d.user_id === a.user_id && d.document_type === type && (d.application_id === a.id || d.application_id === null))
        .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
      return latest?.status === "Verified" ? [] : [`${type} (${latest ? latest.status.toLowerCase() : "missing"})`];
    });
    return outstanding.length ? `Verify all required documents first: ${outstanding.join(", ")}` : null;
  };
  type AppRow = typeof applications[number];
  type AppDecision = "Approved" | "Rejected" | "Waitlisted" | "Pending";
  // Returns why the change failed, or null. The database notifies the student (migration 018) and
  // writes the audit entry (migration 033).
  const applyDecision = async (a: AppRow, status: AppDecision | "Revoked", note?: string): Promise<string | null> => {
    if (status === "Approved") {
      const blocker = approveBlocker(a);
      if (blocker) return blocker;
    }
    if (status === "Revoked") {
      const { error } = await supabase.rpc("revoke_application", { _id: a.id, _reason: note ?? "" });
      return error?.message ?? null;
    }
    const notes = note !== undefined ? note.trim() || null : a.notes ?? null;
    const { error } = await supabase.from("applications").update({ status, notes }).eq("id", a.id);
    return error?.message ?? null;
  };
  const decideApplication = async (a: AppRow, status: AppDecision, note?: string) => {
    const err = await applyDecision(a, status, note);
    if (err) { toast.error(status === "Approved" ? "Can't approve yet" : "Couldn't update the application", { description: err }); return false; }
    return true;
  };
  const DECISION_VERB: Record<AppDecision | "Revoked", string> = {
    Approved: "approved", Rejected: "rejected", Waitlisted: "waitlisted", Pending: "reopened", Revoked: "revoked",
  };
  // One application at a time, so each gets the same checks (verification, documents, slots, budget).
  const decideMany = async (ids: string[], status: AppDecision | "Revoked", note?: string) => {
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const a = applications.find((x) => x.id === id);
      if (!a) continue;
      const err = await applyDecision(a, status, note);
      if (err) failed.push(`${personName(a.profiles)}: ${err}`); else ok++;
    }
    setBulkBusy(false);
    setSelectedApps(new Set());
    const verb = DECISION_VERB[status];
    if (ok) toast.success(`${ok} application${ok === 1 ? "" : "s"} ${verb}`);
    if (failed.length) toast.error(`${failed.length} not ${verb}`, { description: failed.slice(0, 3).join(" · ") });
    loadData();
    return failed.length === 0;
  };
  const openDecision = (ids: string[], status: "Rejected" | "Revoked", note = "") => {
    setDecisionNote(note); setDecisionDialog({ ids, status });
  };
  const confirmDecision = async () => {
    if (!decisionDialog || !decisionNote.trim()) return;
    if (await decideMany(decisionDialog.ids, decisionDialog.status, decisionNote)) {
      setDecisionDialog(null);
      if (viewApp && decisionDialog.ids.includes(viewApp.id)) setViewApp(null);
    }
  };

  const DEFAULT_REMINDER = "You registered for the scholarship but haven't submitted an application yet. Upload your required documents and apply before the deadline.";
  const openReminder = (userIds: string[]) => { setRemindMsg(DEFAULT_REMINDER); setRemindDialog(userIds); };
  const sendReminders = async () => {
    if (!remindDialog) return;
    setBulkBusy(true);
    const { data, error } = await supabase.rpc("remind_students", { _user_ids: remindDialog, _message: remindMsg });
    setBulkBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Reminder sent to ${data ?? 0} student${data === 1 ? "" : "s"}`, { description: "Each student gets at most one reminder a day." });
    setRemindDialog(null); setSelectedApps(new Set());
  };

  // Deletes the student's files and account on the server, then records it in the audit log.
  const deleteAccount = async (req: Tables<"data_requests">) => {
    setDeletingAccount(true);
    const res = await fetch("/api/admin/delete-account", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: req.id }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({})) ?? {};
    setDeletingAccount(false);
    if (!res?.ok) { toast.error("Account not deleted", { description: body.error ?? "Network error" }); return; }
    toast.success("Account and files deleted", { description: `${body.filesRemoved ?? 0} file(s) removed.` });
    setHandleReq(null); setViewStudent(null); loadData();
  };

  const loadOlderLogs = async () => {
    const oldest = auditLogs[auditLogs.length - 1];
    if (!oldest) return;
    setLoadingOlder(true);
    const { data, error } = await supabase.from("audit_logs").select("*")
      .lt("created_at", oldest.created_at).order("created_at", { ascending: false }).limit(1000);
    setLoadingOlder(false);
    if (error) { toast.error(error.message); return; }
    setAuditLogs((prev) => [...prev, ...(data ?? [])]);
    if ((data?.length ?? 0) < 1000) setAuditExhausted(true);
  };
  const submitVerification = async () => {
    if (!verifAction) return;
    const { v, status } = verifAction;
    const note = verifNotes.trim();
    const { error } = await supabase.from("scholar_verifications").update({
      verification_status: status,
      verified_by: adminUserId || null,
      verified_at: new Date().toISOString(),
      notes: note ? (v.notes ? `${v.notes}\n${note}` : note) : v.notes,
    }).eq("id", v.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked ${status}`);
    setVerifAction(null); setVerifNotes(""); loadData();
  };
  const verifySelected = async () => {
    setBulkBusy(true);
    const list = verifications.filter((v) => selectedVerifs.has(v.id) && v.verification_status === "Pending");
    let ok = 0;
    for (const v of list) {
      const { error } = await supabase.from("scholar_verifications")
        .update({ verification_status: "Verified", verified_by: adminUserId || null, verified_at: new Date().toISOString() }).eq("id", v.id);
      if (!error) ok++;
    }
    setBulkBusy(false);
    setSelectedVerifs(new Set());
    toast.success(`${ok} of ${list.length} verified`);
    loadData();
  };

  const logAudit = async (action: string, entityType: string, entityId?: string, prev?: Json | null, next?: Json | null) => {
    const { data: { user } } = await supabase.auth.getUser();
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
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

    const saved: [string, Json][] = [];
    let failed: string | null = null;
    for (const [key, value] of changed) {
      const { error } = await supabase.from("system_settings").upsert({ key, value: value as Json }, { onConflict: "key" });
      if (error) { failed = error.message; break; }
      saved.push([key, value as Json]);
    }

    if (action === "reset_settings" && saved.length) {
      await logAudit("reset_settings", "system_settings", undefined,
        Object.fromEntries(saved.map(([k]) => [k, prev[k]])) as Json, Object.fromEntries(saved) as Json);
    } else {
      for (const [key, value] of saved) await logAudit("update_setting", "system_settings", undefined, { key, value: prev[key] }, { key, value });
    }

    const [settingsRes, logsRes] = await Promise.all([
      supabase.from("system_settings").select("*"),
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    if (settingsRes.data) setSystemSettings(settingsRes.data);
    if (logsRes.data) setAuditLogs(logsRes.data);

    if (failed) { toast.error("Some settings were not saved", { description: failed }); return false; }
    toast.success(action === "reset_settings" ? "Settings reset to defaults" : "Settings saved");
    return true;
  };

  // ── Reports ──
  const periodLabel = () => {
    if (fundPeriod === "year") return "This year";
    if (fundPeriod === "6m") return "Last 6 months";
    if (fundPeriod === "30d") return "Last 30 days";
    if (fundPeriod === "custom") return `${fromDate || "…"} to ${toDate || "…"}`;
    return "All time";
  };
  const programLabel = () => (reportProgram === "all" ? "All programs" : scholarships.find((sc) => sc.id === reportProgram)?.name || "Unknown program");
  const personName = (p?: Tables<"profiles"> | null) => (p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || "—" : "—");

  const logsToSection = (logs: Tables<"audit_logs">[]): ReportSection => ({
    name: "Audit Log",
    head: ["Date", "User", "Action", "Entity", "Entity ID", "Before", "After"],
    rows: logs.map((l) => [new Date(l.created_at).toLocaleString(), l.user_email || "System", l.action, l.entity_type, l.entity_id || "—", jsonText(l.previous_value), jsonText(l.new_value)]),
  });

  const buildReport = (key: string): ReportDef => {
    const { since, until } = getRange(fundPeriod, fromDate, toDate);
    const within = (d: string | null | undefined) => {
      if (!d) return !since && !until;
      const t = new Date(d);
      return (!since || t >= since) && (!until || t <= until);
    };
    const inProgram = (schId: string | null | undefined) => reportProgram === "all" || schId === reportProgram;
    const filters = [`Period: ${periodLabel()}`, `Program: ${programLabel()}`];
    const count = (list: { length: number }) => list.length;

    if (key === "scholars") {
      const apps = applications.filter((a) => a.status === "Approved" && inProgram(a.scholarship_id) && within(a.updated_at));
      return {
        title: "List of Scholars", filters, count: count(apps), countLabel: "scholars",
        sections: [{
          name: "Scholars",
          head: ["Name", "Email", "Student ID", "School", "Course", "Year Level", "Scholarship", "Approved On"],
          rows: apps.map((a) => [personName(a.profiles), a.profiles?.email || "—", a.profiles?.student_id_number || "—", a.profiles?.school_name || "—", a.profiles?.course || "—", a.profiles?.year_level || "—", a.scholarships?.name || "—", new Date(a.updated_at).toLocaleDateString()]),
        }],
      };
    }

    if (key === "funds") {
      const programs = fundData.byProgram.filter((r) => reportProgram === "all" || r.id === reportProgram);
      const sections: ReportSection[] = [];
      if (reportProgram === "all") {
        sections.push({ name: "Payment Pipeline", head: ["Status", "Payments", "Amount"], rows: fundData.pipeline.map((r) => [r.status, r.count, r.amount]), money: ["Amount"] });
      }
      sections.push({ name: "By Scholarship Program", head: ["Scholarship", "Scholars Paid", "Disbursed", "Queued"], rows: programs.map((r) => [r.name, r.scholars, r.disbursed, r.queued]), money: ["Disbursed", "Queued"] });
      if (reportProgram === "all") {
        sections.push({ name: "By Payment Method", head: ["Method", "Payments", "Amount", "Share %"], rows: fundData.byMethod.map((r) => [r.method, r.count, r.amount, r.share]), money: ["Amount"] });
      }
      return { title: "Fund Utilization Report", filters, count: count(programs), countLabel: "programs", sections };
    }

    if (key === "disbursements") {
      const programOf = (p: Tables<"payments">) => applications.find((a) => a.id === p.application_id)?.scholarship_id;
      const list = payments.filter((p) => {
        if (!within(p.disbursed_at || p.scheduled_date || p.created_at)) return false;
        if (!inProgram(programOf(p))) return false;
        return reportPayStatus === "all" ? p.status !== "Cancelled" : p.status === reportPayStatus;
      });
      const totals = (["Pending", "Processing", "Disbursed", "Cancelled"] as const)
        .map((st) => { const l = list.filter((p) => p.status === st); return [st, l.length, l.reduce((t, p) => t + Number(p.amount || 0), 0)] as (string | number)[]; })
        .filter((r) => (r[1] as number) > 0);
      return {
        title: "Disbursement Summary",
        filters: [...filters, `Payments: ${reportPayStatus === "all" ? "All except cancelled" : reportPayStatus}`],
        count: count(list), countLabel: "payments",
        sections: [
          {
            name: "Payments",
            head: ["Student", "Program", "Reference", "Method", "Status", "Scheduled", "Disbursed", "Amount"],
            rows: list.map((p) => [payStudent(p), payProgram(p), p.reference || "—", p.method || "—", p.status, p.scheduled_date || "—", p.disbursed_at ? new Date(p.disbursed_at).toLocaleDateString() : "—", Number(p.amount)]),
            money: ["Amount"],
          },
          { name: "Totals by Status", head: ["Status", "Payments", "Amount"], rows: totals, money: ["Amount"] },
        ],
      };
    }

    if (key === "audit") {
      const logs = auditLogs.filter((l) => within(l.created_at));
      return { title: "Audit Trail", filters: [`Period: ${periodLabel()}`], count: count(logs), countLabel: "entries", sections: [logsToSection(logs)] };
    }

    // statistics
    const apps = applications.filter((a) => inProgram(a.scholarship_id) && within(a.created_at));
    const by = (st: string) => apps.filter((a) => a.status === st).length;
    const approved = by("Approved");
    const group = (label: (a: typeof apps[number]) => string): (string | number)[][] => {
      const m = new Map<string, { total: number; approved: number }>();
      apps.forEach((a) => {
        const k = label(a) || "Not specified";
        const v = m.get(k) ?? { total: 0, approved: 0 };
        v.total += 1; if (a.status === "Approved") v.approved += 1;
        m.set(k, v);
      });
      return [...m.entries()].sort((x, y) => y[1].total - x[1].total).map(([k, v]) => [k, v.total, v.approved]);
    };
    return {
      title: "Applicant Statistics", filters, count: count(apps), countLabel: "applications",
      sections: [
        { name: "Summary", head: ["Metric", "Value"], rows: [["Total Applications", apps.length], ["Approved", approved], ["Rejected", by("Rejected")], ["Pending", by("Pending")], ["Waitlisted", by("Waitlisted")], ["Approval Rate (of all)", `${apps.length ? ((approved / apps.length) * 100).toFixed(1) : 0}%`]] },
        { name: "By Scholarship Program", head: ["Scholarship", "Total", "Approved", "Rejected", "Pending", "Waitlisted"], rows: scholarships.filter((sc) => inProgram(sc.id)).map((sc) => { const l = apps.filter((a) => a.scholarship_id === sc.id); const c = (st: string) => l.filter((a) => a.status === st).length; return [sc.name, l.length, c("Approved"), c("Rejected"), c("Pending"), c("Waitlisted")]; }) },
        { name: "By Sex", head: ["Sex", "Applicants", "Approved"], rows: group((a) => a.profiles?.sex || "") },
        { name: "By Year Level", head: ["Year Level", "Applicants", "Approved"], rows: group((a) => a.profiles?.year_level || "") },
        { name: "By School", head: ["School", "Applicants", "Approved"], rows: group((a) => a.profiles?.school_name || "") },
      ],
    };
  };

  const renderPDF = async (def: ReportDef, file: string, landscape = false) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF(landscape ? { orientation: "landscape" } : undefined);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(16);
    doc.text("SB San Jose Scholarship Portal", 14, 15);
    doc.setFontSize(12);
    doc.text(def.title, 14, 22);
    doc.setFontSize(9);
    doc.text(`Generated ${new Date().toLocaleString()}${adminEmail ? ` by ${adminEmail}` : ""}`, 14, 28);
    doc.text(def.filters.join("   |   "), 14, 33);
    let y = 40;
    for (const sec of def.sections) {
      if (y > pageH - 30) { doc.addPage(); y = 15; }
      doc.setFontSize(11);
      doc.text(sec.name, 14, y);
      autoTable(doc, {
        startY: y + 3,
        head: [sec.head],
        body: sec.rows.map((r) => r.map((c, i) => (sec.money?.includes(sec.head[i]) && typeof c === "number" ? formatPHP(c) : String(c)))),
        styles: { fontSize: 8 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.getWidth() - 30, pageH - 8);
    }
    doc.save(file);
    toast.success("PDF downloaded");
  };

  const renderExcel = async (def: ReportDef, file: string) => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[def.title], [`Generated ${new Date().toLocaleString()}`], ...def.filters.map((f) => [f])]), "About");
    const used = new Set<string>(["About"]);
    for (const sec of def.sections) {
      let name = sec.name.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet";
      let n = 2;
      while (used.has(name)) name = `${sec.name.slice(0, 28)} ${n++}`;
      used.add(name);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sec.head, ...sec.rows]), name);
    }
    XLSX.writeFile(wb, file);
    toast.success("Excel downloaded");
  };

  const exportPDF = (key: string) => renderPDF(buildReport(key), `${key}-report.pdf`, key === "disbursements" || key === "audit");
  const exportExcel = (key: string) => renderExcel(buildReport(key), `${key}-report.xlsx`);



  const statusBadge = (status: string) => <StatusBadge status={status} />;

  const disbStatusBadge = (status: string) => <StatusBadge status={status} />;

  // Notification deep links look like /admin?section=disbursement
  const goToLink = (link: string) => {
    const u = new URL(link, window.location.origin);
    if (u.pathname === "/admin") {
      const sec = u.searchParams.get("section");
      if (sec && sidebarItems.some((i) => i.key === sec)) setActiveSection(sec);
    } else {
      router.push(link);
    }
  };

  activeSectionRef.current = activeSection;
  goToLinkRef.current = goToLink;

  // A deep link or history entry can point at a section this role can't open.
  useEffect(() => {
    if (!loading && !canOpen(activeSection)) setActiveSection("overview");
  }, [loading, activeSection, adminRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sec = new URLSearchParams(window.location.search).get("section");
    if (sec && sidebarItems.some((i) => i.key === sec)) setActiveSection(sec);
  }, []);

  const APP_PAGE_SIZE = 10;
  // Registered students who haven't submitted an application yet. They count as applicants so
  // admins can see who is stuck (usually on the required documents) and follow up.
  const notApplied = useMemo(() => {
    const applied = new Set(applications.map((a) => a.user_id));
    return profiles.filter((p) => !applied.has(p.id));
  }, [profiles, applications]);
  // Required documents uploaded (and not rejected) by a student who hasn't applied yet.
  const docsReady = (userId: string) => {
    const required = parseSettings(systemSettings).required_documents;
    const ok = required.filter((type) => {
      const latest = allDocs
        .filter((d) => d.user_id === userId && d.document_type === type && d.application_id === null)
        .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
      return latest && latest.status !== "Rejected";
    });
    return { done: ok.length, total: required.length, missing: required.filter((t) => !ok.includes(t)) };
  };
  // Applicant pipeline: registered → applied (pending) → approved / rejected → scholar → paid.
  const pipeline = useMemo(() => {
    const by = (st: string) => applications.filter((a) => a.status === st).length;
    const paidScholars = new Set(payments.filter((p) => p.status === "Disbursed").map((p) => p.user_id));
    return {
      total: notApplied.length + new Set(applications.map((a) => a.user_id)).size,
      notApplied: notApplied.length,
      pending: by("Pending"),
      waitlisted: by("Waitlisted"),
      approved: by("Approved"),
      rejected: by("Rejected"),
      scholars: scholars.length,
      disbursed: paidScholars.size,
    };
  }, [applications, payments, notApplied, scholars]);

  // ── Review queue: work waiting on staff, whoever it belongs to ──
  const pendingDocsByStudent = useMemo(() => {
    // Only the latest upload of each document type counts; older copies were replaced.
    const latest = new Map<string, DocSummary>();
    for (const d of allDocs) {
      const k = `${d.user_id}|${d.document_type}`;
      const cur = latest.get(k);
      if (!cur || d.uploaded_at > cur.uploaded_at) latest.set(k, d);
    }
    const byStudent = new Map<string, DocSummary[]>();
    for (const d of latest.values()) {
      if (d.status !== "Pending" || !profiles.some((p) => p.id === d.user_id)) continue;
      byStudent.set(d.user_id, [...(byStudent.get(d.user_id) ?? []), d]);
    }
    return [...byStudent.entries()]
      .map(([userId, docs]) => ({ userId, docs, oldest: docs.reduce((m, d) => (d.uploaded_at < m ? d.uploaded_at : m), docs[0].uploaded_at) }))
      .sort((x, y) => x.oldest.localeCompare(y.oldest));
  }, [allDocs, profiles]);
  const pendingGrades = gradeReviews.filter((g) => g.status === "Pending");
  const pendingDeletions = dataReqs.filter((r) => r.status === "Pending");
  const receiptsToReview = payments.filter((p) => p.student_receipt_at && p.receipt_review_status === "Pending");
  const openIssues = payIssues.filter((i) => i.status === "Open");
  const queues = ([
    { key: "documents", label: "Documents", count: pendingDocsByStudent.length, area: "review" },
    { key: "grades", label: "Grades", count: pendingGrades.length, area: "review" },
    { key: "receipts", label: "Student receipts", count: receiptsToReview.length, area: "finance" },
    { key: "problems", label: "Payment problems", count: openIssues.length, area: "finance" },
    { key: "deletions", label: "Deletion requests", count: pendingDeletions.length, area: "manage" },
  ] as { key: string; label: string; count: number; area: StaffArea }[]).filter((x) => staffCan(adminRole, x.area));
  const queueTotal = queues.reduce((t, x) => t + x.count, 0);
  const activeQueue = queues.find((x) => x.key === queueTab) ?? queues.find((x) => x.count > 0) ?? queues[0];
  const openQueue = (key: string) => { setQueueTab(key); setActiveSection("queue"); };

  // Programs with room (slots and budget) and people on the waitlist: someone can be promoted.
  const waitlistOpenings = scholarships.flatMap((sch) => {
    const waiting = applications.filter((a) => a.scholarship_id === sch.id && a.status === "Waitlisted").length;
    if (!waiting) return [];
    const free = sch.slots > 0 ? sch.slots - approvedCount(sch.id) : Infinity;
    const budgetLeft = Number(sch.total_budget) > 0 ? Number(sch.total_budget) - committedFor(sch) : Infinity;
    if (free <= 0 || budgetLeft < Math.max(Number(sch.amount) || 0, 0.01)) return [];
    return [{ sch, waiting, free }];
  });

  const showApplicants = (status: string, program = "all") => {
    setStatusFilter(status); setAppProgram(program); setAppPage(1); setSelectedApps(new Set()); setActiveSection("applications");
  };
  // Shown on Applicant Management; the Dashboard's stat cards follow the same order.
  const pipelineStrip = (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
      {([
        { label: "Total applicants", value: pipeline.total, sub: "registered students", go: () => showApplicants("all") },
        { label: "Not yet applied", value: pipeline.notApplied, sub: "registered, no application", go: () => showApplicants("not_applied"), warn: pipeline.notApplied > 0 },
        { label: "Pending", value: pipeline.pending, sub: pipeline.waitlisted ? `+ ${pipeline.waitlisted} waitlisted` : "awaiting review", go: () => showApplicants("pending") },
        { label: "Approved", value: pipeline.approved, sub: "applications", go: () => showApplicants("approved") },
        { label: "Rejected", value: pipeline.rejected, sub: "applications", go: () => showApplicants("rejected") },
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
  const termOf = (a: { academic_year: string | null; semester: string | null }) => [a.academic_year, a.semester].filter(Boolean).join(" · ");
  const appTerms = [...new Set(applications.map(termOf).filter(Boolean))].sort().reverse();
  const q = appSearch.trim().toLowerCase();
  // Students who haven't applied have no program or term, so those filters leave them out.
  const includeNotApplied = (statusFilter === "all" || statusFilter === "not_applied") && appProgram === "all" && appTerm === "all";
  const rowGrade = (r: ApplicantRow) => (r.kind === "app" ? r.app.average_grade ?? r.app.profiles?.average_grade : r.profile.average_grade) ?? null;
  const rowIncome = (r: ApplicantRow) => (r.kind === "app" ? r.app.household_income : null);
  const filteredApps: ApplicantRow[] = [
    ...(includeNotApplied
      ? notApplied
          .filter((p) => !q || `${personName(p)} ${p.email || ""}`.toLowerCase().includes(q))
          .map((p): ApplicantRow => ({ kind: "none", profile: p, at: p.created_at }))
      : []),
    ...applications
      .filter((a) => statusFilter === "all" || a.status.toLowerCase() === statusFilter)
      .filter((a) => appProgram === "all" || a.scholarship_id === appProgram)
      .filter((a) => appTerm === "all" || termOf(a) === appTerm)
      .filter((a) => !q || personName(a.profiles).toLowerCase().includes(q) || (a.scholarships?.name || "").toLowerCase().includes(q))
      .map((a): ApplicantRow => ({ kind: "app", app: a, at: a.created_at })),
  ].sort((x, y) => {
    // Ranking: highest grade first, or lowest household income first (unknowns last).
    if (appSort === "grade") return (rowGrade(y) ?? -1) - (rowGrade(x) ?? -1);
    if (appSort === "income") return (rowIncome(x) ?? Infinity) - (rowIncome(y) ?? Infinity);
    return appSort === "oldest" ? x.at.localeCompare(y.at) : y.at.localeCompare(x.at);
  });
  const rowKey = (r: ApplicantRow) => (r.kind === "app" ? r.app.id : `none-${r.profile.id}`);
  const selectedRows = filteredApps.filter((r) => selectedApps.has(rowKey(r)));
  const selectedDecidable = selectedRows.flatMap((r) => (r.kind === "app" && ["Pending", "Waitlisted"].includes(r.app.status) ? [r.app] : []));
  const selectedNotApplied = selectedRows.flatMap((r) => (r.kind === "none" ? [r.profile] : []));
  const toggleRow = (key: string) => setSelectedApps((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const exportApplicants = async () => {
    const XLSX = await import("xlsx");
    const rows = filteredApps.map((r) => {
      const p = r.kind === "app" ? r.app.profiles : r.profile;
      return {
        Name: personName(p), Email: p?.email || "—", "Student ID": p?.student_id_number || "—",
        School: (r.kind === "app" ? r.app.school_name : null) || p?.school_name || "—",
        Course: (r.kind === "app" ? r.app.course : null) || p?.course || "—",
        "Year Level": (r.kind === "app" ? r.app.year_level : null) || p?.year_level || "—",
        Scholarship: r.kind === "app" ? r.app.scholarships?.name || "—" : "No application yet",
        Term: r.kind === "app" ? termOf(r.app) || "—" : "—",
        Type: r.kind === "app" ? (r.app.is_renewal ? "Renewal" : "New") : "—",
        Grade: rowGrade(r) ?? "—",
        "Household income": rowIncome(r) ?? "—",
        "Household size": r.kind === "app" ? r.app.household_size ?? "—" : "—",
        Status: r.kind === "app" ? r.app.status : "Not yet applied",
        Date: new Date(r.at).toLocaleDateString(),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Applicants");
    XLSX.writeFile(wb, "applicants.xlsx");
    toast.success("Excel downloaded");
  };
  const appPages = Math.max(1, Math.ceil(filteredApps.length / APP_PAGE_SIZE));
  const currentAppPage = Math.min(appPage, appPages);
  const pagedApps = filteredApps.slice((currentAppPage - 1) * APP_PAGE_SIZE, currentAppPage * APP_PAGE_SIZE);

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

    const monthMap = new Map<string, number>();
    inRange.filter((p) => p.status === "Disbursed").forEach((p) => {
      const d = new Date(payDate(p));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, (monthMap.get(key) ?? 0) + Number(p.amount || 0));
    });
    const monthly = [...monthMap.entries()].sort(([x], [y]) => x.localeCompare(y))
      .map(([key, amount]) => ({ month: new Date(`${key}-01`).toLocaleDateString("en-PH", { month: "short", year: "2-digit" }), Disbursed: amount }));

    const recent = [...inRange].sort((x, y) => new Date(payDate(y)).getTime() - new Date(payDate(x)).getTime()).slice(0, 8);

    // Approved awards with something left to schedule: an unscheduled balance, or (no award amount
    // set) no payment at all yet.
    const live = payments.filter((p) => p.status !== "Cancelled");
    const awaiting = applications.filter((a) => {
      if (a.status !== "Approved") return false;
      const mine = live.filter((p) => p.application_id === a.id);
      const award = Number(a.amount_approved ?? scholarships.find((x) => x.id === a.scholarship_id)?.amount ?? 0);
      return award > 0 ? mine.reduce((t, p) => t + Number(p.amount || 0), 0) < award - 0.005 : mine.length === 0;
    });

    return { pipeline, byProgram, byMethod, monthly, recent, awaiting, disbursedTotal };
  }, [payments, applications, scholarships, fundPeriod, fromDate, toDate]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r flex flex-col transform transition-transform lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 p-4 border-b">
          <Image src="/municipal-logo.png" alt="Logo" width={32} height={32} className="h-8 w-8" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">SB San Jose Admin</p>
            <p className="text-xs text-muted-foreground truncate">Scholarship System</p>
          </div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}><X className="h-5 w-5" /></button>
        </div>
        <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
          {sidebarItems.filter((item) => canOpen(item.key)).map((item, i, visible) => {
            const unread = item.key === "notifications" ? unreadTotal : item.key === "queue" ? queueTotal : 0;
            const firstOfGroup = i === 0 || visible[i - 1].group !== item.group;
            return (
              <div key={item.key}>
              {firstOfGroup && (
                <p className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 ${i === 0 ? "" : "pt-3"}`}>{item.group}</p>
              )}
              <button onClick={() => { setActiveSection(item.key); setSidebarOpen(false); }}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeSection === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <item.icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span>
                {unread > 0 && (
                  <span className={`ml-auto text-xs font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1 ${activeSection === item.key ? "bg-white/25 text-primary-foreground" : "bg-primary text-primary-foreground"}`}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
              </div>
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
              verifications={verifications}
              auditLogs={auditLogs}
              firstName={adminProfile?.first_name}
              refreshing={refreshing}
              lastUpdated={lastUpdated}
              loadError={loadError}
              onRefresh={() => loadData(true)}
              onViewApp={setViewApp}
              onNavigate={(section, opts) => {
                if (!canOpen(section)) return;
                setActiveSection(section);
                if (opts?.status !== undefined) { setStatusFilter(opts.status); setAppProgram("all"); setAppPage(1); }
                if (opts?.verif !== undefined) { setVerifFilter(opts.verif); setVerifPage(1); }
              }}
              canOpen={canOpen}
              extraAttention={[
                ...(pendingDocsByStudent.length ? [{ icon: FileText, tone: "text-warning", section: "queue:review", cta: "Review", go: () => openQueue("documents"),
                  text: `${pendingDocsByStudent.length} student${pendingDocsByStudent.length === 1 ? " has" : "s have"} documents to review` }] : []),
                ...(pendingGrades.length ? [{ icon: GraduationCap, tone: "text-warning", section: "queue:review", cta: "Review", go: () => openQueue("grades"),
                  text: `${pendingGrades.length} grade update${pendingGrades.length === 1 ? "" : "s"} to verify` }] : []),
                ...(receiptsToReview.length ? [{ icon: Receipt, tone: "text-warning", section: "queue:finance", cta: "Review", go: () => openQueue("receipts"),
                  text: `${receiptsToReview.length} student receipt${receiptsToReview.length === 1 ? "" : "s"} to review` }] : []),
                ...(openIssues.length ? [{ icon: AlertTriangle, tone: "text-destructive", section: "queue:finance", cta: "Respond", go: () => openQueue("problems"),
                  text: `${openIssues.length} open payment problem${openIssues.length === 1 ? "" : "s"}` }] : []),
                ...(pendingDeletions.length ? [{ icon: Trash2, tone: "text-destructive", section: "queue:manage", cta: "Handle", go: () => openQueue("deletions"),
                  text: `${pendingDeletions.length} account deletion request${pendingDeletions.length === 1 ? "" : "s"}` }] : []),
                ...waitlistOpenings.map(({ sch, waiting, free }) => ({ icon: Hourglass, tone: "text-primary", section: "applications", cta: "Promote",
                  go: () => showApplicants("waitlisted", sch.id),
                  text: `${sch.name}: ${free === Infinity ? "slots open" : `${free} slot${free === 1 ? "" : "s"} free`}, ${waiting} waitlisted` })),
              ]}
            />
          )}

          {/* REVIEW QUEUE */}
          {activeSection === "queue" && (() => {
            const prof = (id: string) => profiles.find((p) => p.id === id);
            const when = (d: string) => new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
            const empty = (cols: number, text: string) => <TableRow><TableCell colSpan={cols} className="text-center py-8 text-muted-foreground">{text}</TableCell></TableRow>;
            const head = (cols: string[]) => (
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                {cols.map((c, i) => <TableHead key={c} className={i === cols.length - 1 ? "text-right" : undefined}>{c}</TableHead>)}
              </TableRow></TableHeader>
            );
            return (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="text-xl font-display font-bold">Review Queue</h2>
                  <p className="text-sm text-muted-foreground">Everything waiting on staff, oldest first.</p>
                </div>
                <div className="flex flex-wrap gap-2" role="tablist">
                  {queues.map((x) => (
                    <button key={x.key} type="button" role="tab" aria-selected={activeQueue?.key === x.key} onClick={() => setQueueTab(x.key)}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${activeQueue?.key === x.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                      {x.label}
                      <span className={`rounded-full px-1.5 text-xs font-bold ${activeQueue?.key === x.key ? "bg-white/25" : x.count ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{x.count}</span>
                    </button>
                  ))}
                </div>
                <Card>
                  <Table>
                    {activeQueue?.key === "documents" && (<>
                      {head(["Student", "Documents to review", "Waiting since", "Action"])}
                      <TableBody>
                        {pendingDocsByStudent.length === 0 && empty(4, "No documents waiting for review")}
                        {pendingDocsByStudent.map((r) => {
                          const p = prof(r.userId);
                          const app = applications.find((a) => a.user_id === r.userId && (a.status === "Pending" || a.status === "Waitlisted"));
                          return (
                            <TableRow key={r.userId}>
                              <TableCell><p className="font-medium">{personName(p)}</p><p className="text-xs text-muted-foreground">{app ? `${app.scholarships?.name || "Application"} · ${app.status}` : "No open application"}</p></TableCell>
                              <TableCell className="text-sm">{r.docs.map((d) => d.document_type).join(", ")}</TableCell>
                              <TableCell className="text-sm">{when(r.oldest)}</TableCell>
                              <TableCell className="text-right"><Button size="sm" onClick={() => (app ? setViewApp(app) : p && setViewStudent(p))}>Review</Button></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </>)}
                    {activeQueue?.key === "grades" && (<>
                      {head(["Student", "Grade", "Term", "Submitted", "Actions"])}
                      <TableBody>
                        {pendingGrades.length === 0 && empty(5, "No grade updates waiting")}
                        {[...pendingGrades].reverse().map((g) => (
                          <TableRow key={g.id}>
                            <TableCell className="font-medium">{personName(prof(g.user_id))}<p className="text-xs font-normal text-muted-foreground">Current: {prof(g.user_id)?.average_grade ?? "—"}</p></TableCell>
                            <TableCell className="font-semibold">{g.grade}</TableCell>
                            <TableCell className="text-sm">{g.term}</TableCell>
                            <TableCell className="text-sm">{when(g.created_at)}</TableCell>
                            <TableCell className="text-right space-x-1 whitespace-nowrap">
                              <Button size="sm" variant="outline" onClick={() => openStoredFile(g.file_path, "No grade report on file")}>View report</Button>
                              <Button size="sm" disabled={payBusy} onClick={() => reviewGrade(g, "Verified")}>Verify</Button>
                              <Button size="sm" variant="outline" className="text-destructive" disabled={payBusy} onClick={() => { setGradeNote(""); setRejectGrade(g); }}>Reject</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </>)}
                    {activeQueue?.key === "receipts" && (<>
                      {head(["Student", "Payment", "Submitted", "Actions"])}
                      <TableBody>
                        {receiptsToReview.length === 0 && empty(4, "No student receipts waiting")}
                        {[...receiptsToReview].sort((x, y) => (x.student_receipt_at ?? "").localeCompare(y.student_receipt_at ?? "")).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell><p className="font-medium">{payStudent(p)}</p><p className="text-xs text-muted-foreground">{payProgram(p)}</p></TableCell>
                            <TableCell className="text-sm">{formatPHP(Number(p.amount))} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</TableCell>
                            <TableCell className="text-sm">{p.student_receipt_at && when(p.student_receipt_at)}{!p.student_receipt_path && <p className="text-xs text-muted-foreground">Confirmed without a file</p>}</TableCell>
                            <TableCell className="text-right space-x-1 whitespace-nowrap">
                              {p.student_receipt_path && <Button size="sm" variant="outline" onClick={() => viewStudentReceipt(p)}>View</Button>}
                              <Button size="sm" disabled={payBusy} onClick={() => reviewReceipt(p, "Accepted")}>Accept</Button>
                              <Button size="sm" variant="outline" className="text-destructive" disabled={payBusy} onClick={() => { setReceiptNote(""); setRejectReceipt(p); }}>Reject</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </>)}
                    {activeQueue?.key === "problems" && (<>
                      {head(["Student", "Problem", "Reported", "Action"])}
                      <TableBody>
                        {openIssues.length === 0 && empty(4, "No open payment problems")}
                        {[...openIssues].reverse().map((i) => {
                          const pay = payments.find((p) => p.id === i.payment_id);
                          return (
                            <TableRow key={i.id}>
                              <TableCell><p className="font-medium">{personName(prof(i.user_id))}</p>{pay && <p className="text-xs text-muted-foreground">{formatPHP(Number(pay.amount))} · {pay.status}</p>}</TableCell>
                              <TableCell className="text-sm max-w-[360px]"><span className="font-medium">{{ not_received: "Not received", wrong_amount: "Wrong amount", other: "Other" }[i.kind] ?? i.kind}:</span> <span className="line-clamp-2">{i.message}</span></TableCell>
                              <TableCell className="text-sm">{when(i.created_at)}</TableCell>
                              <TableCell className="text-right">{pay && <Button size="sm" onClick={() => { setIssueResponse(""); setIssueDialog(pay); }}>Respond</Button>}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </>)}
                    {activeQueue?.key === "deletions" && (<>
                      {head(["Student", "Reason", "Requested", "Actions"])}
                      <TableBody>
                        {pendingDeletions.length === 0 && empty(4, "No deletion requests")}
                        {[...pendingDeletions].reverse().map((r) => {
                          const p = prof(r.user_id);
                          const paid = payments.some((x) => x.user_id === r.user_id && x.status === "Disbursed");
                          return (
                            <TableRow key={r.id}>
                              <TableCell><p className="font-medium">{personName(p)}</p>{paid && <p className="text-xs text-warning">Has disbursed payments (must be kept)</p>}</TableCell>
                              <TableCell className="text-sm max-w-[320px]">{r.reason || "—"}</TableCell>
                              <TableCell className="text-sm">{when(r.created_at)}</TableCell>
                              <TableCell className="text-right space-x-1 whitespace-nowrap">
                                {p && <Button size="sm" variant="ghost" onClick={() => setViewStudent(p)}>Profile</Button>}
                                <Button size="sm" variant="outline" onClick={() => { setReqResponse(""); setHandleReq({ req: r, status: "Declined" }); }}>Decline</Button>
                                <Button size="sm" variant="destructive" disabled={paid} title={paid ? "Disbursed payments must be kept; decline instead" : undefined}
                                  onClick={() => { setReqResponse("Your account and data have been deleted."); setHandleReq({ req: r, status: "Completed" }); }}>Delete account…</Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </>)}
                    {!activeQueue && <TableBody>{empty(1, "Nothing for your role to review")}</TableBody>}
                  </Table>
                </Card>
              </div>
            );
          })()}

          {/* APPLICATIONS */}
          {activeSection === "applications" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Applicant Management</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search name, scholarship..." value={appSearch} onChange={(e) => { setAppSearch(e.target.value); setAppPage(1); }} className="pl-9 w-60" />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setAppPage(1); setSelectedApps(new Set()); }}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="not_applied">Not yet applied</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="waitlisted">Waitlisted</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="revoked">Revoked</SelectItem>
                      <SelectItem value="withdrawn">Withdrawn</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={appProgram} onValueChange={(v) => { setAppProgram(v); setAppPage(1); setSelectedApps(new Set()); }}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All programs</SelectItem>
                      {scholarships.map((sc) => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={appTerm} onValueChange={(v) => { setAppTerm(v); setAppPage(1); setSelectedApps(new Set()); }}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All terms</SelectItem>
                      {appTerms.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={appSort} onValueChange={(v) => { setAppSort(v); setAppPage(1); }}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Sort: Newest</SelectItem>
                      <SelectItem value="oldest">Sort: Oldest</SelectItem>
                      <SelectItem value="grade">Rank: Highest grade</SelectItem>
                      <SelectItem value="income">Rank: Lowest income</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" disabled={filteredApps.length === 0} onClick={exportApplicants}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
                </div>
              </div>
              {pipelineStrip}
              {selectedRows.length > 0 && (
                <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card px-3 py-2 shadow-sm">
                  <span className="text-sm font-medium">{selectedRows.length} selected</span>
                  {selectedDecidable.length > 0 && (<>
                    <Button size="sm" disabled={bulkBusy} onClick={() => decideMany(selectedDecidable.map((a) => a.id), "Approved")}><CheckCircle className="mr-1 h-4 w-4" /> Approve {selectedDecidable.length}</Button>
                    <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => decideMany(selectedDecidable.filter((a) => a.status === "Pending").map((a) => a.id), "Waitlisted")}><Hourglass className="mr-1 h-4 w-4" /> Waitlist</Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={bulkBusy} onClick={() => openDecision(selectedDecidable.map((a) => a.id), "Rejected")}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
                  </>)}
                  {selectedNotApplied.length > 0 && (
                    <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => openReminder(selectedNotApplied.map((p) => p.id))}><Send className="mr-1 h-4 w-4" /> Remind {selectedNotApplied.length}</Button>
                  )}
                  {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelectedApps(new Set())}>Clear</Button>
                </div>
              )}
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-8">
                      <Checkbox aria-label="Select all on this page" checked={pagedApps.length > 0 && pagedApps.every((r) => selectedApps.has(rowKey(r)))}
                        onCheckedChange={(on) => setSelectedApps((prev) => { const n = new Set(prev); pagedApps.forEach((r) => (on ? n.add(rowKey(r)) : n.delete(rowKey(r)))); return n; })} />
                    </TableHead>
                    <TableHead>Applicant</TableHead><TableHead>Scholarship</TableHead><TableHead>Grade</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredApps.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No applicants found</TableCell></TableRow>}
                    {pagedApps.map((row) => {
                      const key = rowKey(row);
                      const tick = <TableCell><Checkbox aria-label="Select" checked={selectedApps.has(key)} onCheckedChange={() => toggleRow(key)} /></TableCell>;
                      if (row.kind === "none") {
                        const p = row.profile;
                        const docs = docsReady(p.id);
                        return (
                          <TableRow key={key} className="bg-amber-50/40 dark:bg-amber-950/10">
                            {tick}
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
                              <Button size="icon" variant="ghost" title="Send a reminder" onClick={() => openReminder([p.id])}><Send className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" title="View profile" onClick={() => setViewStudent(p)}><Eye className="h-4 w-4" /></Button>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const a = row.app;
                      const name = a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "—";
                      return (
                        <TableRow key={key}>
                          {tick}
                          <TableCell>
                            <p className="font-medium">{name}</p>
                            <div className="mt-1 flex gap-1 flex-wrap empty:hidden">
                              {gradeReviews.some((g) => g.user_id === a.user_id && g.status === "Pending") && <Badge variant="secondary" className="text-[10px]">Grade to review</Badge>}
                              {dataReqs.some((r) => r.user_id === a.user_id && r.status === "Pending") && <Badge variant="destructive" className="text-[10px]">Deletion requested</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            {a.scholarships?.name || "—"}
                            {termOf(a) && <p className="text-xs text-muted-foreground">{termOf(a)}{a.is_renewal ? " · Renewal" : ""}</p>}
                          </TableCell>
                          <TableCell>{a.average_grade ?? a.profiles?.average_grade ?? "—"}</TableCell>
                          <TableCell>{new Date(a.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{statusBadge(a.status)}</TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            <Button size="icon" variant="ghost" onClick={() => setViewApp(a)} title="View"><Eye className="h-4 w-4" /></Button>
                            {(a.status === "Pending" || a.status === "Waitlisted") && (<>
                              <Button size="icon" variant="ghost" disabled={!!approveBlocker(a)} title={approveBlocker(a) ?? (a.status === "Waitlisted" ? "Promote from waitlist" : "Approve")} onClick={async () => {
                                if (await decideApplication(a, "Approved")) { toast.success(`${name} approved!`); loadData(); }
                              }}><CheckCircle className="h-4 w-4 text-success" /></Button>
                              {a.status === "Pending" && (
                                <Button size="icon" variant="ghost" title="Waitlist" onClick={async () => {
                                  if (await decideApplication(a, "Waitlisted")) { toast.info(`${name} waitlisted`); loadData(); }
                                }}><Hourglass className="h-4 w-4 text-warning" /></Button>
                              )}
                              <Button size="icon" variant="ghost" title="Reject" onClick={() => openDecision([a.id], "Rejected")}><XCircle className="h-4 w-4 text-destructive" /></Button>
                            </>)}
                            {a.status === "Approved" && (
                              <Button size="icon" variant="ghost" title="Revoke scholarship" onClick={() => openDecision([a.id], "Revoked")}><Ban className="h-4 w-4 text-destructive" /></Button>
                            )}
                            {(a.status === "Rejected" || a.status === "Revoked") && (
                              <Button size="icon" variant="ghost" title={a.status === "Revoked" ? "Reopen for review (reinstate)" : "Reopen"} onClick={async () => {
                                if (await decideApplication(a, "Pending")) { toast.success(`${name} reopened`); loadData(); }
                              }}><RotateCcw className="h-4 w-4" /></Button>
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
                  {canManage && (
                    <Button className="bg-gradient-primary shadow-primary" onClick={() => { setSchActive(true); setSchYearLevels([]); setSchDialog("new"); }}>
                      <Plus className="mr-1 h-4 w-4" /> Add Scholarship
                    </Button>
                  )}
                </div>
              </div>

              <Dialog open={schDialog !== null} onOpenChange={(o) => !o && setSchDialog(null)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle className="font-display">{schDialog && schDialog !== "new" ? "Edit Scholarship" : "Add New Scholarship"}</DialogTitle></DialogHeader>
                  {schDialog && (() => {
                    const cur = schDialog === "new" ? null : schDialog;
                    return (
                      <form key={cur?.id ?? "new"} onSubmit={saveScholarship} className="space-y-4">
                        <div><Label>Name</Label><Input name="name" required defaultValue={cur?.name ?? ""} placeholder="Scholarship name" /></div>
                        <div><Label>Description</Label><Textarea name="description" defaultValue={cur?.description ?? ""} placeholder="Description" /></div>
                        <div><Label>Eligibility</Label><Textarea name="eligibility" defaultValue={cur?.eligibility ?? ""} placeholder="Who can apply?" /></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Award per scholar (₱)</Label><Input name="amount" type="number" min={0} step="0.01" defaultValue={cur?.amount ?? 0} /></div>
                          <div><Label>Total budget (₱, 0 = no cap)</Label><Input name="total_budget" type="number" min={0} step="0.01" defaultValue={cur?.total_budget ?? 0} /></div>
                        </div>
                        <p className="-mt-2 text-xs text-muted-foreground">
                          Approving a scholar awards this amount, and approvals stop once the budget is used up.
                          {cur && cur.total_budget > 0 && ` Committed so far: ${formatPHP(committedFor(cur))} of ${formatPHP(cur.total_budget)}.`}
                        </p>
                        <div><Label>Slots (0 = unlimited)</Label><Input name="slots" type="number" min={0} step={1} defaultValue={cur?.slots ?? ""} placeholder="50" /></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Applications open</Label><Input name="open_date" type="date" defaultValue={cur?.open_date ?? ""} /></div>
                          <div><Label>Deadline</Label><Input name="deadline" type="date" defaultValue={cur?.deadline ?? ""} /></div>
                        </div>
                        <div className="rounded-md border p-3 space-y-3">
                          <p className="text-sm font-medium">Eligibility rules <span className="font-normal text-muted-foreground">(enforced when a student applies)</span></p>
                          <div className="grid grid-cols-2 gap-3">
                            <div><Label>Minimum average grade</Label><Input name="min_grade" type="number" min={0} max={100} step="0.01" defaultValue={cur?.min_grade ?? ""} placeholder="Global minimum" /></div>
                            <div><Label>Residents of</Label><Input name="municipality" defaultValue={cur?.municipality ?? ""} placeholder="Any municipality" /></div>
                          </div>
                          <div>
                            <Label>Year levels <span className="font-normal text-muted-foreground">(none ticked = any)</span></Label>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                              {YEAR_LEVELS.map((y) => (
                                <label key={y} className="flex items-center gap-1.5 text-sm">
                                  <input type="checkbox" checked={schYearLevels.includes(y)}
                                    onChange={(e) => setSchYearLevels((prev) => e.target.checked ? [...prev, y] : prev.filter((x) => x !== y))} />
                                  {y}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between rounded-md border px-3 py-2">
                          <Label>Accepting applications</Label>
                          <Switch checked={schActive} onCheckedChange={setSchActive} />
                        </div>
                        <Button type="submit" className="w-full bg-gradient-primary">{cur ? "Save Changes" : "Save Scholarship"}</Button>
                      </form>
                    );
                  })()}
                </DialogContent>
              </Dialog>

              <Dialog open={!!deleteSch} onOpenChange={(o) => !o && setDeleteSch(null)}>
                <DialogContent>
                  <DialogHeader><DialogTitle>Delete {deleteSch?.name}?</DialogTitle></DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    This permanently removes the program.
                    {deleteSch && applicantCount(deleteSch.id) > 0 && ` It has ${applicantCount(deleteSch.id)} application(s), so deletion will be blocked — disable it instead.`}
                  </p>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteSch(null)}>Cancel</Button>
                    <Button variant="destructive" disabled={!!deleteSch && applicantCount(deleteSch.id) > 0} onClick={confirmDeleteScholarship}>Delete</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

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
                            {sch.eligibility && <p className="text-xs text-muted-foreground line-clamp-2" title={sch.eligibility}>{sch.eligibility}</p>}
                          </TableCell>
                          <TableCell className="text-sm">
                            <p>{Number(sch.amount) > 0 ? `${formatPHP(Number(sch.amount))} each` : <span className="text-muted-foreground">No award set</span>}</p>
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
                          <TableCell>
                            {applicantCount(sch.id)}
                            {(() => {
                              const waiting = applications.filter((a) => a.scholarship_id === sch.id && a.status === "Waitlisted").length;
                              const pending = applications.filter((a) => a.scholarship_id === sch.id && a.status === "Pending").length;
                              return (pending > 0 || waiting > 0) && (
                                <button type="button" className="block text-xs text-muted-foreground hover:underline" onClick={() => canReview && showApplicants(waiting && !pending ? "waitlisted" : "all", sch.id)}>
                                  {[pending && `${pending} pending`, waiting && `${waiting} waitlisted`].filter(Boolean).join(" · ")}
                                </button>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-sm">
                            {sch.open_date && <p className="text-xs text-muted-foreground">Opens {sch.open_date}</p>}
                            <p>{sch.deadline || "—"}{isClosed(sch) && <Badge variant="secondary" className="ml-2">Closed</Badge>}</p>
                          </TableCell>
                          <TableCell><Badge variant={sch.is_active ? "default" : "secondary"}>{sch.is_active ? "Active" : "Disabled"}</Badge></TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            {canManage && (<>
                              <Button size="icon" variant="ghost" title="Edit" onClick={() => { setSchActive(sch.is_active); setSchYearLevels(sch.year_levels ?? []); setSchDialog(sch); }}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" title="Duplicate for next year" onClick={() => duplicateScholarship(sch)}><Copy className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" title={sch.is_active ? "Disable" : "Enable"} onClick={() => toggleScholarship(sch)}>
                                {sch.is_active ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4 text-success" />}
                              </Button>
                              {(sch.is_active || applications.some((a) => a.scholarship_id === sch.id && (a.status === "Pending" || a.status === "Waitlisted"))) && (
                                <Button size="icon" variant="ghost" title="Close cycle: disable and reject remaining applicants" onClick={() => { setCloseNote(""); setCloseCycle(sch); }}><Ban className="h-4 w-4 text-warning" /></Button>
                              )}
                              <Button size="icon" variant="ghost" title="Delete" onClick={() => setDeleteSch(sch)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </>)}
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
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Name</TableHead><TableHead>Student ID</TableHead><TableHead>School / Course</TableHead><TableHead>Year</TableHead><TableHead>Grade</TableHead><TableHead>Apps</TableHead><TableHead>Verification</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagedStudents.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{scholars.length === 0 ? "No scholars yet. Applicants appear here once approved." : "No scholars match your search"}</TableCell></TableRow>}
                    {pagedStudents.map((p) => {
                      const ver = verificationForUser(p.id);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <p className="font-medium">{p.first_name} {p.last_name}</p><p className="text-xs text-muted-foreground">{p.email}</p>
                            <div className="mt-1 flex gap-1 flex-wrap">
                              {gradeReviews.some((g) => g.user_id === p.id && g.status === "Pending") && <Badge variant="secondary" className="text-[10px]">Grade to review</Badge>}
                              {dataReqs.some((r) => r.user_id === p.id && r.status === "Pending") && <Badge variant="destructive" className="text-[10px]">Deletion requested</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{p.student_id_number || "—"}</TableCell>
                          <TableCell className="text-xs"><p>{p.school_name || "—"}</p><p className="text-muted-foreground">{p.course || "—"}</p></TableCell>
                          <TableCell>{p.year_level || "—"}</TableCell>
                          <TableCell>{p.average_grade ?? "—"}</TableCell>
                          <TableCell>{applications.filter((a) => a.user_id === p.id).length}</TableCell>
                          <TableCell>{ver ? <Badge variant={ver.verification_status === "Verified" ? "default" : ver.verification_status === "Flagged" ? "destructive" : "secondary"}>{ver.verification_status}</Badge> : "—"}</TableCell>
                          <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="icon" variant="ghost" title="View" onClick={() => setViewStudent(p)}><Eye className="h-4 w-4" /></Button>
                            {canManage && (
                              <Button size="icon" variant="ghost" title={p.is_active ? "Deactivate" : "Activate"} onClick={() => toggleStudentActive(p)}>
                                <Power className={`h-4 w-4 ${p.is_active ? "text-destructive" : "text-success"}`} />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                      <SelectItem value="custom">Custom range (Reports)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => exportPDF("funds")}><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
                  <Button variant="outline" onClick={() => exportExcel("funds")}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
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

              <Card>
                <CardHeader><CardTitle className="text-base">Disbursed per Month</CardTitle></CardHeader>
                <CardContent>
                  {fundData.monthly.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No disbursements in this period</p> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={fundData.monthly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <Tooltip formatter={(v: number) => formatPHP(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                        <Bar dataKey="Disbursed" fill="hsl(var(--primary))" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

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
                    <CardTitle className="text-base">Awaiting Payment ({fundData.awaiting.length})</CardTitle>
                    <div className="flex gap-1">
                      {fundData.awaiting.length > 1 && <Button size="sm" variant="outline" onClick={() => { setBulkScheduleDate(defaultScheduledDate); setBulkSchedule(true); }}>Schedule all</Button>}
                      <Button size="sm" variant="ghost" onClick={() => { openNewPayment(); setActiveSection("disbursement"); }}>Schedule payment <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                    </div>
                  </CardHeader>
                  <Table>
                    <TableBody>
                      {fundData.awaiting.length === 0 && <TableRow><TableCell className="text-center py-6 text-muted-foreground">All approved scholars have a payment</TableCell></TableRow>}
                      {fundData.awaiting.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <p className="font-medium">{a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.scholarships?.name || "—"}
                              {remainingFor(a.id) != null && ` · ${formatPHP(remainingFor(a.id) ?? 0)} left of ${formatPHP(awardOf(a))}`}
                            </p>
                          </TableCell>
                          <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { openNewPayment(a.id); setActiveSection("disbursement"); }}>Schedule payment</Button></TableCell>
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
                  {selectedPays.size > 0 && (
                    <Button variant="outline" disabled={bulkBusy} onClick={processSelectedPayments}>
                      {bulkBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Mark {selectedPays.size} processing
                    </Button>
                  )}
                  <Button className="bg-gradient-primary shadow-primary" onClick={() => openNewPayment()}><Plus className="mr-1 h-4 w-4" /> Schedule Payment</Button>
                </div>
              </div>
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-3 flex items-start gap-2">
                  <Lock className="h-4 w-4 text-warning mt-0.5" />
                  <p className="text-sm text-muted-foreground">Payments can only be created for <strong className="text-foreground">approved</strong> applications, and an award can be split into instalments up to its approved amount. Disbursed payments are <strong className="text-foreground">locked</strong> (a mistake can be reversed, with a reason). Only the methods enabled in <strong className="text-foreground">Settings</strong> ({enabledMethods.join(" and ")}) are accepted, and a receipt upload is required before marking as disbursed.</p>
                </CardContent>
              </Card>
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-8">
                      <Checkbox aria-label="Select all pending on this page"
                        checked={pagedPayments.some((p) => p.status === "Pending") && pagedPayments.filter((p) => p.status === "Pending").every((p) => selectedPays.has(p.id))}
                        onCheckedChange={(on) => setSelectedPays((prev) => { const n = new Set(prev); pagedPayments.filter((p) => p.status === "Pending").forEach((p) => (on ? n.add(p.id) : n.delete(p.id))); return n; })} />
                    </TableHead>
                    <TableHead>Student</TableHead><TableHead>Reference / Cheque No.</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Student prefers</TableHead><TableHead>Scheduled</TableHead><TableHead>Status</TableHead><TableHead>Student receipt</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagedPayments.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No payments found</TableCell></TableRow>}
                    {pagedPayments.map((p) => {
                      const open = p.status === "Pending" || p.status === "Processing";
                      return (
                        <TableRow key={p.id} className={p.status === "Cancelled" ? "opacity-60" : undefined}>
                          <TableCell>
                            {p.status === "Pending" && (
                              <Checkbox aria-label="Select" checked={selectedPays.has(p.id)}
                                onCheckedChange={() => setSelectedPays((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{payStudent(p)}</p><p className="text-xs text-muted-foreground">{payProgram(p)}</p>
                            {p.reversed_at && <p className="text-xs text-destructive" title={p.cancel_reason ?? undefined}>Reversed {new Date(p.reversed_at).toLocaleDateString()}</p>}
                          </TableCell>
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
                                  {p.student_receipt_path ? (
                                    <button type="button" onClick={() => viewStudentReceipt(p)} className="inline-flex items-center gap-1 text-xs font-medium text-success hover:underline cursor-pointer">
                                      <CheckCircle className="h-3.5 w-3.5" /> Received · {new Date(p.student_receipt_at).toLocaleDateString()}
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success" title="Student confirmed receiving the cash without attaching a file">
                                      <CheckCircle className="h-3.5 w-3.5" /> Confirmed (no file) · {new Date(p.student_receipt_at).toLocaleDateString()}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant={p.receipt_review_status === "Accepted" ? "default" : "secondary"} className={p.receipt_review_status === "Rejected" ? "text-destructive" : undefined}>
                                      {p.receipt_review_status === "Pending" ? "To review" : p.receipt_review_status}
                                    </Badge>
                                    {p.receipt_review_status !== "Accepted" && (
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={payBusy} onClick={() => reviewReceipt(p, "Accepted")}>Accept</Button>
                                    )}
                                    {p.receipt_review_status !== "Rejected" && (
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-destructive" disabled={payBusy} onClick={() => { setReceiptNote(""); setRejectReceipt(p); }}>Reject</Button>
                                    )}
                                  </div>
                                  {p.receipt_review_status === "Rejected" && p.receipt_review_note && <p className="text-xs text-destructive">{p.receipt_review_note}</p>}
                                </div>
                              ) : <Badge variant="secondary">Awaiting</Badge>}
                          </TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            {payIssues.some((i) => i.payment_id === p.id) && (
                              <Button size="icon" variant="ghost" title={openIssueFor(p.id) ? "Open problem reported by the student" : "Problem reports"} onClick={() => { setIssueResponse(""); setIssueDialog(p); }}>
                                <AlertTriangle className={`h-4 w-4 ${openIssueFor(p.id) ? "text-warning" : "text-muted-foreground"}`} />
                              </Button>
                            )}
                            {(p.status === "Disbursed" || p.reversed_at) && (
                              <Button size="icon" variant="ghost" title="View receipt" onClick={() => viewReceipt(p)}><Receipt className="h-4 w-4" /></Button>
                            )}
                            {p.status === "Disbursed" && (
                              <Button size="icon" variant="ghost" title="Reverse disbursement (mistake)" onClick={() => { setReverseReason(""); setReversePay(p); }}><Undo2 className="h-4 w-4 text-destructive" /></Button>
                            )}
                            {open && (<>
                              <Button size="icon" variant="ghost" title="Edit" onClick={() => { setPayMethod((p.preferred_method ?? p.method) === "Cheque" ? "Cheque" : "Cash"); setPayDialog(p); }}><Pencil className="h-4 w-4" /></Button>
                              {p.status === "Pending" && (
                                <Button size="sm" variant="outline" onClick={() => setPaymentStatus(p, "Processing")}>Process</Button>
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
              <Dialog open={payDialog !== null} onOpenChange={(o) => !o && setPayDialog(null)}>
                <DialogContent className="max-w-md">
                  <DialogHeader><DialogTitle className="font-display">{payDialog && payDialog !== "new" ? "Edit Payment" : "Schedule Payment"}</DialogTitle></DialogHeader>
                  {payDialog && (() => {
                    const cur = payDialog === "new" ? null : payDialog;
                    return (
                      <form key={cur?.id ?? `new-${payAppId}`} onSubmit={savePayment} className="space-y-4">
                        {cur ? (
                          <div><Label className="text-muted-foreground text-xs">Student</Label><p className="font-medium">{payStudent(cur)} <span className="text-xs text-muted-foreground">· {payProgram(cur)}</span></p></div>
                        ) : (
                          <div>
                            <Label>Approved applicant *</Label>
                            <Select value={payAppId} onValueChange={setPayAppId}>
                              <SelectTrigger><SelectValue placeholder={fundData.awaiting.length ? "Select applicant" : "No approved applicants awaiting payment"} /></SelectTrigger>
                              <SelectContent>
                                {fundData.awaiting.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "Unknown"} — {a.scholarships?.name || "—"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {(() => {
                          const appId = cur?.application_id ?? payAppId;
                          const a = applications.find((x) => x.id === appId);
                          const award = awardOf(a);
                          if (!a || award <= 0) return null;
                          const scheduled = liveTotal(a.id) - (cur && cur.status !== "Cancelled" ? Number(cur.amount) : 0);
                          return (
                            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              Award {formatPHP(award)} · already scheduled or paid {formatPHP(scheduled)} · <span className="font-medium text-foreground">{formatPHP(Math.max(award - scheduled, 0))} left</span>. Split it into instalments by scheduling several payments.
                            </p>
                          );
                        })()}
                        <div className="grid grid-cols-2 gap-4">
                          <div><Label>Amount (₱) *</Label><Input key={cur?.id ?? payAppId} name="amount" type="number" min={0.01} step="0.01" required defaultValue={cur?.amount ?? awardFor(payAppId)} /></div>
                          <div><Label>Scheduled date</Label><Input name="scheduled_date" type="date" defaultValue={cur ? (cur.scheduled_date ?? "") : defaultScheduledDate} /></div>
                        </div>
                        <div>
                          <Label>Method</Label>
                          <div className="grid grid-cols-2 gap-3 mt-1">
                            {enabledMethods.map((m) => (
                              <button key={m} type="button" disabled={!!cur?.preferred_method} onClick={() => setPayMethod(m)}
                                className={`rounded-lg border p-2 text-sm font-medium ${cur?.preferred_method ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${payMethod === m ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}>{m}</button>
                            ))}
                          </div>
                        </div>
                        {cur?.preferred_method && <p className="text-xs text-muted-foreground -mt-2">The student chose {cur.preferred_method}; the method is fixed.</p>}
                        <div><Label>{payMethod === "Cheque" ? "Cheque number" : "Reference number"}</Label><Input name="reference" defaultValue={cur?.reference ?? ""} placeholder="Optional now — required to disburse a cheque" /></div>
                        <div><Label>Notes</Label><Textarea name="notes" defaultValue={cur?.notes ?? ""} placeholder="Optional" /></div>
                        <Button type="submit" className="w-full bg-gradient-primary" disabled={!cur && !payAppId}>{cur ? "Save Changes" : "Schedule Payment"}</Button>
                      </form>
                    );
                  })()}
                </DialogContent>
              </Dialog>

              {/* Cancel confirmation */}
              <Dialog open={!!cancelPay} onOpenChange={(o) => !o && setCancelPay(null)}>
                <DialogContent>
                  <DialogHeader><DialogTitle>Cancel this payment?</DialogTitle></DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    {cancelPay && `${formatPHP(cancelPay.amount)} for ${payStudent(cancelPay)} will be cancelled and the student notified. This can't be undone, but you can create a new payment.`}
                  </p>
                  <div>
                    <Label className="text-xs">Reason (shown to the student, optional)</Label>
                    <Textarea rows={2} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Rescheduled to next month." />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCancelPay(null)}>Keep</Button>
                    <Button variant="destructive" onClick={async () => { if (cancelPay && await setPaymentStatus(cancelPay, "Cancelled", cancelReason)) setCancelPay(null); }}>Cancel payment</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Disburse dialog */}
              <Dialog open={disbDialog} onOpenChange={setDisbDialog}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="font-display">Confirm Disbursement</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div>
                      <Label>Payment Method *</Label>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        {enabledMethods.map((m) => (
                          <button
                            key={m}
                            type="button"
                            disabled={disbLocked}
                            onClick={() => { setDisbMethod(m); setDisbRef(""); }}
                            className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-all cursor-pointer ${
                              disbMethod === m
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border hover:border-primary/40"
                            } ${disbLocked ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            {m === "Cash" ? <Banknote className="h-4 w-4" /> : <Receipt className="h-4 w-4" />} {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    {disbLocked && (
                      <p className="text-xs text-muted-foreground">The student chose <strong className="text-foreground">{disbPay?.preferred_method}</strong> for this payment, so the method is fixed.</p>
                    )}
                    <div>
                      <Label>{disbMethod === "Cheque" ? "Cheque Number *" : "Reference Number"}</Label>
                      <Input
                        className="mt-1"
                        placeholder={disbMethod === "Cheque" ? "e.g. CHK-2024-001" : "e.g. REF-001 (optional)"}
                        value={disbRef}
                        onChange={(e) => setDisbRef(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Receipt / Voucher *</Label>
                      <p className="text-xs text-muted-foreground mb-2">Upload the signed receipt or disbursement voucher.</p>
                      <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed p-3 hover:bg-muted/30 transition-colors">
                        <Upload className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {disbReceipt ? disbReceipt.name : "Click to upload receipt (PDF / image)"}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          className="hidden"
                          onChange={(e) => setDisbReceipt(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDisbDialog(false)}>Cancel</Button>
                    <Button
                      className="bg-gradient-primary"
                      disabled={disbLoading || !disbReceipt || (disbMethod === "Cheque" && !disbRef.trim())}
                      onClick={confirmDisbursement}
                    >
                      {disbLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Confirm Disbursement
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* REPORTS */}
          {activeSection === "reports" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Reports & Analytics</h2>
              <Card>
                <CardContent className="py-4 flex gap-3 flex-wrap items-end">
                  <div>
                    <Label className="text-xs">Period</Label>
                    <Select value={fundPeriod} onValueChange={setFundPeriod}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All time</SelectItem>
                        <SelectItem value="year">This year</SelectItem>
                        <SelectItem value="6m">Last 6 months</SelectItem>
                        <SelectItem value="30d">Last 30 days</SelectItem>
                        <SelectItem value="custom">Custom range</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {fundPeriod === "custom" && (<>
                    <div><Label className="text-xs">From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" /></div>
                    <div><Label className="text-xs">To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" /></div>
                  </>)}
                  <div>
                    <Label className="text-xs">Program</Label>
                    <Select value={reportProgram} onValueChange={setReportProgram}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All programs</SelectItem>
                        {scholarships.map((sc) => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Payments (disbursement report)</Label>
                    <Select value={reportPayStatus} onValueChange={setReportPayStatus}>
                      <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All except cancelled</SelectItem>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Processing">Processing</SelectItem>
                        <SelectItem value="Disbursed">Disbursed</SelectItem>
                        <SelectItem value="Cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground -mt-2">Period also applies to Fund Management. Each report shows how many rows your filters will export.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: "List of Scholars", desc: "Approved scholars with contact, school and program", icon: Users, exportKey: "scholars" },
                  { title: "Fund Utilization Report", desc: "Disbursed and queued funds per program, plus payment pipeline and methods", icon: Wallet, exportKey: "funds" },
                  { title: "Disbursement Summary", desc: "Every payment with student, program, method and status, plus totals", icon: Banknote, exportKey: "disbursements" },
                  { title: "Applicant Statistics", desc: "Applications and approval rates by program, sex, year level and school", icon: BarChart3, exportKey: "statistics" },
                  { title: "Audit Trail", desc: "Every recorded admin and student action in the period", icon: ScrollText, exportKey: "audit" },
                ].map((r) => {
                  const def = buildReport(r.exportKey);
                  return (
                    <Card key={r.exportKey}>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2"><r.icon className="h-4 w-4 text-primary" />{r.title}</CardTitle>
                        <CardDescription>{r.desc}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex items-center gap-2 flex-wrap">
                        <Button variant="outline" size="sm" disabled={def.count === 0} onClick={() => exportPDF(r.exportKey)}><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
                        <Button variant="outline" size="sm" disabled={def.count === 0} onClick={() => exportExcel(r.exportKey)}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
                        <span className="text-xs text-muted-foreground ml-auto">{def.count} {def.countLabel}</span>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {activeSection === "notifications" && (
            <div className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-display font-bold">Notifications</h2>
              <NotificationInbox notifications={notifications} setNotifications={setNotifications} onNavigate={goToLink}
                userId={adminUserId} unreadTotal={unreadTotal} onUnreadChange={refreshAdminUnread} />
              <AnnouncementsPanel />
              <Card>
                <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle><CardDescription>Choose what reaches you in the dashboard and by email.</CardDescription></CardHeader>
                <CardContent>
                  <NotificationPreferences userId={adminUserId} email={adminEmail} categories={[
                    { key: "application", label: "Applications", hint: "New applications submitted" },
                    { key: "verification", label: "Verification", hint: "Duplicate ID flags" },
                    { key: "payment", label: "Payments", hint: "Receipts, method choices and unpaid approvals" },
                  ]} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* SETTINGS */}
          {/* SCHOLAR VERIFICATION */}
          {activeSection === "verification" && (() => {
            const VERIF_PAGE_SIZE = 15;
            const nameOf = (v: Tables<"scholar_verifications">) => personName(profiles.find((p) => p.id === v.user_id));
            const vq = verifSearch.trim().toLowerCase();
            const list = verifications.filter((v) => (verifFilter === "all" || v.verification_status === verifFilter)
              && (!vq || `${nameOf(v)} ${v.student_id_number || ""} ${applications.find((x) => x.id === v.application_id)?.scholarships?.name || ""}`.toLowerCase().includes(vq)));
            const pages = Math.max(1, Math.ceil(list.length / VERIF_PAGE_SIZE));
            const page = Math.min(verifPage, pages);
            const paged = list.slice((page - 1) * VERIF_PAGE_SIZE, page * VERIF_PAGE_SIZE);
            const pendingOnPage = paged.filter((v) => v.verification_status === "Pending");
            return (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Scholar Verification</h2>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Name, student ID, program..." value={verifSearch} onChange={(e) => { setVerifSearch(e.target.value); setVerifPage(1); }} className="pl-9 w-60" />
                  </div>
                  <Select value={verifFilter} onValueChange={(v) => { setVerifFilter(v); setVerifPage(1); setSelectedVerifs(new Set()); }}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      {["all", "Pending", "Flagged", "Verified", "Cleared"].map((st) => (
                        <SelectItem key={st} value={st}>{st === "all" ? "All statuses" : st}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedVerifs.size > 0 && (
                    <Button disabled={bulkBusy} onClick={verifySelected}>{bulkBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Verify {selectedVerifs.size} selected</Button>
                  )}
                </div>
              </div>
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-3 flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-warning mt-0.5" />
                  <p className="text-sm text-muted-foreground">Applications can only be approved once their verification is Verified or Cleared. Flagged records share a student ID with another applicant. A verified record can be flagged again if something turns up later.</p>
                </CardContent>
              </Card>
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="w-8">
                      <Checkbox aria-label="Select all pending on this page" disabled={pendingOnPage.length === 0}
                        checked={pendingOnPage.length > 0 && pendingOnPage.every((v) => selectedVerifs.has(v.id))}
                        onCheckedChange={(on) => setSelectedVerifs((prev) => { const n = new Set(prev); pendingOnPage.forEach((v) => (on ? n.add(v.id) : n.delete(v.id))); return n; })} />
                    </TableHead>
                    <TableHead>Applicant</TableHead><TableHead>Application</TableHead><TableHead>Student ID</TableHead><TableHead>Existing Scholarship</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {paged.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No verification records</TableCell></TableRow>
                    )}
                    {paged.map((v) => {
                      const prof = profiles.find((p) => p.id === v.user_id);
                      const app = applications.find((a) => a.id === v.application_id);
                      return (
                        <TableRow key={v.id}>
                          <TableCell>
                            {v.verification_status === "Pending" && (
                              <Checkbox aria-label="Select" checked={selectedVerifs.has(v.id)}
                                onCheckedChange={() => setSelectedVerifs((prev) => { const n = new Set(prev); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })} />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {prof ? <button type="button" className="hover:underline text-left" onClick={() => setViewStudent(prof)}>{nameOf(v)}</button> : "Unknown"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {app ? (
                              <button type="button" className="text-left hover:underline" onClick={() => setViewApp(app)}>
                                <div>{app.scholarships?.name || "—"}</div><div className="text-muted-foreground">{app.status}</div>
                              </button>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {v.student_id_number || "—"}
                            {v.student_id_number && (() => {
                              const dupes = verifications.filter((x) => x.id !== v.id && x.student_id_number === v.student_id_number && x.user_id !== v.user_id).length;
                              return dupes > 0 && <p className="font-sans text-destructive">Also used by {dupes} other applicant{dupes === 1 ? "" : "s"}</p>;
                            })()}
                          </TableCell>
                          <TableCell>
                            {v.has_existing_scholarship ? <Badge variant="destructive">Yes</Badge> : <Badge variant="outline">No</Badge>}
                            {v.existing_scholarship_details && <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">{v.existing_scholarship_details}</p>}
                          </TableCell>
                          <TableCell>
                            <Badge variant={v.verification_status === "Verified" ? "default" : v.verification_status === "Flagged" ? "destructive" : "secondary"}>
                              {v.verification_status}
                            </Badge>
                            {v.notes && <p className="text-xs text-muted-foreground mt-1 max-w-[200px] whitespace-pre-line">{v.notes}</p>}
                          </TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            {(v.verification_status === "Pending" || v.verification_status === "Flagged") && (
                              <Button size="sm" onClick={() => { setVerifNotes(""); setVerifAction({ v, status: "Verified" }); }}>Verify</Button>
                            )}
                            {v.verification_status !== "Flagged" && (
                              <Button size="sm" variant="destructive" onClick={() => { setVerifNotes(""); setVerifAction({ v, status: "Flagged" }); }}>Flag</Button>
                            )}
                            {v.verification_status === "Flagged" && (
                              <Button size="sm" variant="outline" onClick={() => { setVerifNotes(""); setVerifAction({ v, status: "Cleared" }); }}>Clear</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{list.length === 0 ? "0 records" : `Showing ${(page - 1) * VERIF_PAGE_SIZE + 1}–${Math.min(page * VERIF_PAGE_SIZE, list.length)} of ${list.length}`}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setVerifPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span>Page {page} of {pages}</span>
                  <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setVerifPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
              <Dialog open={!!verifAction} onOpenChange={(o) => { if (!o) setVerifAction(null); }}>
                <DialogContent>
                  <DialogHeader><DialogTitle>Mark as {verifAction?.status}</DialogTitle></DialogHeader>
                  {verifAction?.status === "Flagged" && verifAction.v.verification_status !== "Pending" && (
                    <p className="text-sm text-muted-foreground">Flagging a {verifAction.v.verification_status.toLowerCase()} record doesn&apos;t change an approval already made, but blocks new approvals until it is cleared.</p>
                  )}
                  <div className="space-y-2">
                    <Label className="text-xs">Notes {verifAction?.status === "Flagged" ? "(what was found)" : "(optional)"}</Label>
                    <Textarea value={verifNotes} onChange={(e) => setVerifNotes(e.target.value)} placeholder="Reason or evidence..." />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setVerifAction(null)}>Cancel</Button>
                    <Button disabled={verifAction?.status === "Flagged" && !verifNotes.trim()} onClick={submitVerification}>Confirm</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            );
          })()}

          {/* AUDIT LOGS */}
          {activeSection === "audit-logs" && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold">Audit Logs</h2>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={() => renderPDF(auditDef(), "audit-log.pdf", true)}><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
                  <Button variant="outline" onClick={() => renderExcel(auditDef(), "audit-log.xlsx")}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
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
                <Input type="date" value={auditFrom} onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(1); }} className="w-40" aria-label="From date" />
                <Input type="date" value={auditTo} onChange={(e) => { setAuditTo(e.target.value); setAuditPage(1); }} className="w-40" aria-label="To date" />
                {(auditSearch || auditAction !== "all" || auditEntity !== "all" || auditFrom || auditTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setAuditSearch(""); setAuditAction("all"); setAuditEntity("all"); setAuditFrom(""); setAuditTo(""); setAuditPage(1); }}>Clear</Button>
                )}
              </div>
              <Card>
                <Table>
                  <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Changed</TableHead><TableHead className="text-right">Details</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagedLogs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No audit logs found</TableCell></TableRow>}
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
                <span className="flex items-center gap-2 flex-wrap">
                  {filteredLogs.length === 0 ? "0 entries" : `Showing ${(currentAuditPage - 1) * AUDIT_PAGE_SIZE + 1}–${Math.min(currentAuditPage * AUDIT_PAGE_SIZE, filteredLogs.length)} of ${filteredLogs.length}`}
                  {!auditExhausted && (<>
                    <span>(latest {auditLogs.length.toLocaleString()} loaded)</span>
                    <Button size="sm" variant="outline" disabled={loadingOlder} onClick={loadOlderLogs}>
                      {loadingOlder && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Load older entries
                    </Button>
                  </>)}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={currentAuditPage <= 1} onClick={() => setAuditPage(currentAuditPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span>Page {currentAuditPage} of {auditPages}</span>
                  <Button size="sm" variant="outline" disabled={currentAuditPage >= auditPages} onClick={() => setAuditPage(currentAuditPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>

              <Dialog open={!!viewLog} onOpenChange={(o) => !o && setViewLog(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>Audit Entry</DialogTitle></DialogHeader>
                  {viewLog && (() => {
                    const prev = asObj(viewLog.previous_value);
                    const next = asObj(viewLog.new_value);
                    const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
                    return (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div><Label className="text-muted-foreground text-xs">When</Label><p className="font-medium">{new Date(viewLog.created_at).toLocaleString()}</p></div>
                          <div><Label className="text-muted-foreground text-xs">User</Label><p className="font-medium">{viewLog.user_email || "System"}</p></div>
                          <div><Label className="text-muted-foreground text-xs">Action</Label><p className="font-medium">{viewLog.action}</p></div>
                          <div><Label className="text-muted-foreground text-xs">Entity</Label><p className="font-medium">{viewLog.entity_type}</p></div>
                          <div className="col-span-2"><Label className="text-muted-foreground text-xs">Entity ID</Label><p className="font-mono text-xs break-all">{viewLog.entity_id || "—"}</p></div>
                          {viewLog.user_agent && <div className="col-span-2"><Label className="text-muted-foreground text-xs">Device</Label><p className="text-xs text-muted-foreground break-all">{viewLog.user_agent}</p></div>}
                        </div>
                        <div>
                          <Label className="text-xs">Changes</Label>
                          {keys.length === 0 ? <p className="text-sm text-muted-foreground">No values recorded</p> : (
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
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* ADMIN PROFILE */}
          {activeSection === "profile" && (
            <AdminProfilePanel
              profile={adminProfile}
              email={adminEmail}
              userId={adminUserId}
              role={adminRole}
              auditLogs={auditLogs}
              logAudit={logAudit}
              onChanged={() => loadData(true)}
            />
          )}

          {/* STAFF */}
          {activeSection === "staff" && <StaffPanel userId={adminUserId} role={adminRole} onChanged={() => loadData(true)} />}

          {/* SETTINGS */}
          {activeSection === "settings" && (
            <div className="space-y-4">
              <SettingsPanel rows={systemSettings} auditLogs={auditLogs} onSave={saveSettings} />
              <ReminderJobsCard />
            </div>
          )}
        </main>
      </div>

      <Dialog open={!!viewApp} onOpenChange={(open) => !open && setViewApp(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Application Details</DialogTitle></DialogHeader>
          {viewApp && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-muted-foreground text-xs">Applicant</Label>
                  <p className="font-medium">{viewApp.profiles ? `${viewApp.profiles.first_name} ${viewApp.profiles.last_name}` : "—"}</p>
                  {profiles.some((p) => p.id === viewApp.user_id) && (
                    <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setViewStudent(profiles.find((p) => p.id === viewApp.user_id) ?? null)}>View full profile</button>
                  )}
                </div>
                <div><Label className="text-muted-foreground text-xs">Email</Label><p className="font-medium">{viewApp.profiles?.email || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">School</Label><p className="font-medium">{viewApp.profiles?.school_name || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Course</Label><p className="font-medium">{viewApp.profiles?.course || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Year Level</Label><p className="font-medium">{viewApp.profiles?.year_level || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Grade</Label><p className="font-medium">{viewApp.profiles?.average_grade || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Scholarship</Label><p className="font-medium">{viewApp.scholarships?.name || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Status</Label><div>{statusBadge(viewApp.status)}</div></div>
                <div><Label className="text-muted-foreground text-xs">Type</Label><p className="font-medium">{viewApp.is_renewal ? "Renewal" : "New application"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Term</Label><p className="font-medium">{[viewApp.academic_year, viewApp.semester].filter(Boolean).join(" · ") || "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Grade when applied</Label><p className="font-medium">{viewApp.average_grade ?? "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Household income</Label><p className="font-medium">{viewApp.household_income != null ? `₱${Number(viewApp.household_income).toLocaleString("en-PH")}` : "—"}</p></div>
                <div><Label className="text-muted-foreground text-xs">Household size</Label><p className="font-medium">{viewApp.household_size ?? "—"}</p></div>
              </div>
              <div>
                <Label className="text-xs">Applicant statement</Label>
                <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{viewApp.statement || "—"}</p>
              </div>
              <div>
                <Label className="text-xs">Documents</Label>
                {docList(viewDocs, docsLoading)}
              </div>
              <div>
                <Label className="text-xs">Reviewer Remarks</Label>
                <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add notes..." />
                {canReview && !["Pending", "Waitlisted"].includes(viewApp.status) && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={async () => {
                    const notes = remarks.trim() || null;
                    const { error } = await supabase.from("applications").update({ notes }).eq("id", viewApp.id);
                    if (error) { toast.error(error.message); return; }
                    toast.success("Remarks saved"); loadData();
                  }}>Save remarks</Button>
                )}
              </div>
              {(viewApp.status === "Pending" || viewApp.status === "Waitlisted") && approveBlocker(viewApp) && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Can&apos;t approve yet. {approveBlocker(viewApp)}.</p>
              )}
              {canReview && (viewApp.status === "Pending" || viewApp.status === "Waitlisted") && (
                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button className="flex-1" disabled={!!approveBlocker(viewApp)} title={approveBlocker(viewApp) ?? undefined} onClick={async () => {
                    if (await decideApplication(viewApp, "Approved", remarks)) { toast.success("Approved!"); setViewApp(null); loadData(); }
                  }}><CheckCircle className="mr-1 h-4 w-4" /> Approve</Button>
                  {viewApp.status === "Pending" && (
                    <Button variant="outline" className="flex-1" onClick={async () => {
                      if (await decideApplication(viewApp, "Waitlisted", remarks)) { toast.info("Waitlisted"); setViewApp(null); loadData(); }
                    }}><Hourglass className="mr-1 h-4 w-4" /> Waitlist</Button>
                  )}
                  <Button variant="destructive" className="flex-1" onClick={() => openDecision([viewApp.id], "Rejected", remarks)}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
                </div>
              )}
              {canReview && viewApp.status === "Approved" && (
                <Button variant="outline" className="w-full text-destructive" onClick={() => openDecision([viewApp.id], "Revoked")}><Ban className="mr-1 h-4 w-4" /> Revoke scholarship</Button>
              )}
              {canReview && (viewApp.status === "Rejected" || viewApp.status === "Revoked") && (
                <Button variant="outline" className="w-full" onClick={async () => {
                  if (await decideApplication(viewApp, "Pending", remarks)) { toast.success("Reopened"); setViewApp(null); loadData(); }
                }}><RotateCcw className="mr-1 h-4 w-4" /> Reopen for review</Button>
              )}
              {(() => {
                // Everything recorded about this application and its payments, newest first.
                const payIds = new Set(payments.filter((p) => p.application_id === viewApp.id).map((p) => p.id));
                const history = auditLogs.filter((l) => l.entity_id === viewApp.id || (l.entity_type === "payments" && l.entity_id && payIds.has(l.entity_id)));
                return (
                  <div>
                    <Label className="text-xs flex items-center gap-1"><History className="h-3.5 w-3.5" /> History</Label>
                    {history.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet{auditExhausted ? "" : " in the loaded audit entries"}</p> : (
                      <ol className="mt-1 space-y-1 border-l pl-3">
                        {history.map((l) => (
                          <li key={l.id} className="text-xs">
                            <span className="font-medium">{l.action.replace(/_/g, " ")}</span>
                            <span className="text-muted-foreground"> · {l.user_email || "System"} · {new Date(l.created_at).toLocaleString()}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!viewStudent} onOpenChange={(open) => !open && setViewStudent(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Student Details</DialogTitle></DialogHeader>
          {viewStudent && (() => {
            const stuApps = applications.filter((a) => a.user_id === viewStudent.id);
            const ver = verificationForUser(viewStudent.id);
            const field = (label: string, value: React.ReactNode) => (
              <div><Label className="text-muted-foreground text-xs">{label}</Label><div className="font-medium">{value || "—"}</div></div>
            );
            return (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {field("Name", `${viewStudent.first_name || ""} ${viewStudent.middle_name || ""} ${viewStudent.last_name || ""}`.replace(/\s+/g, " ").trim())}
                  {field("Email", viewStudent.email)}
                  {field("Phone", viewStudent.phone)}
                  {field("Sex · Civil status", [viewStudent.sex, viewStudent.civil_status].filter(Boolean).join(" · "))}
                  {field("Date of birth", viewStudent.dob)}
                  {field("Nationality", viewStudent.nationality)}
                  {field("Address", [viewStudent.street_address, viewStudent.barangay, viewStudent.municipality, viewStudent.province, viewStudent.zip_code].filter(Boolean).join(", "))}
                  {field("Guardian", [viewStudent.guardian_name, viewStudent.guardian_relationship && `(${viewStudent.guardian_relationship})`].filter(Boolean).join(" "))}
                  {field("Guardian phone", viewStudent.guardian_phone)}
                  {field("Student ID", viewStudent.student_id_number)}
                  {field("School", viewStudent.school_name)}
                  {field("Course", viewStudent.course)}
                  {field("Year Level", viewStudent.year_level)}
                  {field("Average Grade", viewStudent.average_grade != null ? (
                    <span className="inline-flex items-center gap-2">{viewStudent.average_grade}
                      <Badge variant={viewStudent.grade_verified_at ? "default" : "secondary"}>{viewStudent.grade_verified_at ? `Verified${viewStudent.grade_term ? ` · ${viewStudent.grade_term}` : ""}` : "Self-declared"}</Badge>
                    </span>) : null)}
                  {field("Account", <Badge variant={viewStudent.is_active ? "default" : "secondary"}>{viewStudent.is_active ? "Active" : "Inactive"}</Badge>)}
                  {field("Verification", ver ? <Badge variant={ver.verification_status === "Verified" ? "default" : ver.verification_status === "Flagged" ? "destructive" : "secondary"}>{ver.verification_status}</Badge> : null)}
                </div>
                <div>
                  <Label className="text-xs">Applications ({stuApps.length})</Label>
                  {stuApps.length === 0 ? <p className="text-sm text-muted-foreground">No applications</p> : (
                    <ul className="mt-1 space-y-1">
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
                  const grades = gradeReviews.filter((g) => g.user_id === viewStudent.id);
                  if (grades.length === 0) return null;
                  return (
                    <div>
                      <Label className="text-xs">Grade submissions</Label>
                      <ul className="mt-1 space-y-1.5">
                        {grades.map((g) => (
                          <li key={g.id} className="rounded-md border px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span><span className="font-medium">{g.grade}</span> · {g.term} · {new Date(g.created_at).toLocaleDateString()}</span>
                              <span className="flex items-center gap-1.5">
                                <Badge variant={g.status === "Verified" ? "default" : "secondary"} className={g.status === "Rejected" ? "text-destructive" : undefined}>{g.status}</Badge>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openStoredFile(g.file_path, "No grade report on file")}>View report</Button>
                                {canReview && g.status === "Pending" && (<>
                                  <Button size="sm" className="h-7 text-xs" disabled={payBusy} onClick={() => reviewGrade(g, "Verified")}>Verify</Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={payBusy} onClick={() => { setGradeNote(""); setRejectGrade(g); }}>Reject</Button>
                                </>)}
                              </span>
                            </div>
                            {g.status === "Rejected" && g.review_note && <p className="mt-1 text-xs text-destructive">Reason: {g.review_note}</p>}
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
                      <Label className="text-xs">Privacy requests</Label>
                      <ul className="mt-1 space-y-1.5">
                        {reqs.map((r) => (
                          <li key={r.id} className={`rounded-md border px-3 py-2 text-sm ${r.status === "Pending" ? "border-warning/40 bg-warning/5" : ""}`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-medium">Account deletion · {r.status} <span className="font-normal text-muted-foreground">· {new Date(r.created_at).toLocaleDateString()}</span></span>
                              {canManage && r.status === "Pending" && (
                                <span className="flex gap-1.5">
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setReqResponse(""); setHandleReq({ req: r, status: "Declined" }); }}>Decline</Button>
                                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { setReqResponse("Your account and data have been deleted."); setHandleReq({ req: r, status: "Completed" }); }}>Delete account…</Button>
                                </span>
                              )}
                            </div>
                            {r.reason && <p className="mt-1 text-xs text-muted-foreground">Student&apos;s reason: {r.reason}</p>}
                            {r.response && <p className="mt-1 text-xs"><span className="font-medium">Response: </span>{r.response}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                <div>
                  <Label className="text-xs">Documents</Label>
                  {docList(studentDocs, studentDocsLoading)}
                </div>
                {canManage && (
                  <DialogFooter>
                    <Button variant={viewStudent.is_active ? "destructive" : "default"} onClick={() => toggleStudentActive(viewStudent)}>
                      <Power className="mr-1 h-4 w-4" /> {viewStudent.is_active ? "Deactivate account" : "Activate account"}
                    </Button>
                  </DialogFooter>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      <Dialog open={!!rejectGrade} onOpenChange={(o) => { if (!o) setRejectGrade(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject the grade submission</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Reason (shown to the student, who will be asked to resubmit)</Label>
            <Textarea value={gradeNote} onChange={(e) => setGradeNote(e.target.value)} placeholder="e.g. The grade report is unreadable or doesn't show the average." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectGrade(null)}>Cancel</Button>
            <Button variant="destructive" disabled={payBusy || !gradeNote.trim()} onClick={async () => {
              if (rejectGrade && await reviewGrade(rejectGrade, "Rejected", gradeNote)) setRejectGrade(null);
            }}>Reject grade</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!handleReq} onOpenChange={(o) => { if (!o) setHandleReq(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{handleReq?.status === "Completed" ? "Delete this student's account?" : "Decline deletion request"}</DialogTitle></DialogHeader>
          {handleReq?.status === "Completed" ? (<>
            <p className="text-sm text-muted-foreground">
              This permanently deletes the account, profile, applications, documents, uploaded files and notifications. It can&apos;t be undone.
              A student with disbursed payments can&apos;t be deleted, because those records must be kept; decline the request instead.
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setHandleReq(null)}>Cancel</Button>
              <Button variant="ghost" disabled={payBusy || deletingAccount} title="The account was already deleted another way" onClick={respondToRequest}>Mark completed only</Button>
              <Button variant="destructive" disabled={deletingAccount} onClick={() => handleReq && deleteAccount(handleReq.req)}>
                {deletingAccount && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Delete account
              </Button>
            </DialogFooter>
          </>) : (<>
            <div>
              <Label className="text-xs">Message to the student</Label>
              <Textarea value={reqResponse} onChange={(e) => setReqResponse(e.target.value)} placeholder="Explain why, e.g. payment records must be kept for audit." />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHandleReq(null)}>Cancel</Button>
              <Button variant="outline" disabled={payBusy || !reqResponse.trim()} onClick={respondToRequest}>Decline request</Button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectReceipt} onOpenChange={(o) => { if (!o) setRejectReceipt(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject the student&apos;s receipt</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Reason (shown to the student, who will be asked to resubmit)</Label>
            <Textarea value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)} placeholder="e.g. The signature is missing — please upload the signed voucher." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectReceipt(null)}>Cancel</Button>
            <Button variant="destructive" disabled={payBusy || !receiptNote.trim()} onClick={async () => {
              if (rejectReceipt && await reviewReceipt(rejectReceipt, "Rejected", receiptNote)) setRejectReceipt(null);
            }}>Reject receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issueDialog} onOpenChange={(o) => { if (!o) setIssueDialog(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payment problem reports</DialogTitle></DialogHeader>
          {issueDialog && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{payStudent(issueDialog)} · {formatPHP(issueDialog.amount)} · {issueDialog.status}</p>
              {payIssues.filter((i) => i.payment_id === issueDialog.id).map((i) => (
                <div key={i.id} className={`rounded-md border p-3 text-sm ${i.status === "Open" ? "border-warning/40 bg-warning/5" : ""}`}>
                  <p className="font-medium">{{ not_received: "Not received", wrong_amount: "Wrong amount", other: "Other" }[i.kind] ?? i.kind} · {i.status}</p>
                  <p className="mt-1 whitespace-pre-wrap">{i.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Reported {new Date(i.created_at).toLocaleString()}</p>
                  {i.response && <p className="mt-2 whitespace-pre-wrap border-t pt-2"><span className="font-medium">Response: </span>{i.response}</p>}
                  {i.status === "Open" && (
                    <div className="mt-3 space-y-2">
                      <Label className="text-xs">Response to the student</Label>
                      <Textarea value={issueResponse} onChange={(e) => setIssueResponse(e.target.value)} placeholder="Explain what you found or what happens next." />
                      <Button size="sm" disabled={payBusy || !issueResponse.trim()} onClick={() => resolveIssue(i)}>Send response &amp; resolve</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!decisionDialog} onOpenChange={(o) => { if (!o) setDecisionDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionDialog?.status === "Revoked" ? "Revoke scholarship" : "Reject"}
              {decisionDialog && decisionDialog.ids.length > 1 ? ` ${decisionDialog.ids.length} applications` : decisionDialog?.status === "Revoked" ? "" : " application"}
            </DialogTitle>
          </DialogHeader>
          {decisionDialog?.status === "Revoked" && (
            <p className="text-sm text-muted-foreground">The scholar loses the award and its slot opens up. Any scheduled payments are cancelled. Payments already disbursed stay on record.</p>
          )}
          <div>
            <Label className="text-xs">Reason (shown to the student)</Label>
            <Textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} maxLength={1000}
              placeholder={decisionDialog?.status === "Revoked" ? "e.g. Your grades fell below the renewal requirement." : "e.g. Your household income is above the program's limit."} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionDialog(null)}>Cancel</Button>
            <Button variant="destructive" disabled={bulkBusy || !decisionNote.trim()} onClick={confirmDecision}>
              {bulkBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{decisionDialog?.status === "Revoked" ? "Revoke" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!remindDialog} onOpenChange={(o) => { if (!o) setRemindDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send a reminder to {remindDialog?.length ?? 0} student{remindDialog?.length === 1 ? "" : "s"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">They get it in their dashboard, and by email if they allow application emails. A student gets at most one reminder a day.</p>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea rows={4} maxLength={500} value={remindMsg} onChange={(e) => setRemindMsg(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemindDialog(null)}>Cancel</Button>
            <Button disabled={bulkBusy || !remindMsg.trim()} onClick={sendReminders}>{bulkBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}<Send className="mr-1 h-4 w-4" /> Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closeCycle} onOpenChange={(o) => { if (!o) setCloseCycle(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close {closeCycle?.name}?</DialogTitle></DialogHeader>
          {closeCycle && (() => {
            const open = applications.filter((a) => a.scholarship_id === closeCycle.id && (a.status === "Pending" || a.status === "Waitlisted")).length;
            return (
              <p className="text-sm text-muted-foreground">
                The program is disabled and stops taking applications.{" "}
                {open ? `Its ${open} pending or waitlisted application${open === 1 ? " is" : "s are"} rejected, and each student is notified with the message below.` : "It has no pending or waitlisted applications."}
                {" "}Approved scholars are not affected.
              </p>
            );
          })()}
          <div>
            <Label className="text-xs">Message to rejected applicants (optional)</Label>
            <Textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="The selection for this program has closed and all slots were filled." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseCycle(null)}>Cancel</Button>
            <Button variant="destructive" disabled={bulkBusy} onClick={confirmCloseCycle}>{bulkBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Close cycle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reversePay} onOpenChange={(o) => { if (!o) setReversePay(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverse this disbursement?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {reversePay && `${formatPHP(reversePay.amount)} to ${payStudent(reversePay)} is marked as not paid. The record, its receipt and this reason are kept, and the student is notified. Use this only for a disbursement entered by mistake; schedule a new payment if money is still owed.`}
          </p>
          <div>
            <Label className="text-xs">Reason</Label>
            <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="e.g. Recorded against the wrong student." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversePay(null)}>Cancel</Button>
            <Button variant="destructive" disabled={payBusy || !reverseReason.trim()} onClick={confirmReverse}>Reverse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkSchedule} onOpenChange={setBulkSchedule}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule {fundData.awaiting.length} payment{fundData.awaiting.length === 1 ? "" : "s"}</DialogTitle></DialogHeader>
          {(() => {
            const total = fundData.awaiting.reduce((t, a) => t + (remainingFor(a.id) ?? 0), 0);
            const noAmount = fundData.awaiting.filter((a) => !remainingFor(a.id)).length;
            return (
              <p className="text-sm text-muted-foreground">
                Each approved scholar awaiting payment gets one payment for the rest of their award ({formatPHP(total)} in total), using the default method ({parseSettings(systemSettings).default_payment_method}).
                {noAmount > 0 && ` ${noAmount} award${noAmount === 1 ? " has" : "s have"} no amount set and will be skipped.`}
              </p>
            );
          })()}
          <div>
            <Label className="text-xs">Scheduled date</Label>
            <Input type="date" value={bulkScheduleDate} onChange={(e) => setBulkScheduleDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSchedule(false)}>Cancel</Button>
            <Button disabled={bulkBusy} onClick={() => scheduleAllAwaiting(bulkScheduleDate)}>{bulkBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Schedule all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectDoc} onOpenChange={(o) => { if (!o) setRejectDoc(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {rejectDoc?.type}</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Reason (shown to the student)</Label>
            <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. The photo is blurry — please upload a clear copy." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDoc(null)}>Cancel</Button>
            <Button variant="destructive" disabled={reviewingDoc || !rejectNote.trim()} onClick={async () => {
              if (rejectDoc && await reviewDocument(rejectDoc, "Rejected", rejectNote)) setRejectDoc(null);
            }}>Reject document</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
