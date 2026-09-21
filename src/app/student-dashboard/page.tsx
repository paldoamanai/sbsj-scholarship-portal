"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  LayoutDashboard, FileText, Upload, GraduationCap, Banknote, Receipt,
  Bell, User, Settings as SettingsIcon, LogOut, Menu, Lock, Download,
  AlertTriangle, CheckCircle, Clock, XCircle, Pencil, Eye, Trash2, Loader2,
  Camera, ChevronRight, X, MoreVertical, ArrowRight, CalendarDays, Users,
} from "lucide-react";
import ApplicationProgressBar from "@/components/student/ApplicationProgressBar";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { profileFromUserMetadata } from "@/lib/registration-profile";

// ── Types ──────────────────────────────────────────────────────────────────────
type Payment = Tables<"payments">;

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "—") return <span className="text-sm text-muted-foreground">—</span>;
  const map: Record<string, { icon: typeof CheckCircle; cls: string }> = {
    Approved:   { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Pending:    { icon: Clock,        cls: "bg-amber-50 text-amber-700 border-amber-200" },
    Rejected:   { icon: XCircle,      cls: "bg-red-50 text-red-700 border-red-200" },
    Disbursed:  { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Processing: { icon: Clock,        cls: "bg-accent text-primary border-primary/20" },
    Waitlisted: { icon: Clock,        cls: "bg-muted text-muted-foreground border-border" },
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

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, subTone = "neutral", accent = false }: {
  icon: typeof LayoutDashboard;
  label: string;
  value: string | number;
  sub?: string;
  subTone?: "neutral" | "positive" | "warning";
  accent?: boolean;
}) {
  const subClass = accent
    ? "text-primary-foreground/80"
    : subTone === "positive" ? "text-success"
    : subTone === "warning" ? "text-warning"
    : "text-muted-foreground";
  return (
    <div className={`rounded-2xl p-5 border ${accent ? "bg-primary border-primary text-primary-foreground shadow-primary" : "bg-card border-border shadow-sm"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center ${accent ? "bg-white/20" : "bg-accent"}`}>
            <Icon className={`h-4.5 w-4.5 ${accent ? "text-primary-foreground" : "text-accent-foreground"}`} />
          </div>
          <p className={`text-xs font-medium ${accent ? "text-primary-foreground/90" : "text-muted-foreground"}`}>{label}</p>
        </div>
        <button className={`shrink-0 rounded-lg p-1 -mr-1 -mt-1 cursor-pointer ${accent ? "hover:bg-white/10 text-primary-foreground/70" : "hover:bg-muted text-muted-foreground"}`} aria-label={`${label} options`}>
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className={`text-2xl font-bold font-display ${accent ? "text-primary-foreground" : "text-foreground"}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 font-medium ${subClass}`}>{sub}</p>}
    </div>
  );
}

// ── Section heading ────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-5 w-1 rounded-full bg-primary" />
      <h2 className="font-display font-semibold text-foreground text-base">{children}</h2>
    </div>
  );
}

// ── Card wrapper ───────────────────────────────────────────────────────────────
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl border border-border shadow-sm ${className}`}>
      {children}
    </div>
  );
}

// ── Disbursement section ───────────────────────────────────────────────────────
// Shared receipt-upload logic for the Disbursement and Payments sections.
const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

function useReceiptUpload(onUploaded: () => void) {
  const supabase = createClient();
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [receiptFiles, setReceiptFiles] = useState<Record<string, File | null>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const pickFile = (paymentId: string, file: File | null) => {
    if (file && !RECEIPT_TYPES.includes(file.type)) { toast.error("Upload a PDF, JPG or PNG file."); return; }
    if (file && file.size > RECEIPT_MAX_BYTES) { toast.error("File is too large (max 5 MB)."); return; }
    setReceiptFiles((prev) => ({ ...prev, [paymentId]: file }));
  };

  // With a file: upload it and attach it. Without one (Cash only): record the confirmation.
  const upload = async (paymentId: string) => {
    const file = receiptFiles[paymentId];
    if (!file && !confirmed[paymentId]) return;
    setUploadingFor(paymentId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Please log in again."); return; }
      let path: string | null = null;
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        path = `${user.id}/receipts/${paymentId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file);
        if (uploadError) { toast.error("Upload failed", { description: uploadError.message }); return; }
      }
      const { error } = await supabase.rpc("submit_student_receipt", { _payment_id: paymentId, _path: path });
      if (error) {
        if (path) await supabase.storage.from("documents").remove([path]);
        toast.error("Could not submit", { description: error.message });
        return;
      }
      toast.success(file ? "Receipt submitted." : "Cash receipt confirmed.");
      setReceiptFiles((prev) => ({ ...prev, [paymentId]: null }));
      setConfirmed((prev) => ({ ...prev, [paymentId]: false }));
      onUploaded();
    } catch {
      toast.error("Failed to submit.");
    } finally {
      setUploadingFor(null);
    }
  };

  const view = async (path: string | null) => {
    if (!path) return;
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { win?.close(); toast.error("Could not open receipt"); return; }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };

  return { receiptFiles, uploadingFor, confirmed, setConfirmed, pickFile, upload, view };
}

// Lets the student say whether they'd like Cash or Cheque for a payment that isn't disbursed yet.
function MethodPreference({ payment, onChanged, compact = false }: { payment: Payment; onChanged: () => void; compact?: boolean }) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  if (payment.status !== "Pending" && payment.status !== "Processing") return null;

  const choose = async (method: "Cash" | "Cheque") => {
    if (payment.preferred_method === method) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_payment_preference", { _payment_id: payment.id, _method: method });
    setSaving(false);
    if (error) { toast.error("Could not save preference", { description: error.message }); return; }
    toast.success(`You prefer ${method}. The office will honor it when possible.`);
    onChanged();
  };

  return (
    <div className={compact ? "space-y-1" : "flex items-center gap-2 pt-2 border-t border-muted flex-wrap"}>
      <span className="text-xs text-muted-foreground">{payment.preferred_method ? "I prefer:" : "How would you like to be paid?"}</span>
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {(["Cash", "Cheque"] as const).map((m) => (
          <button key={m} type="button" disabled={saving} onClick={() => choose(m)}
            className={`px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
              payment.preferred_method === m ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"
            }`}>{m}</button>
        ))}
      </div>
    </div>
  );
}

type ReceiptCtl = ReturnType<typeof useReceiptUpload>;

// Everything a student sees to acknowledge a disbursed payment. Cash: file OR a confirmation; Cheque: file.
function ReceiptSubmit({ payment: p, ctl }: { payment: Payment; ctl: ReceiptCtl }) {
  const { receiptFiles, uploadingFor, confirmed, setConfirmed, pickFile, upload, view } = ctl;
  const isCash = p.method === "Cash";

  if (p.student_receipt_at) {
    return p.student_receipt_path ? (
      <button type="button" onClick={() => view(p.student_receipt_path)} className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium hover:underline cursor-pointer">
        <CheckCircle className="h-3.5 w-3.5" /> Submitted · View
      </button>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <CheckCircle className="h-3.5 w-3.5" /> Cash receipt confirmed
      </span>
    );
  }

  const file = receiptFiles[p.id];
  const checked = !!confirmed[p.id];
  const canSubmit = !!file || (isCash && checked);
  return (
    <div className="space-y-2 min-w-[230px]">
      <p className="text-xs text-muted-foreground">
        {isCash
          ? "Upload a photo of the voucher you signed when you received the cash, or confirm below."
          : "Upload a photo of the signed cheque voucher or acknowledgment."}
      </p>
      <div className="flex items-center gap-1.5">
        <label className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-lg px-2 py-1 hover:bg-muted transition-colors min-w-0">
          <Upload className="h-3 w-3 shrink-0" />
          <span className="truncate">{file ? file.name : "Choose file"}</span>
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => pickFile(p.id, e.target.files?.[0] ?? null)} />
        </label>
        <Button size="sm" className="h-7 px-2 text-xs bg-primary hover:bg-primary text-white rounded-lg shrink-0"
          disabled={!canSubmit || uploadingFor === p.id} onClick={() => upload(p.id)}>
          {uploadingFor === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : file ? "Submit receipt" : "Confirm received"}
        </Button>
      </div>
      {isCash && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={checked}
            onChange={(e) => setConfirmed((prev) => ({ ...prev, [p.id]: e.target.checked }))} />
          <span>I confirm I received ₱{p.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} in cash.</span>
        </label>
      )}
    </div>
  );
}

function DisbursementSection({ payments, disbursementStatus, onUploaded }: {
  payments: Payment[];
  disbursementStatus: string | null | undefined;
  onUploaded: () => void;
}) {
  const ctl = useReceiptUpload(onUploaded);

  const totalDisbursed = payments.filter(p => p.status === "Disbursed").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard icon={Banknote} label="Total Disbursed" value={`₱${totalDisbursed.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`} />
        <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Disbursement Status</p>
          <StatusBadge status={disbursementStatus || "—"} />
        </div>
      </div>

      <Panel>
        <div className="px-6 py-4 border-b border-muted">
          <SectionTitle>Disbursement Records</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="text-xs text-muted-foreground font-semibold">Reference</TableHead>
                <TableHead className="text-xs text-muted-foreground font-semibold">Amount</TableHead>
                <TableHead className="text-xs text-muted-foreground font-semibold">Method</TableHead>
                <TableHead className="text-xs text-muted-foreground font-semibold">Date</TableHead>
                <TableHead className="text-xs text-muted-foreground font-semibold">Status</TableHead>
                <TableHead className="text-xs text-muted-foreground font-semibold">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No payments yet.</TableCell>
                </TableRow>
              )}
              {payments.map((p) => {
                const isDisbursedPay = p.status === "Disbursed";
                return (
                  <TableRow key={p.id} className="hover:bg-accent/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.reference || "—"}</TableCell>
                    <TableCell className="font-semibold text-sidebar-accent">₱{p.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      {p.method ? (
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                          p.method === "Cheque" ? "bg-blue-50 text-blue-700"
                          : p.method === "Cash" ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                        }`}>{p.method}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.scheduled_date || "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                      <div className="mt-2"><MethodPreference payment={p} onChanged={onUploaded} compact /></div>
                    </TableCell>
                    <TableCell>
                      {isDisbursedPay ? <ReceiptSubmit payment={p} ctl={ctl} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </div>
  );
}

// ── Payments section ───────────────────────────────────────────────────────────
function PaymentsSection({ payments, onUploaded }: { payments: Payment[]; onUploaded: () => void }) {
  const ctl = useReceiptUpload(onUploaded);

  return (
    <div className="space-y-4">
      {payments.some((p) => p.status === "Disbursed") && (
        <div className="flex items-start gap-3 bg-accent border border-primary/20 rounded-xl px-4 py-3">
          <Upload className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-primary">
            For each disbursed payment, <strong>upload your signed receipt</strong>. For cash, you can also simply <strong>confirm you received it</strong>.
          </p>
        </div>
      )}
      <Panel>
        <div className="px-6 py-4 border-b border-muted flex items-center justify-between">
          <SectionTitle>Payment History</SectionTitle>
          <Button size="sm" variant="outline" className="text-xs border-border text-muted-foreground hover:bg-muted rounded-lg">
            <Download className="mr-1 h-3 w-3" /> Download
          </Button>
        </div>
        <div className="p-4 space-y-3">
          {payments.length === 0 && (
            <div className="text-center py-10">
              <Receipt className="h-8 w-8 text-muted-foreground/70 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            </div>
          )}
          {payments.map((p) => {
            const isDisbursedPay = p.status === "Disbursed";
            return (
              <div key={p.id} className={`rounded-xl border p-4 space-y-3 ${isDisbursedPay ? "border-emerald-100 bg-emerald-50/40" : "border-muted"}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-semibold text-sidebar-accent">
                      ₱{p.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">via {p.method || "—"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.reference ? `Ref: ${p.reference}` : "No reference"} · {p.scheduled_date || "—"}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <MethodPreference payment={p} onChanged={onUploaded} />
                {isDisbursedPay && (
                  <div className="pt-2 border-t border-muted"><ReceiptSubmit payment={p} ctl={ctl} /></div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

// ── Sidebar items ──────────────────────────────────────────────────────────────
const sidebarItems = [
  { icon: LayoutDashboard, label: "Dashboard",      key: "overview" },
  { icon: FileText,        label: "Application",    key: "application" },
  { icon: Upload,          label: "Documents",      key: "documents" },
  { icon: GraduationCap,  label: "Scholarship",    key: "scholarship" },
  { icon: Banknote,        label: "Disbursement",   key: "disbursement" },
  { icon: Receipt,         label: "Payment History",key: "payments" },
  { icon: Bell,            label: "Notifications",  key: "notifications" },
  { icon: User,            label: "Profile",        key: "profile" },
  { icon: SettingsIcon,    label: "Settings",       key: "settings" },
];

const requiredDocTypes = ["Valid ID", "Grades", "Certificate of Registration", "Barangay Indigency", "Birth Certificate"];

// ══════════════════════════════════════════════════════════════════════════════
export default function StudentDashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [active, setActive] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile]           = useState<Tables<"profiles"> | null>(null);
  const [applications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string } | null })[]>([]);
  const [documents, setDocuments]       = useState<Tables<"documents">[]>([]);
  const [payments, setPayments]         = useState<Tables<"payments">[]>([]);
  const [notifications, setNotifications] = useState<Tables<"notifications">[]>([]);
  const [scholarships, setScholarships] = useState<Tables<"scholarships">[]>([]);
  const [userEmail, setUserEmail]       = useState("");
  const [userId, setUserId]             = useState("");
  const [applyScholarshipId, setApplyScholarshipId] = useState("");
  const [applyDialogOpen, setApplyDialogOpen]       = useState(false);
  const [applyLoading, setApplyLoading]             = useState(false);

  // Profile edit state
  const [editFirst, setEditFirst]               = useState("");
  const [editLast, setEditLast]                 = useState("");
  const [editPhone, setEditPhone]               = useState("");
  const [editBarangay, setEditBarangay]         = useState("");
  const [editMunicipality, setEditMunicipality] = useState("");
  const [editSchool, setEditSchool]             = useState("");
  const [editCourse, setEditCourse]             = useState("");
  const [editYearLevel, setEditYearLevel]       = useState("");
  const [uploading, setUploading]               = useState(false);
  const [newPw, setNewPw]                       = useState("");
  const [confirmPw, setConfirmPw]               = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserEmail(user.email || "");
    setUserId(user.id);

    const [profileRes, appsRes, docsRes, paymentsRes, notifsRes, scholsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("applications").select("*, scholarships(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("documents").select("*").eq("user_id", user.id),
      supabase.from("payments").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("scholarships").select("*").eq("is_active", true),
    ]);

    let profileRow = profileRes.data;
    if (!profileRow?.first_name || !profileRow?.last_name) {
      const fromMeta = profileFromUserMetadata(user.user_metadata as Record<string, unknown>);
      if (fromMeta) {
        const { data: upserted } = await supabase
          .from("profiles")
          .upsert({ id: user.id, email: user.email, ...fromMeta })
          .select("*")
          .single();
        if (upserted) profileRow = upserted;
      }
    }

    if (profileRow) {
      setProfile(profileRow);
      setEditFirst(profileRow.first_name || "");
      setEditLast(profileRow.last_name || "");
      setEditPhone(profileRow.phone || "");
      setEditBarangay(profileRow.barangay || "");
      setEditMunicipality(profileRow.municipality || "");
      setEditSchool(profileRow.school_name || "");
      setEditCourse(profileRow.course || "");
      setEditYearLevel(profileRow.year_level || "");
    }
    if (appsRes.data) setApplications(appsRes.data);
    if (docsRes.data) setDocuments(docsRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (notifsRes.data) setNotifications(notifsRes.data);
    if (scholsRes.data) setScholarships(scholsRes.data);
    setLoading(false);
  };

  // Re-fetch application/payment rows in the background (no loading flicker) —
  // used when a live status/disbursement update comes in over realtime.
  const silentRefresh = async (uid: string) => {
    const [appsRes, paymentsRes] = await Promise.all([
      supabase.from("applications").select("*, scholarships(name)").eq("user_id", uid).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    ]);
    if (appsRes.data) setApplications(appsRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
  };

  const refreshPayments = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) silentRefresh(user.id);
  };

  // ── Live updates: notifications, application status, disbursement ──────────
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`student-live-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          setNotifications((prev) => [n, ...prev]);
          const notify = toast[n.type as "info" | "success" | "warning" | "error"] ?? toast.message;
          notify(n.title, { description: n.message });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          setNotifications((prev) => prev.map((x) => (x.id === n.id ? n : x)));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "applications", filter: `user_id=eq.${userId}` },
        () => silentRefresh(userId)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payments", filter: `user_id=eq.${userId}` },
        () => silentRefresh(userId)
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const currentYear  = new Date().getFullYear();
  const currentApp   = applications.find((app) => new Date(app.created_at).getFullYear() === currentYear);
  const isDisbursed  = currentApp?.disbursement_status === "Disbursed";
  const isApproved   = currentApp?.status === "Approved";
  const locked       = isApproved || isDisbursed;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const lockedToast = () => toast.error("Locked: you already have an approved or disbursed scholarship.");
  const guard = (fn: () => void) => () => (locked ? lockedToast() : fn());

  const displayName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
    : userEmail.split("@")[0];

  const unreadCount = notifications.filter(n => !n.read).length;
  const docsUploaded = requiredDocTypes.filter(t => documents.some(d => d.document_type === t)).length;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Section: Overview ──────────────────────────────────────────────────────
  const Overview = () => (
    <div className="space-y-6">
      {/* Gradient hero banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-hero p-6 sm:p-7">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
          backgroundImage: "repeating-linear-gradient(135deg, #fff 0, #fff 1px, transparent 1px, transparent 14px)",
        }} />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">Dashboard</h1>
            <p className="text-sm text-white/80 mt-1">
              Welcome back, {displayName.split(" ")[0] || "Student"}! Here&apos;s what&apos;s happening today.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActive("notifications")}
              className="relative h-10 w-10 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="h-4.5 w-4.5 text-white" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white text-primary text-[9px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActive(currentApp ? "application" : "application")}
              className="inline-flex items-center gap-2 rounded-xl bg-white text-primary text-sm font-semibold px-4 py-2.5 hover:bg-white/90 transition-colors cursor-pointer shadow-sm"
            >
              {currentApp ? <Eye className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {currentApp ? "View Application" : "Apply for Scholarship"}
            </button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          label="Application Status"
          value={currentApp?.status || "None"}
          sub={currentApp ? `Submitted ${new Date(currentApp.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : `No application for ${currentYear}`}
          subTone={currentApp?.status === "Approved" ? "positive" : "neutral"}
          accent={!!currentApp && currentApp.status === "Approved"}
        />
        <StatCard
          icon={Upload}
          label="Documents"
          value={`${docsUploaded} / ${requiredDocTypes.length}`}
          sub={docsUploaded === requiredDocTypes.length ? "All complete" : `${requiredDocTypes.length - docsUploaded} remaining`}
          subTone={docsUploaded === requiredDocTypes.length ? "positive" : "warning"}
        />
        <StatCard
          icon={Banknote}
          label="Disbursed"
          value={`₱${payments.filter(p => p.status === "Disbursed").reduce((s, p) => s + p.amount, 0).toLocaleString("en-PH", { minimumFractionDigits: 0 })}`}
          sub={currentApp?.disbursement_status || "Not yet disbursed"}
        />
        <StatCard
          icon={Bell}
          label="Notifications"
          value={unreadCount}
          sub={unreadCount === 0 ? "All caught up" : `${unreadCount} unread`}
          subTone={unreadCount === 0 ? "positive" : "warning"}
        />
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: profile + progress + available scholarships */}
        <div className="lg:col-span-2 space-y-5">
          <Panel className="p-5">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
              <div className="relative shrink-0">
                {profile?.profile_picture_url ? (
                  <img src={profile.profile_picture_url} alt="Profile" className="h-16 w-16 rounded-2xl object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded-2xl bg-accent flex items-center justify-center">
                    <User className="h-7 w-7 text-accent-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 text-center sm:text-left min-w-0">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-lg font-display font-bold text-foreground">{displayName || "Student"}</h2>
                  {locked && (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${isDisbursed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-accent text-accent-foreground border-primary/20"}`}>
                      <Lock className="h-3 w-3" />{isDisbursed ? "Disbursed" : "Approved — Locked"}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {profile?.course || "—"}{profile?.year_level ? ` · ${profile.year_level}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">{profile?.school_name || "—"}</p>
              </div>
              <button
                onClick={() => setActive("profile")}
                className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:text-primary/80 transition-colors shrink-0 cursor-pointer"
              >
                Edit Profile <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle>Application Progress</SectionTitle>
            <ApplicationProgressBar currentStep={isDisbursed ? 2 : currentApp?.status === "Approved" ? 1 : 0} />
          </Panel>

          <Panel>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <SectionTitle>Available Scholarships</SectionTitle>
              <button onClick={() => setActive("application")} className="text-xs text-primary font-semibold hover:text-primary/80 cursor-pointer">
                View All
              </button>
            </div>
            <div className="divide-y divide-border">
              {scholarships.length === 0 && (
                <div className="text-center py-10">
                  <GraduationCap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No active scholarships right now.</p>
                </div>
              )}
              {scholarships.slice(0, 3).map((s) => (
                <div key={s.id} className="p-5 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                      {s.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>}
                    </div>
                    <button
                      onClick={guard(() => { setApplyScholarshipId(s.id); setApplyDialogOpen(true); setActive("application"); })}
                      disabled={!!currentApp}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-primary/30 text-primary text-xs font-semibold px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      View <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                    {s.deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {new Date(s.deadline).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>}
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {s.slots} slots</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Right: recent notifications panel */}
        <div className="space-y-5">
          <Panel>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <SectionTitle>Recent Notifications</SectionTitle>
              {notifications.length > 4 && (
                <button onClick={() => setActive("notifications")} className="text-xs text-primary font-semibold hover:text-primary/80 cursor-pointer">
                  View all
                </button>
              )}
            </div>
            <div className="divide-y divide-border">
              {notifications.length === 0 && (
                <div className="text-center py-10 px-4">
                  <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No notifications yet.</p>
                </div>
              )}
              {notifications.slice(0, 4).map((n) => (
                <div key={n.id} className={`flex items-start gap-3 px-5 py-4 ${!n.read ? "bg-accent/50" : ""}`}>
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    n.type === "success" ? "bg-emerald-100" : n.type === "warning" ? "bg-amber-100" : "bg-accent"
                  }`}>
                    <Bell className={`h-4 w-4 ${
                      n.type === "success" ? "text-emerald-600" : n.type === "warning" ? "text-amber-600" : "text-accent-foreground"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{n.message}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">{new Date(n.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );

  // ── Section: Application ───────────────────────────────────────────────────
  const Application = () => (
    <div className="space-y-5">
      {locked && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Lock className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">Your scholarship has been {isDisbursed ? "disbursed" : "approved"}. The application is now read-only.</p>
        </div>
      )}
      {currentApp ? (
        <Panel>
          <div className="px-6 py-5 border-b border-muted flex items-center justify-between flex-wrap gap-3">
            <div>
              <SectionTitle>My Application</SectionTitle>
              <p className="text-sm text-muted-foreground -mt-3">{currentApp.scholarships?.name}</p>
            </div>
            <StatusBadge status={currentApp.status} />
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-4 text-sm mb-5">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Submitted</p>
                <p className="font-semibold text-sidebar-accent">{new Date(currentApp.created_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Year Level</p>
                <p className="font-semibold text-sidebar-accent">{profile?.year_level || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">School</p>
                <p className="font-semibold text-sidebar-accent">{profile?.school_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Course</p>
                <p className="font-semibold text-sidebar-accent">{profile?.course || "—"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs border-border rounded-xl hover:bg-muted"
                disabled={locked || currentApp.status !== "Pending"}
                onClick={guard(() => toast.success("Edit mode enabled"))}>
                <Pencil className="mr-1 h-3 w-3" /> Edit
              </Button>
              <Button size="sm" variant="outline" className="text-xs border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                disabled={locked || currentApp.status === "Approved"}
                onClick={guard(async () => {
                  await supabase.from("applications").delete().eq("id", currentApp.id);
                  toast.success("Application cancelled");
                  loadData();
                })}>
                <Trash2 className="mr-1 h-3 w-3" /> Cancel
              </Button>
              <Button size="sm" variant="outline" className="text-xs border-border rounded-xl hover:bg-muted">
                <Eye className="mr-1 h-3 w-3" /> View
              </Button>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel className="p-10 text-center">
          <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="h-7 w-7 text-primary" />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-primary mb-3">
            1 scholarship application allowed per year
          </div>
          <p className="text-muted-foreground text-sm mb-6">You haven&apos;t submitted an application for {currentYear} yet.</p>
          <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary text-white rounded-xl px-6">
                <FileText className="mr-2 h-4 w-4" /> Apply for Scholarship
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display">Apply for Scholarship</DialogTitle>
              </DialogHeader>
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <span>You may only submit <strong>one application per year</strong>. Choose your scholarship program carefully.</span>
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground mb-1.5 block">Scholarship Program *</Label>
                <Select value={applyScholarshipId} onValueChange={setApplyScholarshipId}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select program" /></SelectTrigger>
                  <SelectContent>
                    {scholarships.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button disabled={!applyScholarshipId || applyLoading}
                  className="bg-primary hover:bg-primary text-white rounded-xl w-full"
                  onClick={async () => {
                    if (!applyScholarshipId) return;
                    setApplyLoading(true);
                    try {
                      const res = await fetch("/api/applications", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ scholarship_id: applyScholarshipId }),
                      });
                      const json = await res.json();
                      if (!res.ok) {
                        toast.error(json.error ?? "Failed to submit application.");
                      } else {
                        toast.success("Application submitted!");
                        setApplyDialogOpen(false);
                        setApplyScholarshipId("");
                        loadData();
                      }
                    } catch {
                      toast.error("Network error. Please try again.");
                    } finally {
                      setApplyLoading(false);
                    }
                  }}>
                  {applyLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit Application
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Panel>
      )}
    </div>
  );

  // ── Section: Documents ─────────────────────────────────────────────────────
  const Documents = () => (
    <div className="space-y-4">
      {locked && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <Lock className="h-4 w-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">Documents are locked after disbursement.</p>
        </div>
      )}

      {/* Progress bar */}
      <Panel className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">Upload Progress</span>
          <span className="text-sm font-bold text-primary">{docsUploaded}/{requiredDocTypes.length}</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(docsUploaded / requiredDocTypes.length) * 100}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {docsUploaded === requiredDocTypes.length ? "All required documents uploaded." : `${requiredDocTypes.length - docsUploaded} document(s) remaining.`}
        </p>
      </Panel>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {requiredDocTypes.map((docType) => {
          const uploaded = documents.find((d) => d.document_type === docType);
          return (
            <Panel key={docType} className={`p-4 flex items-center justify-between ${uploaded ? "border-emerald-100" : ""}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${uploaded ? "bg-emerald-100" : "bg-muted"}`}>
                  <FileText className={`h-5 w-5 ${uploaded ? "text-emerald-600" : "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{docType}</p>
                  <p className="text-xs text-muted-foreground truncate">{uploaded ? uploaded.file_name : "Not uploaded"}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0 ml-2">
                {uploaded && (
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0 rounded-xl border-border hover:bg-muted">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                <Label className="cursor-pointer">
                  <Input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" disabled={locked}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) return;
                      const filePath = `${user.id}/${docType}/${Date.now()}-${file.name}`;
                      const { error } = await supabase.storage.from("documents").upload(filePath, file);
                      if (error) { toast.error(error.message); return; }
                      const { data: urlData } = supabase.storage.from("documents").getPublicUrl(filePath);
                      await supabase.from("documents").insert({ user_id: user.id, document_type: docType, file_url: urlData.publicUrl, file_name: file.name });
                      toast.success(`${docType} uploaded`);
                      loadData();
                    }} />
                  <span className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    locked ? "opacity-50 pointer-events-none border-border text-muted-foreground" :
                    uploaded ? "border-primary/20 text-primary hover:bg-accent" : "border-primary bg-primary text-white hover:bg-primary"
                  }`}>
                    <Upload className="h-3 w-3" />{uploaded ? "Replace" : "Upload"}
                  </span>
                </Label>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );

  // ── Section: Scholarship ───────────────────────────────────────────────────
  const Scholarship = () => (
    <Panel>
      <div className="px-6 py-5 border-b border-muted">
        <SectionTitle>{currentApp?.scholarships?.name || "No Active Scholarship"}</SectionTitle>
        <p className="text-sm text-muted-foreground -mt-3">Program details and conditions</p>
      </div>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl bg-muted border border-muted p-4">
            <p className="text-xs text-muted-foreground mb-1">Required Grade</p>
            <p className="text-xl font-bold text-sidebar-accent">85% and above</p>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground mb-3">Scholarship Conditions</p>
          <div className="space-y-2">
            {[
              "Maintain a minimum grade of 85.",
              "Submit a Certificate of Registration each semester.",
              "Attend mandatory orientation and progress meetings.",
              "No failing grades or dropped subjects.",
            ].map((c, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-accent flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle className="h-3 w-3 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">{c}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );

  // ── Section: Notifications ─────────────────────────────────────────────────
  const Notifications = () => (
    <Panel>
      <div className="px-6 py-4 border-b border-muted flex items-center justify-between">
        <SectionTitle>All Notifications</SectionTitle>
        {notifications.some(n => !n.read) && (
          <Button variant="ghost" size="sm" className="text-xs text-primary hover:text-primary hover:bg-accent rounded-lg"
            onClick={async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;
              await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
              loadData();
            }}>
            Mark all read
          </Button>
        )}
      </div>
      <div className="divide-y divide-muted">
        {notifications.length === 0 && (
          <div className="text-center py-12">
            <Bell className="h-8 w-8 text-border mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          </div>
        )}
        {notifications.map((n) => (
          <div key={n.id} className={`flex items-start gap-3 px-6 py-4 transition-colors ${!n.read ? "bg-accent/60" : "hover:bg-muted/50"}`}>
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              n.type === "success" ? "bg-emerald-100" : n.type === "warning" ? "bg-amber-100" : "bg-accent"
            }`}>
              <Bell className={`h-4 w-4 ${
                n.type === "success" ? "text-emerald-600" : n.type === "warning" ? "text-amber-600" : "text-primary"
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-sidebar-accent">{n.title}</p>
                {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{new Date(n.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>
          </div>
        ))}
      </div>
    </Panel>
  );

  // ── Section: Profile ───────────────────────────────────────────────────────
  const Profile = () => {
    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUploading(false); return; }
      const filePath = `${user.id}/avatar-${Date.now()}.${file.name.split(".").pop()}`;
      const { error } = await supabase.storage.from("profile-pictures").upload(filePath, file, { upsert: true });
      if (error) { toast.error(error.message); setUploading(false); return; }
      const { data: urlData } = supabase.storage.from("profile-pictures").getPublicUrl(filePath);
      await supabase.from("profiles").update({ profile_picture_url: urlData.publicUrl }).eq("id", user.id);
      toast.success("Profile photo updated");
      setUploading(false);
      loadData();
    };

    const handleSaveProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("profiles").update({
        first_name: editFirst, last_name: editLast, phone: editPhone,
        barangay: editBarangay, municipality: editMunicipality,
        school_name: editSchool, course: editCourse, year_level: editYearLevel,
      }).eq("id", user.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Profile saved");
      loadData();
    };

    const handleChangePassword = async () => {
      if (!newPw || newPw.length < 6) { toast.error("Password must be at least 6 characters"); return; }
      if (newPw !== confirmPw) { toast.error("Passwords do not match"); return; }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { toast.error(error.message); return; }
      toast.success("Password updated");
      setNewPw(""); setConfirmPw("");
    };

    return (
      <div className="space-y-5">
        {locked && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <Lock className="h-4 w-4 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">Profile editing is disabled after disbursement.</p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Avatar card */}
          <Panel className="p-6 text-center flex flex-col items-center">
            <div className="relative mb-4">
              {profile?.profile_picture_url ? (
                <img src={profile.profile_picture_url} alt="Profile" className="h-24 w-24 rounded-2xl object-cover" />
              ) : (
                <div className="h-24 w-24 rounded-2xl bg-accent flex items-center justify-center">
                  <User className="h-10 w-10 text-primary" />
                </div>
              )}
              <Label className={`absolute -bottom-2 -right-2 h-8 w-8 rounded-xl flex items-center justify-center cursor-pointer shadow-md transition-colors ${locked || uploading ? "opacity-50 pointer-events-none bg-muted-foreground/70" : "bg-primary hover:bg-primary"}`}>
                <Input type="file" className="hidden" accept="image/*" disabled={locked || uploading} onChange={handlePhotoUpload} />
                {uploading ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Camera className="h-4 w-4 text-white" />}
              </Label>
            </div>
            <h3 className="font-display font-bold text-sidebar-accent">{displayName}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{userEmail}</p>
            {profile?.course && (
              <span className="mt-3 inline-flex items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary">
                {profile.course}
              </span>
            )}
          </Panel>

          {/* Personal info */}
          <Panel className="lg:col-span-2">
            <div className="px-6 py-4 border-b border-muted">
              <SectionTitle>Personal Information</SectionTitle>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: "First Name", value: editFirst, set: setEditFirst },
                { label: "Last Name", value: editLast, set: setEditLast },
                { label: "Phone", value: editPhone, set: setEditPhone },
                { label: "Barangay", value: editBarangay, set: setEditBarangay },
                { label: "Municipality", value: editMunicipality, set: setEditMunicipality },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">{label}</Label>
                  <Input value={value} onChange={e => set(e.target.value)} disabled={locked}
                    className="rounded-xl border-border focus:border-primary focus:ring-primary/20" />
                </div>
              ))}
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">Email</Label>
                <Input defaultValue={userEmail} disabled className="rounded-xl border-border bg-muted" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">School</Label>
                <Select value={editSchool} onValueChange={setEditSchool} disabled={locked}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select school" /></SelectTrigger>
                  <SelectContent>
                    {["San Jose National High School","Ambulong National High School","Bangkuro National High School","Batong Buhay National High School","Bubog National High School","Caminawit National High School","Inarawan National High School","Ipil National High School","Labangan National High School","Mangarin National High School","Poypoy National High School","San Agustin National High School","Tayamaan National High School","Occidental Mindoro State University (OMSU)","Saint Joseph College of Occidental Mindoro (SJCOM)","AMA Computer College - San Jose","STI College - San Jose"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">Course</Label>
                <Select value={editCourse} onValueChange={setEditCourse} disabled={locked}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {[
                      ["STEM","Science, Technology, Engineering and Mathematics (STEM)"],
                      ["ABM","Accountancy, Business and Management (ABM)"],
                      ["HUMSS","Humanities and Social Sciences (HUMSS)"],
                      ["GAS","General Academic Strand (GAS)"],
                      ["TVL","Technical-Vocational-Livelihood (TVL)"],
                      ["BSEd","Bachelor of Secondary Education (BSEd)"],
                      ["BEEd","Bachelor of Elementary Education (BEEd)"],
                      ["BSBA","Bachelor of Science in Business Administration (BSBA)"],
                      ["BSA","Bachelor of Science in Accountancy (BSA)"],
                      ["BSIT","Bachelor of Science in Information Technology (BSIT)"],
                      ["BSCS","Bachelor of Science in Computer Science (BSCS)"],
                      ["BSN","Bachelor of Science in Nursing (BSN)"],
                      ["BSM","Bachelor of Science in Midwifery (BSM)"],
                      ["BSAg","Bachelor of Science in Agriculture (BSAg)"],
                      ["BSF","Bachelor of Science in Fisheries (BSF)"],
                      ["BSCrim","Bachelor of Science in Criminology (BSCrim)"],
                      ["BSTM","Bachelor of Science in Tourism Management (BSTM)"],
                      ["BSHM","Bachelor of Science in Hospitality Management (BSHM)"],
                      ["BSSW","Bachelor of Science in Social Work (BSSW)"],
                      ["AB Communication","Bachelor of Arts in Communication"],
                      ["BSCE","Bachelor of Science in Civil Engineering (BSCE)"],
                      ["BSEEct","Bachelor of Science in Electrical Engineering (BSEE)"],
                    ].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">Year Level</Label>
                <Input value={editYearLevel} onChange={e => setEditYearLevel(e.target.value)} disabled={locked}
                  className="rounded-xl border-border focus:border-primary focus:ring-primary/20" />
              </div>
              <div className="sm:col-span-2">
                <Button disabled={locked} className="bg-primary hover:bg-primary text-white rounded-xl px-6"
                  onClick={guard(handleSaveProfile)}>
                  Save Changes
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        {/* Change password */}
        <Panel>
          <div className="px-6 py-4 border-b border-muted">
            <SectionTitle>Change Password</SectionTitle>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
            <div>
              <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">New Password</Label>
              <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                className="rounded-xl border-border focus:border-primary focus:ring-primary/20" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">Confirm Password</Label>
              <Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                className="rounded-xl border-border focus:border-primary focus:ring-primary/20" />
            </div>
            <div>
              <Button className="bg-primary hover:bg-primary text-white rounded-xl" onClick={handleChangePassword}>
                Update Password
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    );
  };

  // ── Section: Settings ──────────────────────────────────────────────────────
  const SettingsView = () => (
    <Panel>
      <div className="px-6 py-4 border-b border-muted">
        <SectionTitle>Notification Preferences</SectionTitle>
      </div>
      <div className="p-6 divide-y divide-muted">
        {["Application updates", "Payment notifications", "General announcements"].map((p) => (
          <div key={p} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">{p}</p>
            <Switch defaultChecked className="data-[state=checked]:bg-primary" />
          </div>
        ))}
      </div>
    </Panel>
  );

  const renderActive = () => {
    switch (active) {
      case "overview":      return <Overview />;
      case "application":   return <Application />;
      case "documents":     return <Documents />;
      case "scholarship":   return <Scholarship />;
      case "disbursement":  return <DisbursementSection payments={payments} disbursementStatus={currentApp?.disbursement_status} onUploaded={refreshPayments} />;
      case "payments":      return <PaymentsSection payments={payments} onUploaded={refreshPayments} />;
      case "notifications": return <Notifications />;
      case "profile":       return <Profile />;
      case "settings":      return <SettingsView />;
      default:              return <Overview />;
    }
  };

  const activeItem = sidebarItems.find((i) => i.key === active);

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen flex w-full bg-background">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300`}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shrink-0 overflow-hidden">
            <Image src="/municipal-logo.png" alt="Logo" width={36} height={36} className="h-9 w-9 object-cover" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-display font-bold text-sidebar-foreground truncate">SB San Jose</p>
            <p className="text-xs text-muted-foreground">Scholarship Portal</p>
          </div>
          <button className="lg:hidden ml-auto text-muted-foreground hover:text-sidebar-foreground" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          <p className="text-xs font-semibold text-muted-foreground px-3 py-2 uppercase tracking-wider">Menu</p>
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            const isNotif = item.key === "notifications";
            return (
              <button key={item.key}
                onClick={() => { setActive(item.key); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative cursor-pointer ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-primary"
                    : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}>
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
                {isNotif && unreadCount > 0 && (
                  <span className={`ml-auto text-xs font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1 ${isActive ? "bg-white/25 text-primary-foreground" : "bg-primary text-primary-foreground"}`}>
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-sidebar-accent mb-2">
            <div className="h-8 w-8 rounded-xl overflow-hidden shrink-0">
              {profile?.profile_picture_url ? (
                <img src={profile.profile_picture_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-primary flex items-center justify-center">
                  <User className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">{displayName || "Student"}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Overlay (mobile) */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top header */}
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b border-border h-16 flex items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5 text-muted-foreground" />
            </button>
            <div>
              <h1 className="font-display font-bold text-foreground text-base leading-tight">{activeItem?.label ?? "Dashboard"}</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Welcome back, {displayName.split(" ")[0] || "Student"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActive("notifications")}
              className="relative p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => setActive("profile")} className="h-9 w-9 rounded-xl overflow-hidden border-2 border-accent hover:border-primary transition-colors cursor-pointer" aria-label="Profile">
              {profile?.profile_picture_url ? (
                <img src={profile.profile_picture_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-accent flex items-center justify-center">
                  <User className="h-4 w-4 text-accent-foreground" />
                </div>
              )}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-5 md:p-7 overflow-auto">
          {renderActive()}
        </main>
      </div>
    </div>
  );
}
