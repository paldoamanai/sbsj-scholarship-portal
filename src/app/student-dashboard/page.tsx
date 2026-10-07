"use client";

import { useHistorySync } from "@/hooks/use-history-sync";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  LayoutDashboard, FileText, Upload, GraduationCap, Banknote, Receipt,
  Bell, User, Settings as SettingsIcon, LogOut, Menu, Lock, Download,
  AlertTriangle, CheckCircle, Clock, Eye, Trash2, Loader2,
  X,
} from "lucide-react";
import Overview from "@/components/student/Overview";
import { createClient } from "@/lib/supabase/client";
import ProfileSection from "@/components/student/ProfileSection";
import ProfileImage from "@/components/ProfileImage";
import SecuritySettings from "@/components/account/SecuritySettings";
import AccountSettings from "@/components/student/AccountSettings";
import { Panel, SectionTitle, StatCard, StatusBadge } from "@/components/student/ui";
import { profileCompleteness } from "@/lib/profile";
import NotificationInbox, { NOTIFICATION_PAGE } from "@/components/notifications/NotificationInbox";
import { useUnreadTitle } from "@/hooks/use-unread-title";
import { showDesktopAlert } from "@/lib/desktop-alerts";
import NotificationPreferences from "@/components/notifications/NotificationPreferences";
import type { Tables } from "@/integrations/supabase/types";
import { profileFromUserMetadata } from "@/lib/registration-profile";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { applicationsBlockedReason } from "@/lib/settings";
import { DOC_MIME, documentPath, uploadUserDocument } from "@/lib/documents";
import { uploadPendingDocuments } from "@/lib/pending-documents";
import { availabilityInfo, programChecks, requirementLines, slotsLabel, deadlineLabel, type PublicScholarship } from "@/lib/scholarships";
import { formatDate, peso, pesoFixed } from "@/lib/format";
import ApplicationTimeline from "@/components/student/ApplicationTimeline";
import ApplicationHistory, { DisapprovalReason } from "@/components/student/ApplicationHistory";

// ── Types ──────────────────────────────────────────────────────────────────────
type Payment = Tables<"payments">;

const fmtSize = (n: number | null | undefined) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Disapproved: "bg-red-50 text-red-700 border-red-200",
    Pending:  "bg-amber-50 text-amber-700 border-amber-200",
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${map[status] ?? map.Pending}`}>{status === "Pending" ? "Pending review" : status}</span>;
}

// ── Section heading ────────────────────────────────────────────────────────────
// ── Disbursement section ───────────────────────────────────────────────────────
// Shared receipt-submission logic. The student types the reference number printed on the voucher /
// acknowledgment receipt they signed; the database checks it and refuses a second submission
// (unless staff disapproved the first).
const RECEIPT_REF = /^[A-Za-z0-9][A-Za-z0-9 /#._-]{2,39}$/;

function useReceiptSubmit(onSubmitted: () => void) {
  const supabase = createClient();
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const submit = async (paymentId: string) => {
    const ref = (refs[paymentId] ?? "").trim();
    if (!RECEIPT_REF.test(ref)) { toast.error("Enter the reference number exactly as printed on your receipt (3–40 letters or numbers)."); return; }
    if (!confirmed[paymentId]) return;
    setSubmittingFor(paymentId);
    try {
      const { error } = await supabase.rpc("submit_student_receipt", { _payment_id: paymentId, _reference: ref });
      if (error) { toast.error("Could not submit", { description: error.message }); return; }
      toast.success("Receipt reference submitted.");
      setRefs((prev) => ({ ...prev, [paymentId]: "" }));
      setConfirmed((prev) => ({ ...prev, [paymentId]: false }));
      onSubmitted();
    } catch {
      toast.error("Failed to submit.");
    } finally {
      setSubmittingFor(null);
    }
  };

  // Receipts sent as photos before the switch to reference numbers can still be opened.
  const view = async (path: string | null) => {
    if (!path) return;
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { win?.close(); toast.error("Could not open receipt"); return; }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };

  return { refs, setRefs, submittingFor, confirmed, setConfirmed, submit, view };
}

// Lets the student say whether they'd like Cash or Cheque for a payment that isn't disbursed yet.
function MethodPreference({ payment, onChanged, compact = false }: { payment: Payment; onChanged: () => void; compact?: boolean }) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const { settings } = useSystemSettings();
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
        {settings.payment_methods.map((m) => (
          <button key={m} type="button" disabled={saving} onClick={() => choose(m)}
            className={`px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
              payment.preferred_method === m ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"
            }`}>{m}</button>
        ))}
      </div>
    </div>
  );
}

type ReceiptCtl = ReturnType<typeof useReceiptSubmit>;

const ISSUE_KINDS: Record<string, string> = {
  not_received: "I didn't receive this payment",
  wrong_amount: "The amount is wrong",
  other: "Something else",
};

// Everything a student sees to acknowledge a disbursed payment: the reference number on the receipt they
// signed, plus a confirmation of the amount. Final unless the office disapproved it.
function ReceiptSubmit({ payment: p, ctl }: { payment: Payment; ctl: ReceiptCtl }) {
  const { refs, setRefs, submittingFor, confirmed, setConfirmed, submit, view } = ctl;
  const disapproved = p.receipt_review_status === "Disapproved";

  if (p.student_receipt_at && !disapproved) {
    const accepted = p.receipt_review_status === "Accepted";
    return (
      <div className="space-y-1">
        {p.student_receipt_ref ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <CheckCircle className="h-3.5 w-3.5" /> Receipt ref. <span className="font-mono">{p.student_receipt_ref}</span> · {formatDate(p.student_receipt_at)}
          </span>
        ) : p.student_receipt_path ? (
          <button type="button" onClick={() => view(p.student_receipt_path)} className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium hover:underline cursor-pointer">
            <CheckCircle className="h-3.5 w-3.5" /> Submitted {formatDate(p.student_receipt_at)} · View
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <CheckCircle className="h-3.5 w-3.5" /> Receipt confirmed {formatDate(p.student_receipt_at)}
          </span>
        )}
        <p className={`text-[11px] font-semibold ${accepted ? "text-emerald-700" : "text-amber-700"}`}>{accepted ? "Accepted by the office" : "Waiting for the office to review"}</p>
      </div>
    );
  }

  const ref = refs[p.id] ?? "";
  const checked = !!confirmed[p.id];
  const canSubmit = RECEIPT_REF.test(ref.trim()) && checked;
  return (
    <div className="space-y-2 min-w-[230px]">
      {disapproved && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <span className="font-semibold">Your receipt was not accepted.</span> {p.receipt_review_note}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {p.method === "Cash"
          ? "Enter the reference number printed on the cash voucher you signed when you received the money."
          : "Enter the reference number printed on the cheque voucher or acknowledgment receipt you signed."}
      </p>
      <div className="flex items-center gap-1.5">
        <Input value={ref} maxLength={40} placeholder="Receipt reference no." aria-label="Receipt reference number"
          onChange={(e) => setRefs((prev) => ({ ...prev, [p.id]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(p.id); }}
          className="h-7 text-xs rounded-lg font-mono uppercase placeholder:normal-case placeholder:font-sans" />
        <Button size="sm" className="h-7 px-2 text-xs bg-primary hover:bg-primary text-white rounded-lg shrink-0"
          disabled={!canSubmit || submittingFor === p.id} onClick={() => submit(p.id)}>
          {submittingFor === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Submit"}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={checked}
          onChange={(e) => setConfirmed((prev) => ({ ...prev, [p.id]: e.target.checked }))} />
        <span>I confirm I received {pesoFixed(p.amount)}{p.method === "Cash" ? " in cash" : p.method === "Cheque" ? " by cheque" : ""}.</span>
      </label>
    </div>
  );
}

// One place for everything about money: what you're owed, what's coming, how to claim it, receipts and problems.
function DisbursementSection({ payments, issues, disbursementStatus, approvedTotal, onChanged }: {
  payments: Payment[];
  issues: Tables<"payment_issues">[];
  disbursementStatus: string | null | undefined;
  approvedTotal: number;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const { settings } = useSystemSettings();
  const ctl = useReceiptSubmit(onChanged);
  const [issueFor, setIssueFor] = useState<Payment | null>(null);
  const [issueKind, setIssueKind] = useState("not_received");
  const [issueText, setIssueText] = useState("");
  const [sending, setSending] = useState(false);

  const live = payments.filter((p) => p.status !== "Cancelled");
  const disbursed = live.filter((p) => p.status === "Disbursed").reduce((t, p) => t + p.amount, 0);
  const scheduled = live.filter((p) => p.status === "Pending" || p.status === "Processing").reduce((t, p) => t + p.amount, 0);
  const remaining = Math.max(approvedTotal - disbursed - scheduled, 0);
  const next = live
    .filter((p) => p.status === "Pending" || p.status === "Processing")
    .sort((a, b) => (a.scheduled_date ?? "9999").localeCompare(b.scheduled_date ?? "9999"))[0];
  const issuesFor = (id: string) => issues.filter((i) => i.payment_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const sendIssue = async () => {
    if (!issueFor) return;
    setSending(true);
    const { error } = await supabase.rpc("report_payment_issue", { _payment_id: issueFor.id, _kind: issueKind, _message: issueText.trim() });
    setSending(false);
    if (error) { toast.error("Could not send your report", { description: error.message }); return; }
    toast.success("Report sent. The office will respond here.");
    setIssueFor(null); setIssueText(""); setIssueKind("not_received");
    onChanged();
  };

  const downloadCsv = () => {
    const rows = [
      ["Reference", "Amount", "Method", "Status", "Scheduled", "Disbursed", "Receipt ref.", "Receipt review"],
      ...payments.map((p) => [
        p.reference ?? "", p.amount.toFixed(2), p.method ?? "", p.status, p.scheduled_date ?? "",
        p.disbursed_at ? p.disbursed_at.slice(0, 10) : "",
        p.student_receipt_at ? (p.student_receipt_ref ?? (p.student_receipt_path ? "File" : "Confirmed")) : "",
        p.student_receipt_at ? p.receipt_review_status : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `payout-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const claimInfo = [settings.payment_pickup_location && `Where: ${settings.payment_pickup_location}`, settings.payment_pickup_instructions, settings.office_hours && `Office hours: ${settings.office_hours}`].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {approvedTotal > 0 && <StatCard icon={GraduationCap} label="Approved award" value={pesoFixed(approvedTotal)} />}
        <StatCard icon={Banknote} label="Disbursed" value={pesoFixed(disbursed)} accent />
        <StatCard icon={Clock} label="Scheduled" value={pesoFixed(scheduled)} sub={next ? `Next: ${formatDate(next.scheduled_date)}` : "Nothing scheduled"} />
        {approvedTotal > 0 && <StatCard icon={Receipt} label="Not yet scheduled" value={pesoFixed(remaining)} sub={remaining === 0 ? "Fully scheduled" : "The office will schedule this"} subTone={remaining === 0 ? "positive" : "neutral"} />}
        {approvedTotal === 0 && (
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <p className="text-xs font-medium text-muted-foreground mb-2">Disbursement status</p>
            <StatusBadge status={disbursementStatus || "—"} />
          </div>
        )}
      </div>

      {next && (
        <Panel className="border-primary/30">
          <div className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next payment</p>
                <p className="text-2xl font-bold text-sidebar-accent mt-1">{pesoFixed(next.amount)}</p>
                <p className="text-sm text-muted-foreground">{next.scheduled_date ? `Scheduled ${formatDate(next.scheduled_date)}` : "Date to be announced"} · via {next.method || "—"}</p>
              </div>
              <StatusBadge status={next.status} />
            </div>
            {claimInfo.length > 0 && (
              <div className="rounded-xl bg-accent border border-primary/20 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-primary">How to claim</p>
                {claimInfo.map((l, i) => <p key={i} className="text-sm text-foreground">{l as string}</p>)}
              </div>
            )}
            <MethodPreference payment={next} onChanged={onChanged} />
          </div>
        </Panel>
      )}

      {payments.some((p) => p.status === "Disbursed" && (!p.student_receipt_at || p.receipt_review_status === "Disapproved")) && (
        <div className="flex items-start gap-3 bg-accent border border-primary/20 rounded-xl px-4 py-3">
          <Receipt className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-primary">
            For each disbursed payment, <strong>enter the reference number</strong> printed on the receipt you signed and <strong>confirm you received it</strong>.
          </p>
        </div>
      )}

      <Panel>
        <div className="px-6 py-4 border-b border-muted flex items-center justify-between gap-2">
          <SectionTitle>Payout History</SectionTitle>
          <Button size="sm" variant="outline" className="text-xs border-border text-muted-foreground hover:bg-muted rounded-lg" disabled={payments.length === 0} onClick={downloadCsv}>
            <Download className="mr-1 h-3 w-3" /> Download CSV
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
            const cancelled = p.status === "Cancelled";
            const list = issuesFor(p.id);
            const openIssue = list.find((i) => i.status === "Open");
            return (
              <div key={p.id} className={`rounded-xl border p-4 space-y-3 ${isDisbursedPay ? "border-emerald-100 bg-emerald-50/40" : cancelled ? "border-muted opacity-75" : "border-muted"}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-semibold text-sidebar-accent">
                      {pesoFixed(p.amount)}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">via {p.method || "—"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.reference ? `${p.method === "Cheque" ? "Cheque no." : "Ref"}: ${p.reference}` : "No reference yet"}
                      {" · "}{isDisbursedPay ? `Disbursed ${formatDate(p.disbursed_at)}` : p.scheduled_date ? `Scheduled ${formatDate(p.scheduled_date)}` : "Date to be announced"}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>

                {cancelled && p.cancel_reason && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"><span className="font-semibold">Cancelled: </span>{p.cancel_reason}</p>
                )}

                {p !== next && <MethodPreference payment={p} onChanged={onChanged} />}

                {isDisbursedPay && (
                  <div className="pt-2 border-t border-muted"><ReceiptSubmit payment={p} ctl={ctl} /></div>
                )}

                {list.map((i) => (
                  <div key={i.id} className={`rounded-lg border px-3 py-2 text-xs ${i.status === "Open" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-muted bg-muted/40 text-muted-foreground"}`}>
                    <p className="font-semibold">{ISSUE_KINDS[i.kind] ?? i.kind} · {i.status === "Open" ? "Waiting for the office" : `Resolved ${formatDate(i.resolved_at)}`}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{i.message}</p>
                    {i.response && <p className="mt-1 whitespace-pre-wrap text-foreground"><span className="font-semibold">Office: </span>{i.response}</p>}
                  </div>
                ))}

                {!cancelled && !openIssue && (
                  <button type="button" onClick={() => { setIssueFor(p); setIssueKind(isDisbursedPay ? "not_received" : "wrong_amount"); }}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer">
                    Report a problem with this payment
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Dialog open={!!issueFor} onOpenChange={(o) => { if (!o) setIssueFor(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-display">Report a problem</DialogTitle></DialogHeader>
          {issueFor && <p className="text-sm text-muted-foreground">Payment of {pesoFixed(issueFor.amount)} · {issueFor.status}</p>}
          <div>
            <Label className="text-sm font-medium mb-1.5 block">What&apos;s wrong?</Label>
            <Select value={issueKind} onValueChange={setIssueKind}>
              <SelectTrigger className="rounded-xl border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ISSUE_KINDS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium mb-1.5 block">Tell us what happened</Label>
            <Textarea rows={4} value={issueText} maxLength={1000} className="rounded-xl" onChange={(e) => setIssueText(e.target.value)}
              placeholder="For example: I went to the office on the scheduled date but was told there was no payment for me." />
            <p className={`text-xs mt-1 ${issueText.trim().length < 10 ? "text-warning" : "text-muted-foreground"}`}>{issueText.trim().length} / 1000 (minimum 10)</p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setIssueFor(null)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary text-white rounded-xl" disabled={sending || issueText.trim().length < 10} onClick={sendIssue}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Links in older notifications point at tabs that were merged into others.
const SECTION_ALIASES: Record<string, string> = { payments: "disbursement", scholarship: "application" };

// ── Sidebar items ──────────────────────────────────────────────────────────────
const sidebarItems = [
  { icon: LayoutDashboard, label: "Dashboard",      key: "overview" },
  { icon: FileText,        label: "Application",    key: "application" },
  { icon: Upload,          label: "Documents",      key: "documents" },
  { icon: Banknote,        label: "Payouts",        key: "disbursement" },
  { icon: Bell,            label: "Notifications",  key: "notifications" },
  { icon: User,            label: "Profile",        key: "profile" },
  { icon: SettingsIcon,    label: "Settings",       key: "settings" },
];


// ══════════════════════════════════════════════════════════════════════════════
export default function StudentDashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [active, setActive] = useState("overview");
  useHistorySync("sbsjSection", active, setActive);
  // The realtime handler is created once, so it reads the current tab and link handler through refs.
  const activeRef = useRef("overview");
  const goToLinkRef = useRef<(link: string) => void>(() => {});
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // While the mobile menu is open: Escape closes it and the page behind doesn't scroll.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [sidebarOpen]);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile]           = useState<Tables<"profiles"> | null>(null);
  const [applications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string } | null })[]>([]);
  const [documents, setDocuments]       = useState<Tables<"documents">[]>([]);
  const [payments, setPayments]         = useState<Tables<"payments">[]>([]);
  const [issues, setIssues]             = useState<Tables<"payment_issues">[]>([]);
  const [gradeUpdates, setGradeUpdates] = useState<Tables<"grade_updates">[]>([]);
  const [dataRequests, setDataRequests] = useState<Tables<"data_requests">[]>([]);
  const [notifications, setNotifications] = useState<Tables<"notifications">[]>([]);
  const [scholarships, setScholarships] = useState<PublicScholarship[]>([]);
  const [userEmail, setUserEmail]       = useState("");
  const [userId, setUserId]             = useState("");
  const [applyScholarshipId, setApplyScholarshipId] = useState("");
  const [applyDialogOpen, setApplyDialogOpen]       = useState(false);
  const [applyLoading, setApplyLoading]             = useState(false);
  const [applyCertified, setApplyCertified]         = useState(false);
  // The application the View / Withdraw dialogs act on.
  const [selectedAppId, setSelectedAppId]           = useState<string | null>(null);
  const [viewOpen, setViewOpen]                     = useState(false);
  const [withdrawOpen, setWithdrawOpen]             = useState(false);
  const [withdrawing, setWithdrawing]               = useState(false);
  const [openApplyOnLoad, setOpenApplyOnLoad]         = useState(false);
  const [uploadingDoc, setUploadingDoc]             = useState<string | null>(null);
  const [removeDoc, setRemoveDoc]                   = useState<Tables<"documents"> | null>(null);
  const [removingDoc, setRemovingDoc]               = useState(false);
  const { settings, loaded: settingsLoaded } = useSystemSettings();
  const applyBlocked = applicationsBlockedReason(settings);


  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sec = params.get("section");
    if (sec) { const key = SECTION_ALIASES[sec] ?? sec; if (sidebarItems.some((i) => i.key === key)) setActive(key); }
    // Coming from registration with a program already chosen: open the apply form once data has loaded.
    const apply = params.get("apply");
    if (apply) { setApplyScholarshipId(apply); setActive("application"); setOpenApplyOnLoad(true); }
  }, []);

  useEffect(() => {
    // Wait for both loads: applyBlocked reads from settings, which default to "open" until they
    // arrive, so opening on a stale default could show the form even when applications are closed.
    if (openApplyOnLoad && !loading && settingsLoaded) {
      setOpenApplyOnLoad(false);
      if (canApplyMore && !appliedProgramIds.has(applyScholarshipId)) setApplyDialogOpen(true);
      else setApplyScholarshipId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openApplyOnLoad, loading, settingsLoaded]);

  // Documents picked at registration while email confirmation was pending are kept in this browser;
  // upload them once the student's data and the upload limit have loaded.
  const pendingDocsDone = useRef(false);
  useEffect(() => {
    if (pendingDocsDone.current || loading || !settingsLoaded || !userId || !userEmail) return;
    pendingDocsDone.current = true;
    uploadPendingDocuments(supabase, {
      userId, email: userEmail,
      existingTypes: new Set(documents.map((d) => d.document_type)),
      maxBytes: settings.max_upload_mb * 1024 * 1024,
    }).then(({ uploaded, failed }) => {
      if (uploaded.length > 0) {
        toast.success("Documents from your registration were uploaded", { description: uploaded.join(", ") });
        refreshDocuments(userId);
      }
      if (failed.length > 0) toast.warning("Some registration documents could not be uploaded", { description: `Upload ${failed.join(", ")} again below.` });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settingsLoaded, userId, userEmail]);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      await loadDataInner();
    } catch {
      setLoadError("We couldn't reach the server.");
      setLoading(false);
    }
  };

  const loadDataInner = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserEmail(user.email || "");
    setUserId(user.id);

    const [profileRes, appsRes, docsRes, paymentsRes, notifsRes, scholsRes, issuesRes, gradesRes, requestsRes, unreadRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("applications").select("*, scholarships(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("documents").select("*").eq("user_id", user.id),
      supabase.from("payments").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("notifications").select("*").eq("user_id", user.id).eq("muted", false).order("created_at", { ascending: false }).limit(NOTIFICATION_PAGE),
      supabase.rpc("scholarships_public"),
      supabase.from("payment_issues").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("grade_updates").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("data_requests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("muted", false).eq("read", false),
    ]);
    if (unreadRes.count != null) setUnreadTotal(unreadRes.count);

    // A missing profile row (PGRST116) is normal for a brand-new account; anything else is a real failure.
    const failed = [
      profileRes.error && profileRes.error.code !== "PGRST116" ? profileRes : null,
      appsRes, docsRes, paymentsRes, notifsRes, scholsRes, issuesRes, gradesRes, requestsRes,
    ].find((r) => r && r.error);
    setLoadError(failed?.error ? failed.error.message : null);

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

    if (profileRow) setProfile(profileRow);
    if (appsRes.data) setApplications(appsRes.data);
    if (docsRes.data) setDocuments(docsRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (issuesRes.data) setIssues(issuesRes.data);
    if (gradesRes.data) setGradeUpdates(gradesRes.data);
    if (requestsRes.data) setDataRequests(requestsRes.data);
    if (notifsRes.data) setNotifications(notifsRes.data);
    if (scholsRes.data) setScholarships(scholsRes.data);
    setLoading(false);
  };

  // Re-fetch application/payment rows in the background (no loading flicker) —
  // used when a live status/disbursement update comes in over realtime.
  const silentRefresh = async (uid: string) => {
    const [appsRes, paymentsRes, issuesRes] = await Promise.all([
      supabase.from("applications").select("*, scholarships(name)").eq("user_id", uid).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      supabase.from("payment_issues").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    ]);
    if (appsRes.data) setApplications(appsRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (issuesRes.data) setIssues(issuesRes.data);
  };

  // A grade verification changes the profile itself; a deletion response changes the requests list.
  const refreshUnread = async (uid: string) => {
    const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("muted", false).eq("read", false);
    if (count != null) setUnreadTotal(count);
  };

  const refreshProfile = async (uid: string) => {
    const [p, g, r] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).single(),
      supabase.from("grade_updates").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      supabase.from("data_requests").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    ]);
    if (p.data) setProfile(p.data);
    if (g.data) setGradeUpdates(g.data);
    if (r.data) setDataRequests(r.data);
  };

  const refreshDocuments = async (uid: string) => {
    const { data } = await supabase.from("documents").select("*").eq("user_id", uid);
    if (data) setDocuments(data);
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
          // A muted notification is only kept so its email can go out; still refresh what it's about.
          if (!n.muted) setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
          if (n.entity_type === "documents") refreshDocuments(userId);
          if (n.entity_type === "payments" || n.entity_type === "payment_issues") silentRefresh(userId);
          if (n.entity_type === "grade_updates" || n.entity_type === "data_requests") refreshProfile(userId);
          if (n.muted) return;
          if (!n.read) setUnreadTotal((c) => c + 1);
          const open = () => (n.link ? goToLinkRef.current(n.link) : setActive("notifications"));
          showDesktopAlert(n, open);
          // Already looking at the inbox: the new row appears there, so no popup on top of it.
          if (activeRef.current === "notifications") return;
          const notify = toast[n.type as "info" | "success" | "warning" | "error"] ?? toast.message;
          notify(n.title, { description: n.message, action: { label: "Open", onClick: open } });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          setNotifications((prev) => prev.map((x) => (x.id === n.id ? n : x)));
          refreshUnread(userId);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "applications", filter: `user_id=eq.${userId}` },
        () => silentRefresh(userId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `user_id=eq.${userId}` },
        () => silentRefresh(userId)
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // UTC year, matching the server and database checks (one application per program per year).
  const currentYear  = new Date().getUTCFullYear();
  // This year's applications. A withdrawn one no longer counts: that program can be applied to again.
  const yearApps     = applications.filter((app) => app.status !== "Withdrawn" && new Date(app.created_at).getUTCFullYear() === currentYear);
  const yearAppIds   = new Set(yearApps.map((a) => a.id));
  // Students may apply to, and be approved for, every open program; each program decides on its own.
  const approvedApps = yearApps.filter((a) => a.status === "Approved");
  const approvedApp  = approvedApps[0];
  const openApp      = yearApps.find((a) => a.status === "Pending" || a.status === "Waitlisted");
  // The application the dashboard focuses on: the approved one, else the latest still in review.
  const currentApp   = approvedApp ?? openApp ?? yearApps[0];
  const appliedProgramIds = new Set(yearApps.map((a) => a.scholarship_id).filter((id): id is string => !!id));
  const isDisbursed  = currentApp?.disbursement_status === "Disbursed";
  const isApproved   = !!approvedApp;
  const locked       = isApproved || isDisbursed;
  // Open programs this student hasn't applied to yet this year.
  const programsToApply = scholarships.filter((s) => availabilityInfo(s).canApply && !appliedProgramIds.has(s.id));
  const canApplyMore = !applyBlocked;
  const selectedApp  = applications.find((a) => a.id === selectedAppId);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };


  const displayName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
    : userEmail.split("@")[0];

  const unreadCount = unreadTotal;
  useUnreadTitle(unreadTotal);
  const requiredDocTypes = settings.required_documents;
  // Documents are shared by all of this year's applications: filed with any of them, or still
  // unattached (uploaded ahead of applying). Documents tied to older years don't count. Latest wins.
  const inDocSet = (d: Tables<"documents">) => !d.application_id || yearAppIds.has(d.application_id);
  const docByType = new Map<string, Tables<"documents">>();
  [...documents]
    .filter(inDocSet)
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    .forEach((d) => docByType.set(d.document_type, d));
  // A disapproved document has to be replaced, so it doesn't count as uploaded.
  const docOk = (t: string) => { const d = docByType.get(t); return !!d && d.status !== "Disapproved"; };
  const docsUploaded = requiredDocTypes.filter(docOk).length;
  const missingDocs = requiredDocTypes.filter(t => !docOk(t));

  // Renewal: approved for the chosen program in an earlier year means this one renews it.
  const approvedBefore = applications.filter((a) => a.status === "Approved" && a.scholarship_id === applyScholarshipId && new Date(a.created_at).getUTCFullYear() < currentYear).length;
  const isRenewing = approvedBefore > 0;
  const minGrade = isRenewing ? settings.renewal_min_grade : settings.min_grade_requirement;
  const myGrade = profile?.average_grade ?? null;
  const applyIssues: string[] = [];
  if (isRenewing && !settings.renewal_enabled) applyIssues.push("Scholarship renewals are not open right now.");
  if (isRenewing && approvedBefore > settings.max_renewals) applyIssues.push(`You have reached the maximum of ${settings.max_renewals} renewal(s).`);
  if (minGrade > 0 && myGrade == null) applyIssues.push(`Add your average grade to your profile (minimum required: ${minGrade}).`);
  else if (minGrade > 0 && myGrade != null && myGrade < minGrade) applyIssues.push(`Your average grade (${myGrade}) is below the minimum of ${minGrade}.`);

  // The office can't review an application without the basics.
  const profileGaps = profileCompleteness(profile).missing.filter((m) => ["first_name", "last_name", "phone", "school_name", "course", "year_level", "average_grade"].includes(m.key));
  if (profileGaps.length > 0) applyIssues.push(`Complete your profile first (Profile tab): ${profileGaps.map((m) => m.label).join(", ")}.`);

  // The chosen program's own rules (the database enforces the same ones).
  const applyProgram = scholarships.find((s) => s.id === applyScholarshipId);
  if (applyProgram) {
    if (!availabilityInfo(applyProgram).canApply) applyIssues.push(`${applyProgram.name}: ${availabilityInfo(applyProgram).label.toLowerCase()}.`);
    const pg = Number(applyProgram.min_grade ?? 0);
    if (pg > 0 && myGrade == null && minGrade < pg) applyIssues.push(`Add your average grade to your profile (${applyProgram.name} requires ${pg}).`);
    else if (pg > 0 && myGrade != null && myGrade < pg) applyIssues.push(`${applyProgram.name} requires an average grade of ${pg}; yours is ${myGrade}.`);
    if (applyProgram.year_levels?.length && !applyProgram.year_levels.includes(profile?.year_level ?? "")) applyIssues.push(`${applyProgram.name} is open to ${applyProgram.year_levels.join(", ")} students only.`);
    if (applyProgram.municipality?.trim() && (profile?.municipality ?? "").trim().toLowerCase() !== applyProgram.municipality.trim().toLowerCase()) applyIssues.push(`${applyProgram.name} is for residents of ${applyProgram.municipality.trim()} only.`);
  }

  // The program behind the current application (shown on the Application tab).
  const appProgram = scholarships.find((sc) => sc.id === currentApp?.scholarship_id);
  const appRenewal = currentApp?.is_renewal ?? false;
  const appMinGrade = Math.max(appRenewal ? settings.renewal_min_grade : settings.min_grade_requirement, Number(appProgram?.min_grade ?? 0));
  const appReqLines = appProgram ? requirementLines(appProgram, appRenewal ? settings.renewal_min_grade : settings.min_grade_requirement) : appMinGrade > 0 ? [`Average grade of at least ${appMinGrade}`] : [];
  const appAward = currentApp?.amount_approved ?? appProgram?.amount;

  // Everything awarded to this student: approved awards, using the program amount where none was set.
  const approvedTotal = applications
    .filter((a) => a.status === "Approved")
    .reduce((t, a) => t + Number(a.amount_approved ?? scholarships.find((sc) => sc.id === a.scholarship_id)?.amount ?? 0), 0);

  const openDocument = async (doc: Tables<"documents">) => {
    const path = documentPath(doc);
    if (!path) { toast.error("Could not open document"); return; }
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { win?.close(); toast.error("Could not open document"); return; }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Document actions ───────────────────────────────────────────────────────
  // Files go straight to private storage; the database then re-checks type, size, ownership and the
  // lock against the stored object before it accepts the row, so these client checks are for UX only.
  const uploadDocument = async (docType: string, file: File) => {
    if (settings.maintenance_mode) { toast.error(settings.maintenance_message); return; }
    if (!DOC_MIME.includes(file.type)) { toast.error("Upload a PDF, JPG or PNG file."); return; }
    if (file.size === 0) { toast.error("That file is empty."); return; }
    if (file.size > settings.max_upload_mb * 1024 * 1024) { toast.error(`File is too large (max ${settings.max_upload_mb} MB).`); return; }

    setUploadingDoc(docType);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const result = await uploadUserDocument(supabase, { userId: user.id, docType, file, applicationId: openApp?.id });
      if ("error" in result) { toast.error("Upload failed", { description: result.error }); return; }
      const row = result.row;

      // Replace: drop the older copies of this document (the database only allows it once a newer one exists).
      const older = documents.filter((d) => d.document_type === docType && d.id !== row.id && inDocSet(d));
      for (const d of older) {
        const { data: gone } = await supabase.from("documents").delete().eq("id", d.id).select("id");
        const oldPath = documentPath(d);
        if (gone?.length && oldPath) await supabase.storage.from("documents").remove([oldPath]);
      }
      toast.success(`${docType} uploaded`);
      loadData();
    } finally {
      setUploadingDoc(null);
    }
  };

  const removeDocument = async () => {
    if (!removeDoc) return;
    setRemovingDoc(true);
    try {
      const { data: gone, error } = await supabase.from("documents").delete().eq("id", removeDoc.id).select("id");
      if (error) { toast.error(error.message); return; }
      if (!gone?.length) { toast.error("This document can't be removed right now. Upload a replacement instead."); return; }
      const path = documentPath(removeDoc);
      if (path) await supabase.storage.from("documents").remove([path]);
      toast.success("Document removed");
      setRemoveDoc(null);
      loadData();
    } finally {
      setRemovingDoc(false);
    }
  };

  // ── Application actions ────────────────────────────────────────────────────
  const submitApplication = async () => {
    if (!applyScholarshipId) return;
    setApplyLoading(true);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scholarship_id: applyScholarshipId,
          certified: applyCertified,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to submit application.");
      } else {
        toast.success(isRenewing ? "Renewal application submitted!" : "Application submitted!");
        setApplyDialogOpen(false);
        setApplyScholarshipId(""); setApplyCertified(false);
        loadData();
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setApplyLoading(false);
    }
  };

  const withdrawApplication = async () => {
    if (!selectedApp) return;
    setWithdrawing(true);
    try {
      const res = await fetch(`/api/applications/${selectedApp.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? "Could not withdraw the application."); return; }
      toast.success("Application withdrawn");
      setWithdrawOpen(false);
      loadData();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setWithdrawing(false);
    }
  };

  // ── Section: Application ───────────────────────────────────────────────────
  const openApply = (programId = "") => { setApplyScholarshipId(programId); setApplyDialogOpen(true); };
  const viewApplication = (id: string) => { setSelectedAppId(id); setViewOpen(true); };
  const withdrawPrompt = (a: typeof applications[number]) => { setSelectedAppId(a.id); setWithdrawOpen(true); };

  // Documents shown with an application: this year's shared set, or what was filed with an older one.
  const docsFor = (a: typeof applications[number]) => {
    if (yearAppIds.has(a.id)) return [...docByType.values()];
    const latest = new Map<string, Tables<"documents">>();
    [...documents].filter((d) => d.application_id === a.id)
      .sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))
      .forEach((d) => latest.set(d.document_type, d));
    return [...latest.values()];
  };

  // Does the student pass this application's program requirements? Same rules the office checks on approval.
  const requirementsChecklist = (app: typeof applications[number]) => {
    const program = scholarships.find((sc) => sc.id === app.scholarship_id);
    if (!program) return null;
    const checks = [
      ...programChecks(program, profile, {
        globalMinGrade: settings.min_grade_requirement, renewalMinGrade: settings.renewal_min_grade,
        renewalEnabled: settings.renewal_enabled, isRenewal: app.is_renewal,
      }),
      ...requiredDocTypes.map((t) => {
        const d = docByType.get(t);
        return { key: `doc-${t}`, label: t, ok: d?.status === "Verified", detail: !d ? "Not uploaded" : d.status === "Pending" ? "Waiting for the office to verify" : d.status };
      }),
    ];
    const passing = checks.filter((c) => c.ok).length;
    return (
      <div className="rounded-xl border border-border p-3 sm:p-4">
        <p className="text-xs font-semibold text-foreground mb-2">
          Requirements for {program.name} · {passing} of {checks.length} met
        </p>
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2 text-xs">
              {c.ok ? <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" /> : <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />}
              <span><span className="font-medium text-foreground">{c.label}</span> <span className="text-muted-foreground">· {c.detail}</span></span>
            </li>
          ))}
        </ul>
        {passing < checks.length && <p className="text-[11px] text-muted-foreground mt-2">The office can approve this application once every requirement is met.</p>}
      </div>
    );
  };

  const Application = () => (
    <div className="space-y-5">
      {locked && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Lock className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            You are approved for <strong>{approvedApps.map((a) => a.scholarships?.name ?? "a scholarship").join(", ")}</strong>. Your school details and documents are now locked, but you can still apply to other open programs. Each program reviews you against its own requirements.
          </p>
        </div>
      )}

      {/* Apply: any open program not applied to yet */}
      <Panel className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <SectionTitle>Apply for a scholarship</SectionTitle>
            <p className="text-sm text-muted-foreground -mt-3">
              You can apply to every open program. Each program (office) checks your application against its own requirements, so you can be approved for more than one.
            </p>
          </div>
          <Button disabled={!canApplyMore || programsToApply.length === 0} onClick={() => openApply()} className="bg-primary hover:bg-primary text-white rounded-xl px-5">
            <FileText className="mr-2 h-4 w-4" /> New application
          </Button>
        </div>
        {applyBlocked ? (
          <div className="mt-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>{applyBlocked}</span>
          </div>
        ) : programsToApply.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {yearApps.length > 0 ? "You have applied to every open program. New programs will show up here when they open." : "No programs are open right now. New programs will show up here when they open."}
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {programsToApply.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{[Number(s.amount) > 0 ? peso(s.amount) : null, s.deadline ? `Closes ${formatDate(s.deadline)}` : null].filter(Boolean).join(" · ") || "Open now"}</p>
                </div>
                <Button size="sm" variant="outline" className="rounded-lg text-xs border-primary/30 text-primary hover:bg-accent shrink-0" onClick={() => openApply(s.id)}>Apply</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* This year's applications */}
      {yearApps.map((a) => (
        <Panel key={a.id} className={a.id === approvedApp?.id ? "border-emerald-200" : ""}>
          <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-muted flex items-center justify-between flex-wrap gap-3">
            <div className="min-w-0">
              <SectionTitle>{a.scholarships?.name ?? "Scholarship"}</SectionTitle>
              <p className="text-sm text-muted-foreground -mt-3">Submitted {formatDate(a.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              {a.is_renewal && (
                <span className="inline-flex items-center rounded-full border border-primary/20 bg-accent px-2.5 py-0.5 text-xs font-semibold text-primary">Renewal</span>
              )}
              <StatusBadge status={a.status} />
            </div>
          </div>
          <div className="p-4 sm:p-6 space-y-5">
            <ApplicationTimeline app={a} payments={payments} />
            {(a.status === "Pending" || a.status === "Waitlisted") && requirementsChecklist(a)}
            <div className="flex flex-wrap gap-2">
              {(a.status === "Pending" || a.status === "Waitlisted") && (
                <Button size="sm" variant="outline" className="text-xs border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                  onClick={() => withdrawPrompt(a)}>
                  <Trash2 className="mr-1 h-3 w-3" /> Withdraw
                </Button>
              )}
              <Button size="sm" variant="outline" className="text-xs border-border rounded-xl hover:bg-muted" onClick={() => viewApplication(a.id)}>
                <Eye className="mr-1 h-3 w-3" /> View
              </Button>
            </div>
          </div>
        </Panel>
      ))}

      {/* Program details for the application in focus (was the separate Scholarship tab) */}
      {currentApp && currentApp.status !== "Disapproved" && (
        <Panel>
          <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-muted">
            <SectionTitle>About this program</SectionTitle>
            <p className="text-sm text-muted-foreground -mt-3">{currentApp.scholarships?.name} · conditions and requirements</p>
          </div>
          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl bg-muted border border-muted p-4">
                <p className="text-xs text-muted-foreground mb-1">{currentApp.status === "Approved" ? "Approved award" : "Award per scholar"}</p>
                <p className="text-xl font-bold text-sidebar-accent">{Number(appAward) > 0 ? peso(appAward) : "To be announced"}</p>
              </div>
              <div className="rounded-xl bg-muted border border-muted p-4">
                <p className="text-xs text-muted-foreground mb-1">Required grade</p>
                <p className="text-xl font-bold text-sidebar-accent">{appMinGrade > 0 ? `${appMinGrade} and above` : "No minimum"}</p>
              </div>
              {appProgram && (
                <>
                  <div className="rounded-xl bg-muted border border-muted p-4">
                    <p className="text-xs text-muted-foreground mb-1">Application deadline</p>
                    <p className="text-sm font-semibold text-sidebar-accent">{appProgram.deadline ? `${formatDate(appProgram.deadline)} (${deadlineLabel(appProgram.deadline)})` : "No closing date"}</p>
                  </div>
                  <div className="rounded-xl bg-muted border border-muted p-4">
                    <p className="text-xs text-muted-foreground mb-1">Slots</p>
                    <p className="text-sm font-semibold text-sidebar-accent">{slotsLabel(appProgram)}</p>
                  </div>
                </>
              )}
            </div>
            {appProgram?.description && <p className="text-sm text-muted-foreground leading-relaxed">{appProgram.description}</p>}
            <div>
              <p className="text-sm font-semibold text-foreground mb-3">Eligibility &amp; conditions</p>
              <div className="space-y-2">
                {[
                  ...appReqLines,
                  ...(appProgram?.eligibility ? [appProgram.eligibility] : []),
                  `Keep these documents on file: ${requiredDocTypes.join(", ") || "none required"}.`,
                  ...(settings.renewal_enabled ? [`You may renew up to ${settings.max_renewals} time(s)${settings.renewal_min_grade > 0 ? `, with an average grade of at least ${settings.renewal_min_grade}` : ""}.`] : []),
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
      )}

      {/* Every application, all years */}
      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Application history</SectionTitle></div>
        <ApplicationHistory applications={applications} onView={viewApplication} />
      </Panel>

      {/* View */}
      <Dialog open={viewOpen && !!selectedApp} onOpenChange={setViewOpen}>
        <DialogContent className="rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Application details</DialogTitle></DialogHeader>
          {selectedApp && (
            <>
              <DisapprovalReason app={selectedApp} />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground mb-1">Program</p><p className="font-semibold">{selectedApp.scholarships?.name || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Status</p><StatusBadge status={selectedApp.status} /></div>
                <div><p className="text-xs text-muted-foreground mb-1">Submitted</p><p className="font-semibold">{new Date(selectedApp.created_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Type</p><p className="font-semibold">{selectedApp.is_renewal ? "Renewal" : "New application"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">School</p><p className="font-semibold">{selectedApp.school_name || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Course · Year</p><p className="font-semibold">{[selectedApp.course, selectedApp.year_level].filter(Boolean).join(" · ") || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Average grade</p><p className="font-semibold">{selectedApp.average_grade ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Amount approved</p><p className="font-semibold">{peso(selectedApp.amount_approved)}</p></div>
              </div>
              {selectedApp.notes && selectedApp.status !== "Disapproved" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Remarks from the scholarship office</p>
                  <p className="text-sm whitespace-pre-wrap rounded-xl bg-muted/50 px-3 py-2">{selectedApp.notes}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Documents</p>
                {docsFor(selectedApp).length === 0 ? <p className="text-sm text-muted-foreground">None on file.</p> : (
                  <ul className="space-y-1">
                    {docsFor(selectedApp).map((d) => (
                      <li key={d.id}>
                        <button type="button" onClick={() => openDocument(d)}
                          className="w-full flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm hover:bg-muted text-left cursor-pointer">
                          <span className="truncate"><span className="font-medium">{d.document_type}</span> · {d.file_name}</span>
                          <span className="flex items-center gap-2 shrink-0"><DocStatusBadge status={d.status} /><Eye className="h-3.5 w-3.5 text-muted-foreground" /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selectedApp.certified_at && (
                <p className="text-xs text-muted-foreground">Certified true and correct on {new Date(selectedApp.certified_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Withdraw */}
      <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this application?</AlertDialogTitle>
            <AlertDialogDescription>
              Your application for {selectedApp?.scholarships?.name} will be withdrawn. Your other applications and your uploaded documents are kept, and you can apply to this program again while it is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={withdrawing}>Keep application</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-red-600 hover:bg-red-700 text-white" disabled={withdrawing}
              onClick={(e) => { e.preventDefault(); withdrawApplication(); }}>
              {withdrawing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent className="rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{isRenewing ? "Renew Scholarship" : "Apply for Scholarship"}</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>You can apply to every open program. <strong>Each program decides on its own</strong>: you are approved only if you meet that program&apos;s requirements{minGrade > 0 && <>, including an average grade of at least <strong>{minGrade}</strong></>}.</span>
          </div>
          {isRenewing && (
            <div className="flex items-start gap-3 bg-accent border border-primary/20 rounded-xl px-4 py-3 text-sm text-foreground text-left">
              <GraduationCap className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span>This is a <strong>renewal</strong> (renewal {Math.min(approvedBefore, settings.max_renewals)} of {settings.max_renewals} allowed). You were approved for this program before, so the renewal grade requirement applies{settings.renewal_min_grade > 0 ? <> ({settings.renewal_min_grade})</> : null}.</span>
            </div>
          )}
          {applyIssues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 space-y-1">
              {applyIssues.map((m) => <p key={m}>{m}</p>)}
            </div>
          )}
          {missingDocs.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold mb-1">Upload your required documents first</p>
              <p className="mb-2">Missing or disapproved: {missingDocs.join(", ")}.</p>
              <Button size="sm" variant="outline" className="rounded-xl border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => { setApplyDialogOpen(false); setActive("documents"); }}>
                <Upload className="mr-1 h-3 w-3" /> Go to Documents
              </Button>
            </div>
          )}
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">Scholarship Program *</Label>
            <Select value={applyScholarshipId} onValueChange={setApplyScholarshipId}>
              <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select program" /></SelectTrigger>
              <SelectContent>
                {scholarships.filter((s) => (availabilityInfo(s).canApply && !appliedProgramIds.has(s.id)) || s.id === applyScholarshipId).map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={!availabilityInfo(s).canApply || appliedProgramIds.has(s.id)}>
                    {s.name}{Number(s.amount) > 0 ? ` · ${peso(s.amount)}` : ""}{appliedProgramIds.has(s.id) ? " (already applied)" : !availabilityInfo(s).canApply ? ` (${availabilityInfo(s).label})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-start gap-3 text-sm text-foreground cursor-pointer">
            <Checkbox checked={applyCertified} onCheckedChange={(v) => setApplyCertified(v === true)} className="mt-0.5" />
            <span>I certify that the information and documents I have provided are true and correct.</span>
          </label>
          <DialogFooter>
            <Button
              disabled={!canApplyMore || !applyScholarshipId || appliedProgramIds.has(applyScholarshipId) || applyLoading || applyIssues.length > 0 || missingDocs.length > 0 || !applyCertified}
              className="bg-primary hover:bg-primary text-white rounded-xl w-full"
              onClick={submitApplication}>
              {applyLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRenewing ? "Submit Renewal" : "Submit Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // ── Section: Documents ─────────────────────────────────────────────────────
  const Documents = () => (
    <div className="space-y-4">
      {locked && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <Lock className="h-4 w-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">Documents are locked because a scholarship has been approved. Your verified documents still count for your other applications.</p>
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
            style={{ width: `${requiredDocTypes.length ? (docsUploaded / requiredDocTypes.length) * 100 : 100}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {docsUploaded === requiredDocTypes.length ? "All required documents uploaded." : `${requiredDocTypes.length - docsUploaded} document(s) remaining.`}
          {" "}PDF, JPG or PNG, up to {settings.max_upload_mb} MB each.
        </p>
      </Panel>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {requiredDocTypes.map((docType) => {
          const uploaded = docByType.get(docType);
          const busy = uploadingDoc === docType;
          const canRemove = !!uploaded && !locked && (!uploaded.application_id || uploaded.status === "Disapproved");
          const tone = !uploaded ? "" : uploaded.status === "Disapproved" ? "border-red-200" : uploaded.status === "Verified" ? "border-emerald-200" : "border-amber-100";
          return (
            <Panel key={docType} className={`p-4 ${tone}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    !uploaded ? "bg-muted" : uploaded.status === "Disapproved" ? "bg-red-100" : uploaded.status === "Verified" ? "bg-emerald-100" : "bg-amber-100"}`}>
                    <FileText className={`h-5 w-5 ${
                      !uploaded ? "text-muted-foreground" : uploaded.status === "Disapproved" ? "text-red-600" : uploaded.status === "Verified" ? "text-emerald-600" : "text-amber-600"}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{docType}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {uploaded ? [uploaded.file_name, fmtSize(uploaded.file_size)].filter(Boolean).join(" · ") : "Not uploaded"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 items-center sm:shrink-0">
                  {uploaded && (
                    <Button size="sm" variant="outline" className="h-10 w-10 sm:h-8 sm:w-8 p-0 rounded-xl border-border hover:bg-muted"
                      aria-label={`View ${docType}`} onClick={() => openDocument(uploaded)}>
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                  {canRemove && (
                    <Button size="sm" variant="outline" className="h-10 w-10 sm:h-8 sm:w-8 p-0 rounded-xl border-red-200 hover:bg-red-50"
                      aria-label={`Remove ${docType}`} onClick={() => setRemoveDoc(uploaded)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  )}
                  <Label className={`flex-1 sm:flex-none ${busy ? "pointer-events-none" : "cursor-pointer"}`}>
                    <Input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" disabled={locked || busy}
                      onChange={async (e) => {
                        const input = e.target;
                        const file = input.files?.[0];
                        input.value = ""; // so picking the same file again still fires onChange
                        if (file) await uploadDocument(docType, file);
                      }} />
                    <span className={`inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 sm:py-1.5 text-xs font-semibold transition-colors ${
                      locked || busy ? "opacity-50 pointer-events-none border-border text-muted-foreground" :
                      uploaded && uploaded.status !== "Disapproved" ? "border-primary/20 text-primary hover:bg-accent" : "border-primary bg-primary text-white hover:bg-primary"
                    }`}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      {busy ? "Uploading…" : uploaded ? (uploaded.status === "Disapproved" ? "Upload new" : "Replace") : "Upload"}
                    </span>
                  </Label>
                </div>
              </div>
              {uploaded && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <DocStatusBadge status={uploaded.status} />
                  <span className="text-[11px] text-muted-foreground">Uploaded {new Date(uploaded.uploaded_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
              )}
              {uploaded?.status === "Disapproved" && uploaded.review_note && (
                <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  <span className="font-semibold">Reason: </span>{uploaded.review_note}
                </p>
              )}
            </Panel>
          );
        })}
      </div>

      <AlertDialog open={!!removeDoc} onOpenChange={(o) => { if (!o) setRemoveDoc(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeDoc?.document_type} ({removeDoc?.file_name}) will be deleted. You will need to upload it again before you can apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={removingDoc}>Keep it</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-red-600 hover:bg-red-700 text-white" disabled={removingDoc}
              onClick={(e) => { e.preventDefault(); removeDocument(); }}>
              {removingDoc && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  // ── Section: Notifications ─────────────────────────────────────────────────
  const Notifications = () => (
    <NotificationInbox notifications={notifications} setNotifications={setNotifications} onNavigate={goToLink}
      userId={userId} unreadTotal={unreadTotal} onUnreadChange={() => refreshUnread(userId)}
      categoryLabels={{ payment: "Payouts" }} />
  );

  // ── Section: Settings ──────────────────────────────────────────────────────
  const SettingsView = () => (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground">How we contact you, how you sign in, and your data. Your personal details are on the Profile tab.</p>
      </div>

      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Notifications</SectionTitle></div>
        <div className="p-4 sm:p-6">
          <NotificationPreferences userId={userId} email={userEmail} categories={[
            { key: "application", label: "Application updates", hint: "Submitted, decisions, and reviews of your documents" },
            { key: "verification", label: "Verification", hint: "Identity checks and grade verification" },
            { key: "payment", label: "Payouts", hint: "Scheduled, released, receipt reviews and replies to your reports" },
            { key: "program", label: "Announcements & deadlines", hint: "New programs and closing dates" },
          ]} />
        </div>
      </Panel>

      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Security</SectionTitle></div>
        <div className="p-4 sm:p-6"><SecuritySettings userId={userId} /></div>
      </Panel>

      <AccountSettings userId={userId} userEmail={userEmail} profile={profile} dataRequests={dataRequests} onChanged={() => refreshProfile(userId)} />
    </div>
  );

  const openNotification = async (n: Tables<"notifications">) => {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      if (error) setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)));
      refreshUnread(userId);
    }
    if (n.link) goToLink(n.link);
    else setActive("notifications");
  };

  const markAllRead = async () => {
    if (unreadTotal === 0) return;
    setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnreadTotal(0);
    // Every unread notification, not only the ones on this page.
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
    if (error) { toast.error("Could not mark them as read"); loadData(); }
  };

  // Notification deep links look like /student-dashboard?section=payments
  const goToLink = (link: string) => {
    const u = new URL(link, window.location.origin);
    if (u.pathname === "/student-dashboard") {
      const sec = u.searchParams.get("section");
      if (sec) { const key = SECTION_ALIASES[sec] ?? sec; if (sidebarItems.some((i) => i.key === key)) setActive(key); }
      // Reminder links carry the program to apply for.
      const apply = u.searchParams.get("apply");
      if (apply && canApplyMore && !appliedProgramIds.has(apply)) { setApplyScholarshipId(apply); setApplyDialogOpen(true); }
    } else {
      router.push(link);
    }
  };

  activeRef.current = active;
  goToLinkRef.current = goToLink;

  const renderActive = () => {
    switch (active) {
      case "overview":
      default:              return (
        <Overview displayName={displayName} profile={profile} applications={applications} currentApp={currentApp} yearApps={yearApps} canApplyMore={canApplyMore} payments={payments}
          issues={issues} gradeUpdates={gradeUpdates} scholarships={scholarships} notifications={notifications} settings={settings}
          applyBlocked={applyBlocked} approvedTotal={approvedTotal} locked={locked} isDisbursed={isDisbursed} currentYear={currentYear}
          docStatus={{
            uploaded: docsUploaded, required: requiredDocTypes.length, missing: missingDocs,
            disapproved: requiredDocTypes.filter((t) => docByType.get(t)?.status === "Disapproved").map((t) => ({ type: t, note: docByType.get(t)?.review_note ?? null })),
          }}
          onNavigate={setActive}
          onApply={(id) => { openApply(id); setActive("application"); }}
          onViewApplication={(id) => { setActive("application"); viewApplication(id); }}
          unreadCount={unreadTotal} onOpenNotification={openNotification} onMarkAllRead={markAllRead} />
      );
      case "application":   return Application(); // called, not rendered: inputs inside must keep focus
      case "documents":     return Documents();
      case "disbursement":  return <DisbursementSection payments={payments} issues={issues} disbursementStatus={currentApp?.disbursement_status} approvedTotal={approvedTotal} onChanged={refreshPayments} />;
      case "notifications": return Notifications(); // called, not rendered: the inbox keeps its search and selection
      case "profile":       return (
        <ProfileSection profile={profile} userId={userId} userEmail={userEmail} applications={applications} locked={locked}
          gradeUpdates={gradeUpdates} onChanged={() => refreshProfile(userId)} />
      );
      case "settings":      return SettingsView(); // called, not rendered: its children keep their state
    }
  };

  const activeItem = sidebarItems.find((i) => i.key === active);

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-dvh flex w-full bg-background">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed lg:sticky top-0 left-0 z-40 h-dvh w-64 max-w-[85vw] bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300`}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shrink-0 overflow-hidden">
            <Image src="/municipal-logo.png" alt="Logo" width={36} height={36} className="h-9 w-9 object-cover" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-display font-bold text-sidebar-foreground truncate">SB San Jose</p>
            <p className="text-xs text-muted-foreground">Scholarship Portal</p>
          </div>
          <button className="lg:hidden ml-auto -mr-2 h-10 w-10 flex items-center justify-center rounded-xl text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
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
                className={`w-full flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-xl text-sm font-medium transition-all relative cursor-pointer ${
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
        <div className="p-3 pb-safe border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-sidebar-accent mb-2">
            <div className="h-8 w-8 rounded-xl overflow-hidden shrink-0">
              <ProfileImage value={profile?.profile_picture_url} className="h-full w-full object-cover"
                fallback={<div className="h-full w-full bg-primary flex items-center justify-center"><User className="h-4 w-4 text-primary-foreground" /></div>} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">{displayName || "Student"}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Overlay (mobile) */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top header */}
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b border-border h-16 flex items-center justify-between gap-2 px-3 sm:px-5">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button className="lg:hidden h-11 w-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-muted transition-colors cursor-pointer" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5 text-muted-foreground" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-foreground text-base leading-tight truncate">{activeItem?.label ?? "Dashboard"}</h1>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            <button
              onClick={() => setActive("notifications")}
              className="relative h-11 w-11 flex items-center justify-center rounded-xl hover:bg-muted transition-colors cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-3 sm:p-5 md:p-7 pb-safe overflow-x-hidden overflow-y-auto">
          {loadError && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Some of your information didn&apos;t load</p>
                <p className="text-xs mt-0.5">What you see may be incomplete or out of date. {loadError}</p>
              </div>
              <Button size="sm" variant="outline" className="rounded-lg shrink-0 bg-white/70" onClick={loadData}>Try again</Button>
            </div>
          )}
          {renderActive()}
        </main>
      </div>
    </div>
  );
}
