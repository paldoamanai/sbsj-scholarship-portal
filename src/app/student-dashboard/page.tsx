"use client";

import { useHistorySync } from "@/hooks/use-history-sync";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppDialog, Detail, DetailGrid, DialogField, DialogSection } from "@/components/AppDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  LayoutDashboard, FileText, Upload, GraduationCap, Banknote, Receipt,
  Bell, User, Settings as SettingsIcon, LogOut, Menu, Lock, Download,
  AlertTriangle, CheckCircle, Clock, Eye, Trash2, Loader2,
  X, HelpCircle, Printer, Home, MapPin,
} from "@/components/icons";
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
import { applicationsBlockedReason, ayStart } from "@/lib/settings";
import { APPLICATION_DOCS, DOC_MIME, LETTER_OF_INTENT, MOA, PHOTO_MIME, documentPath, shrinkPhoto, uploadLetterPhoto, uploadUserDocument } from "@/lib/documents";
import { uploadPendingDocuments } from "@/lib/pending-documents";
import { HOUSE_PHOTO, approvalDocuments, asksLetter, documentNote, followUpDocuments, needsHomeVisit, needsHousePin, needsMoa, photosOnly, programDocuments } from "@/lib/office-requirements";
import HouseLocationDialog from "@/components/student/HouseLocationDialog";
import { OFFICE_LABEL, isOffice } from "@/lib/permissions";
import { googleMapsLink } from "@/lib/geo";
import { availabilityInfo, programChecks, requirementLines, sameTown, slotsLabel, deadlineLabel, type PublicScholarship } from "@/lib/scholarships";
import { inBarangays } from "@/lib/barangays";
import { formatDate, peso, pesoFixed } from "@/lib/format";
import ApplicationTimeline from "@/components/student/ApplicationTimeline";
import ApplicationHistory, { DisapprovalReason } from "@/components/student/ApplicationHistory";
import HelpSection from "@/components/student/HelpSection";
import { printAwardNotice } from "@/lib/award-notice";
import { downloadReceiptSlipPDF } from "@/lib/receipt-slip";
import { isOneTime, termLabel, yearlyAward } from "@/lib/release-schedule";
import DashboardSkeleton from "@/components/DashboardSkeleton";

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
// Shared receipt-submission logic. The student types the receipt number printed on the acknowledgment
// slip they signed. The database checks it against the number the portal issued: a match is accepted on
// the spot, a wrong number is refused (after 5 wrong tries it goes to staff). Older payments without a
// portal number are reviewed by staff as before.
const RECEIPT_REF = /^[A-Za-z0-9][A-Za-z0-9 /#._-]{2,39}$/;

function useReceiptSubmit(onSubmitted: () => void) {
  const supabase = createClient();
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const submit = async (paymentId: string) => {
    const ref = (refs[paymentId] ?? "").trim();
    if (!RECEIPT_REF.test(ref)) { toast.error("Enter the receipt number exactly as printed on your slip (3–40 letters or numbers)."); return; }
    if (!confirmed[paymentId]) return;
    setSubmittingFor(paymentId);
    try {
      const { data: result, error } = await supabase.rpc("submit_student_receipt", { _payment_id: paymentId, _reference: ref });
      if (error) { toast.error("Could not submit", { description: error.message }); return; }
      if (result === "mismatch") {
        toast.error("That number doesn't match this payment", { description: "Check the receipt number on your slip (e.g. AR-26-7K3QX9) and try again." });
        return;
      }
      if (result === "accepted") toast.success("Receipt confirmed. Thank you!");
      else if (result === "review") toast.warning("We couldn't match the number, so the office will check it.");
      else toast.success("Receipt number submitted.");
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

  // Soft copy of the acknowledgment slip, once the receipt number is confirmed (migration 053).
  const [downloadingFor, setDownloadingFor] = useState<string | null>(null);
  const downloadSlip = async (paymentId: string, period?: string | null) => {
    setDownloadingFor(paymentId);
    try {
      const { data, error } = await supabase.rpc("get_my_receipt_slip", { _payment_id: paymentId });
      const slip = data?.[0];
      if (error || !slip) { toast.error("Could not download your slip", { description: error?.message }); return; }
      await downloadReceiptSlipPDF({
        receiptNo: slip.receipt_no, studentName: slip.student_name, program: slip.program, period,
        amount: Number(slip.amount), method: slip.method, reference: slip.reference,
        disbursedAt: slip.disbursed_at, confirmedAt: slip.confirmed_at,
      });
    } catch {
      toast.error("Could not download your slip");
    } finally {
      setDownloadingFor(null);
    }
  };

  return { refs, setRefs, submittingFor, confirmed, setConfirmed, submit, view, downloadingFor, downloadSlip };
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
  const { refs, setRefs, submittingFor, confirmed, setConfirmed, submit, view, downloadingFor, downloadSlip } = ctl;
  const disapproved = p.receipt_review_status === "Disapproved";

  if (p.student_receipt_at && !disapproved) {
    const accepted = p.receipt_review_status === "Accepted";
    return (
      <div className="space-y-1">
        {p.student_receipt_ref ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <CheckCircle className="h-3.5 w-3.5" /> Receipt no. <span className="font-mono">{p.student_receipt_ref}</span> · {formatDate(p.student_receipt_at)}
          </span>
        ) : p.student_receipt_path ? (
          <button type="button" onClick={() => view(p.student_receipt_path)} className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium hover:underline cursor-pointer">
            <CheckCircle className="h-3.5 w-3.5" /> Submitted {formatDate(p.student_receipt_at)} · View
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <CheckCircle className="h-3.5 w-3.5" /> Receipt confirmed {formatDate(p.student_receipt_at)}
          </span>
        )}
        <p className={`text-[11px] font-semibold ${accepted ? "text-emerald-700" : "text-amber-700"}`}>{accepted ? (p.receipt_reviewed_by ? "Accepted by the office" : "Confirmed") : "Waiting for the office to review"}</p>
        {accepted && p.student_receipt_ref && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs rounded-lg" disabled={downloadingFor === p.id} onClick={() => downloadSlip(p.id, termLabel(p.term, p.academic_year) || null)}>
            {downloadingFor === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Download slip (PDF)
          </Button>
        )}
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
        Enter the <strong>receipt number</strong> printed on the acknowledgment slip you signed when you received the {p.method === "Cheque" ? "cheque" : "money"} (it looks like AR-26-7K3QX9).
      </p>
      <div className="flex items-center gap-1.5">
        <Input value={ref} maxLength={40} placeholder="Receipt no." aria-label="Receipt number"
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
      ["Period", "Reference", "Amount", "Method", "Status", "Scheduled", "Disbursed", "Receipt ref.", "Receipt review"],
      ...payments.map((p) => [
        termLabel(p.term, p.academic_year), p.reference ?? "", p.amount.toFixed(2), p.method ?? "", p.status, p.scheduled_date ?? "",
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
                <p className="text-2xl font-bold text-black mt-1">{pesoFixed(next.amount)}</p>
                <p className="text-sm text-muted-foreground">{termLabel(next.term, next.academic_year) && `${termLabel(next.term, next.academic_year)} · `}{next.scheduled_date ? `Scheduled ${formatDate(next.scheduled_date)}` : "Date to be announced"} · via {next.method || "—"}</p>
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
            For each disbursed payment, <strong>enter the receipt number</strong> printed on the acknowledgment slip you signed and <strong>confirm you received it</strong>.
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
              <div key={p.id} className={`rounded-xl border p-4 space-y-3 ${isDisbursedPay ? "border-emerald-100 bg-emerald-50/40" : cancelled ? "border-muted bg-muted/40" : "border-muted"}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-semibold text-black">
                      {pesoFixed(p.amount)}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">via {p.method || "—"}</span>
                    </p>
                    {termLabel(p.term, p.academic_year) && <p className="text-xs font-medium text-primary mt-0.5">{termLabel(p.term, p.academic_year)}</p>}
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

      <AppDialog open={!!issueFor} onOpenChange={(o) => { if (!o) setIssueFor(null); }} className="rounded-2xl"
        title="Report a problem"
        description={issueFor && <>Payment of {pesoFixed(issueFor.amount)} · {issueFor.status}</>}
        footer={<>
          <Button variant="outline" className="rounded-xl" disabled={sending} onClick={() => setIssueFor(null)}>Cancel</Button>
          <Button className="rounded-xl" disabled={sending || issueText.trim().length < 10} onClick={sendIssue}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send report
          </Button>
        </>}>
        <DialogField label="What&apos;s wrong?" htmlFor="issue-kind">
          <Select value={issueKind} onValueChange={setIssueKind}>
            <SelectTrigger id="issue-kind" className="rounded-xl border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(ISSUE_KINDS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </DialogField>
        <DialogField label="Tell us what happened" htmlFor="issue-text"
          hint={<span className={issueText.trim().length < 10 ? "text-amber-700" : undefined}>{issueText.trim().length} / 1000 (minimum 10)</span>}>
          <Textarea id="issue-text" rows={4} value={issueText} maxLength={1000} className="rounded-xl" onChange={(e) => setIssueText(e.target.value)}
            placeholder="For example: I went to the office on the scheduled date but was told there was no payment for me." />
        </DialogField>
      </AppDialog>
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
  { icon: HelpCircle,      label: "Help",           key: "help" },
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
  const [applications, setApplications] = useState<(Tables<"applications"> & { scholarships: { name: string; office: string | null } | null })[]>([]);
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
  // The letter of intent photo for the application being written, and a preview of it.
  const [applyLetter, setApplyLetter]               = useState<{ file: File; url: string } | null>(null);
  const [replacingLetter, setReplacingLetter]       = useState(false);
  const [uploadingMoa, setUploadingMoa]             = useState<string | null>(null);
  const [houseOpen, setHouseOpen]                   = useState(false);
  const submittingRef = useRef(false);
  // The application the View / Withdraw dialogs act on.
  const [selectedAppId, setSelectedAppId]           = useState<string | null>(null);
  const [viewOpen, setViewOpen]                     = useState(false);
  const [withdrawOpen, setWithdrawOpen]             = useState(false);
  const [withdrawing, setWithdrawing]               = useState(false);
  const [markingDone, setMarkingDone]               = useState<string | null>(null);
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
    } catch (err) {
      console.error("Student dashboard failed to load", err);
      const detail = err instanceof Error ? err.message : String(err);
      setLoadError(`We couldn't reach the server. (${detail})`);
      setLoading(false);
    }
  };

  const loadDataInner = async () => {
    setLoading(true);
    // The middleware has already verified the session for this page, so read it locally instead of
    // another round trip to Supabase; row-level security still guards every query below.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) { router.push("/login"); return; }
    setUserEmail(user.email || "");
    setUserId(user.id);

    const [profileRes, appsRes, docsRes, paymentsRes, notifsRes, scholsRes, issuesRes, gradesRes, requestsRes, unreadRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("applications").select("*, scholarships(name, office)").eq("user_id", user.id).order("created_at", { ascending: false }),
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
      supabase.from("applications").select("*, scholarships(name, office)").eq("user_id", uid).order("created_at", { ascending: false }),
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

  // All tabs on this site share one login cookie. If another tab signs out or signs in as a different
  // account, this tab would keep showing the old student's data while its requests go out as the new
  // account (e.g. "Payment not found" on receipt submit). Reload so the page matches the session.
  useEffect(() => {
    if (!userId) return;
    const checkSession = (sessionUserId: string | undefined) => {
      if (sessionUserId !== userId) window.location.reload();
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => checkSession(session?.user?.id));
    // Covers changes the cross-tab broadcast can miss: re-read the cookie when the tab comes back into view.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      supabase.auth.getSession().then(({ data: { session } }) => checkSession(session?.user?.id));
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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

  // The academic year setting, matching the server and database checks (one application per program
  // per academic year).
  const academicYear = settings.academic_year;
  // This academic year's applications. A withdrawn one no longer counts: that program can be applied to again.
  const yearApps     = applications.filter((app) => app.status !== "Withdrawn" && app.academic_year === academicYear);
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
  // Open programs this student hasn't applied to yet this academic year.
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
  // Each program asks for its office's documents (Barangay Affairs and MSWDO have their own lists, as
  // photos) or the Settings list; MSWDO also has documents that can follow after applying. The Documents
  // tab shows what the programs applied to this academic year ask for; the documents needed to apply are
  // uploaded from the application form.
  const docsForProgram = (p: { office?: string | null } | undefined) => programDocuments(p?.office, settings.required_documents);
  const approvalDocsFor = (p: { office?: string | null } | undefined) => approvalDocuments(p?.office, settings.required_documents);
  // Each application has its own documents (migration 073). Uploads in the application form aren't
  // filed with an application yet (application_id null); the new application takes the ones its program
  // asks for. Letters of intent and MOAs have their own panels. Latest copy of each type wins.
  const docMaps = new Map<string | null, Map<string, Tables<"documents">>>();
  const docsOf = (appId: string | null) => {
    let m = docMaps.get(appId);
    if (!m) {
      m = new Map();
      for (const d of [...documents].sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))) {
        if (!APPLICATION_DOCS.includes(d.document_type) && (d.application_id ?? null) === appId) m.set(d.document_type, d);
      }
      docMaps.set(appId, m);
    }
    return m;
  };
  // A disapproved document has to be replaced, so it doesn't count as uploaded.
  const docOkIn = (appId: string | null, t: string) => { const d = docsOf(appId).get(t); return !!d && d.status !== "Disapproved"; };
  const isPhoto = (d: Tables<"documents"> | undefined) => !d?.mime_type || PHOTO_MIME.includes(d.mime_type);
  const needsPhoto = (_t: string, office?: string | null) => photosOnly(office);

  // Every application the student submitted. This academic year's applications still in review take
  // uploads; the others (approved, disapproved, withdrawn, earlier years) show what was filed with them.
  const docPrograms = applications.map((a) => ({
    key: a.id, name: a.scholarships?.name ?? "Scholarship", office: a.scholarships?.office ?? null, app: a,
    editable: yearAppIds.has(a.id) && (a.status === "Pending" || a.status === "Waitlisted"),
  }));
  const housePinned = profile?.home_lat != null && profile?.home_lng != null;
  // For the Overview: what the applications in review still need.
  const openDocs = docPrograms.filter((p) => p.editable).flatMap((p) => approvalDocsFor(p).map((t) => ({ p, t, label: `${t} (${p.name})` })));
  const docsUploaded = openDocs.filter((x) => docOkIn(x.p.key, x.t)).length;
  const missingDocs = openDocs.filter((x) => !docOkIn(x.p.key, x.t)).map((x) => x.label);

  // Renewal: approved for the chosen program in an earlier academic year means this one renews it.
  const approvedBefore = applications.filter((a) => a.status === "Approved" && a.scholarship_id === applyScholarshipId && ayStart(a.academic_year) < ayStart(academicYear)).length;
  const isRenewing = approvedBefore > 0;
  const minGrade = isRenewing ? settings.renewal_min_grade : settings.min_grade_requirement;
  const myGrade = profile?.average_grade ?? null;
  const applyIssues: string[] = [];
  const oneTimeTaken = isRenewing && isOneTime(scholarships.find((s) => s.id === applyScholarshipId)?.release_schedule);
  if (oneTimeTaken) applyIssues.push("This is a one-time grant and you have already received it, so it can't be renewed.");
  if (isRenewing && !oneTimeTaken && !settings.renewal_enabled) applyIssues.push("Scholarship renewals are not open right now.");
  if (isRenewing && !oneTimeTaken && approvedBefore > settings.max_renewals) applyIssues.push(`You have reached the maximum of ${settings.max_renewals} renewal(s).`);
  if (minGrade > 0 && myGrade == null) applyIssues.push(`Add your average grade to your profile (minimum required: ${minGrade}).`);
  else if (minGrade > 0 && myGrade != null && myGrade < minGrade) applyIssues.push(`Your average grade (${myGrade}) is below the minimum of ${minGrade}.`);

  // The office can't review an application without the basics.
  const profileGaps = profileCompleteness(profile).missing.filter((m) => ["first_name", "last_name", "phone", "school_name", "course", "year_level", "average_grade"].includes(m.key));
  if (profileGaps.length > 0) applyIssues.push(`Complete your profile first (Profile tab): ${profileGaps.map((m) => m.label).join(", ")}.`);

  // The chosen program's own rules (the database enforces the same ones).
  const applyProgram = scholarships.find((s) => s.id === applyScholarshipId);
  if (applyProgram) {
    if (!availabilityInfo(applyProgram).canApply) applyIssues.push(`${applyProgram.name}: ${availabilityInfo(applyProgram).label.toLowerCase()}.`);
    // Renewing: the renewal minimum replaces the program's own minimum (same as the database).
    const ownMin = Number(applyProgram.min_grade ?? 0);
    const pg = ownMin > 0 && isRenewing && settings.renewal_enabled ? settings.renewal_min_grade : ownMin;
    if (pg > 0 && myGrade == null && minGrade < pg) applyIssues.push(`Add your average grade to your profile (${applyProgram.name} requires ${pg}).`);
    else if (pg > 0 && myGrade != null && myGrade < pg) applyIssues.push(`${applyProgram.name} requires an average grade of ${pg}; yours is ${myGrade}.`);
    if (applyProgram.year_levels?.length && !applyProgram.year_levels.includes(profile?.year_level ?? "")) applyIssues.push(`${applyProgram.name} is open to ${applyProgram.year_levels.join(", ")} students only.`);
    const town = applyProgram.municipality?.trim();
    if (town && !sameTown(profile?.municipality, town)) {
      const mine = profile?.municipality?.trim();
      // A common mix-up: the town typed into Barangay instead of Municipality.
      const hint = sameTown(profile?.barangay, town)
        ? `You entered "${profile?.barangay?.trim()}" as your barangay; residency is checked against the Municipality field.`
        : mine ? `Your profile's municipality is "${mine}".` : "Your profile has no municipality.";
      applyIssues.push(`${applyProgram.name} is for residents of ${town} only. ${hint} If you live in ${town}, set Municipality to "${town}" in the Profile tab.`);
    }
    if (!inBarangays(profile?.barangay, applyProgram.barangays)) {
      const mine = profile?.barangay?.trim();
      applyIssues.push(`${applyProgram.name} is for residents of barangay ${applyProgram.barangays!.join(", ")} only. ${mine ? `Your profile's barangay is "${mine}".` : "Your profile has no barangay."} If that's wrong, pick your barangay in the Profile tab.`);
    }
  }

  // The chosen program's documents (the database checks the same when applying).
  const applyDocs = applyProgram ? docsForProgram(applyProgram) : [];
  const applyMissing = applyDocs.filter((t) => !docOkIn(null, t));
  // A document the office already verified counts even if it isn't a photo (same as the database).
  const applyNotPhotos = applyProgram && photosOnly(applyProgram.office) ? applyDocs.filter((t) => docOkIn(null, t) && docsOf(null).get(t)?.status !== "Verified" && !isPhoto(docsOf(null).get(t))) : [];
  // MSWDO doesn't ask for a letter of intent.
  const letterNeeded = asksLetter(applyProgram?.office);
  const applyLater = applyProgram ? [
    ...(followUpDocuments(applyProgram.office).length ? [`Upload these from the Documents tab (they can follow after you apply): ${followUpDocuments(applyProgram.office).join(", ")}${needsHousePin(applyProgram.office) ? ", and pin your house on the map" : ""}.`] : []),
    ...(needsHomeVisit(applyProgram.office) ? ["The office will schedule a home visit. You'll be notified of the date."] : []),
    ...(needsMoa(applyProgram.office) ? [`If you're approved, upload a photo of the signed ${MOA} before your first payout.`] : []),
  ] : [];

  // The program behind the current application (shown on the Application tab).
  const appProgram = scholarships.find((sc) => sc.id === currentApp?.scholarship_id);
  const appRenewal = currentApp?.is_renewal ?? false;
  const appMinGrade = Math.max(appRenewal ? settings.renewal_min_grade : settings.min_grade_requirement, Number(appProgram?.min_grade ?? 0));
  const appReqLines = appProgram ? requirementLines(appProgram, appRenewal ? settings.renewal_min_grade : settings.min_grade_requirement) : appMinGrade > 0 ? [`Average grade of at least ${appMinGrade}`] : [];
  const appAward = currentApp?.amount_approved ?? appProgram?.amount;

  // Everything awarded to this student: approved awards, using the program amount where none was set (both semesters of a semester program).
  const approvedTotal = applications
    .filter((a) => a.status === "Approved")
    .reduce((t, a) => {
      const sc = scholarships.find((x) => x.id === a.scholarship_id);
      return t + yearlyAward(Number(a.amount_approved ?? sc?.amount ?? 0), sc?.release_schedule);
    }, 0);

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
      <DashboardSkeleton variant="student" />
    );
  }

  // ── Document actions ───────────────────────────────────────────────────────
  // Files go straight to private storage; the database then re-checks type, size, ownership and the
  // lock against the stored object before it accepts the row, so these client checks are for UX only.
  // appId: the application in review it's for, or null for the application form.
  const uploadDocument = async (docType: string, picked: File, office: string | null, appId: string | null) => {
    let file = picked;
    if (settings.maintenance_mode) { toast.error(settings.maintenance_message); return; }
    if (needsPhoto(docType, office)) {
      if (!PHOTO_MIME.includes(file.type)) { toast.error(`${docType} must be a photo (JPG or PNG).`); return; }
      file = await shrinkPhoto(file, settings.max_upload_mb * 1024 * 1024);
    } else if (!DOC_MIME.includes(file.type)) { toast.error("Upload a PDF, JPG or PNG file."); return; }
    if (file.size === 0) { toast.error("That file is empty."); return; }
    if (file.size > settings.max_upload_mb * 1024 * 1024) { toast.error(`File is too large (max ${settings.max_upload_mb} MB).`); return; }

    setUploadingDoc(`${appId ?? "form"}:${docType}`);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const result = await uploadUserDocument(supabase, { userId: user.id, docType, file, applicationId: appId });
      if ("error" in result) { toast.error("Upload failed", { description: result.error }); return; }
      const row = result.row;

      // Replace: drop the older copies of this document (the database only allows it once a newer one exists).
      const older = documents.filter((d) => d.document_type === docType && d.id !== row.id && (d.application_id ?? null) === appId);
      for (const d of older) {
        const { data: gone } = await supabase.from("documents").delete().eq("id", d.id).select("id");
        const oldPath = documentPath(d);
        if (gone?.length && oldPath) await supabase.storage.from("documents").remove([oldPath]);
      }
      toast.success(`${docType} uploaded`);
      // Not loadData(): its full-page loading state would close the application form mid-application.
      refreshDocuments(user.id);
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
      refreshDocuments(userId);
    } finally {
      setRemovingDoc(false);
    }
  };

  // ── Application actions ────────────────────────────────────────────────────
  const submitApplication = async () => {
    // A ref, not applyLoading: a quick double-click fires twice before the disabled state renders.
    if (!applyScholarshipId || submittingRef.current) return;
    if (letterNeeded && !applyLetter) { toast.error("Attach a photo of your letter of intent."); return; }
    submittingRef.current = true;
    setApplyLoading(true);
    // The photo goes to storage first; the application then files it. If applying fails, it is removed again.
    let letterPath: string | null = null;
    try {
      if (applyLetter) {
        const up = await uploadLetterPhoto(supabase, userId, applyLetter.file);
        if ("error" in up) { toast.error("Could not upload your letter of intent", { description: up.error }); return; }
        letterPath = up.path;
      }
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scholarship_id: applyScholarshipId,
          letter_of_intent_path: letterPath,
          certified: applyCertified,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to submit application.");
      } else {
        letterPath = null;
        toast.success(isRenewing ? "Renewal application submitted!" : "Application submitted!");
        setApplyDialogOpen(false);
        setApplyScholarshipId(""); setApplyCertified(false); pickLetter(null);
        // The new application files the documents uploaded ahead of it.
        silentRefresh(userId); refreshDocuments(userId);
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      if (letterPath) await supabase.storage.from("documents").remove([letterPath]);
      submittingRef.current = false;
      setApplyLoading(false);
    }
  };

  /** Checks a picked letter of intent photo (shrinking a large phone photo) and shows a preview of it. */
  const preparePhoto = async (picked: File) => {
    if (!PHOTO_MIME.includes(picked.type)) { toast.error("The letter of intent must be a photo (JPG or PNG)."); return null; }
    const file = await shrinkPhoto(picked, settings.max_upload_mb * 1024 * 1024);
    if (file.size === 0) { toast.error("That photo is empty."); return null; }
    if (file.size > settings.max_upload_mb * 1024 * 1024) { toast.error(`Photo is too large (max ${settings.max_upload_mb} MB).`); return null; }
    return file;
  };
  const pickLetter = async (picked: File | null) => {
    const file = picked ? await preparePhoto(picked) : null;
    if (picked && !file) return;
    if (applyLetter) URL.revokeObjectURL(applyLetter.url);
    setApplyLetter(file ? { file, url: URL.createObjectURL(file) } : null);
  };

  // A disapproved letter is replaced from its application; the older copy is removed once the new one is filed.
  const replaceLetter = async (app: typeof applications[number], picked: File) => {
    const file = await preparePhoto(picked);
    if (!file) return;
    setReplacingLetter(true);
    try {
      const result = await uploadUserDocument(supabase, { userId, docType: LETTER_OF_INTENT, file, applicationId: app.id });
      if ("error" in result) { toast.error("Upload failed", { description: result.error }); return; }
      for (const d of documents.filter((x) => x.document_type === LETTER_OF_INTENT && x.application_id === app.id && x.id !== result.row.id)) {
        const { data: gone } = await supabase.from("documents").delete().eq("id", d.id).select("id");
        const oldPath = documentPath(d);
        if (gone?.length && oldPath) await supabase.storage.from("documents").remove([oldPath]);
      }
      toast.success("Letter of intent replaced", { description: "The office will review the new photo." });
      refreshDocuments(userId);
    } finally {
      setReplacingLetter(false);
    }
  };

  // The signed MOA, after approval, where the office asks for one. A newer photo replaces the older one.
  const uploadMoa = async (app: typeof applications[number], picked: File) => {
    const file = await preparePhoto(picked);
    if (!file) return;
    setUploadingMoa(app.id);
    try {
      const result = await uploadUserDocument(supabase, { userId, docType: MOA, file, applicationId: app.id });
      if ("error" in result) { toast.error("Upload failed", { description: result.error }); return; }
      toast.success("MOA uploaded", { description: "The office will check it before your payout." });
      refreshDocuments(userId);
    } finally {
      setUploadingMoa(null);
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

  // The student tells the office they've made the changes it asked for on an application.
  const markChangesDone = async (appId: string) => {
    setMarkingDone(appId);
    const { error } = await supabase.rpc("mark_changes_done", { _application_id: appId });
    setMarkingDone(null);
    if (error) { toast.error("Could not update", { description: error.message }); return; }
    toast.success("Thanks! The office has been told to take another look.");
    loadData();
  };

  const openAwardNotice = (a: typeof applications[number]) => {
    const name = profile ? [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" ") : "";
    const ok = printAwardNotice({
      applicationId: a.id,
      studentName: name || displayName,
      school: a.school_name ?? profile?.school_name,
      courseYear: [a.course, a.year_level].filter(Boolean).join(" · ") || null,
      program: a.scholarships?.name ?? "Scholarship",
      amount: a.amount_approved,
      academicYear: a.academic_year,
      semester: a.semester,
      approvedAt: a.approved_at ?? a.decided_at,
      isRenewal: a.is_renewal,
      office: { email: settings.contact_email, phone: settings.contact_phone, address: settings.contact_address },
    });
    if (!ok) toast.error("Allow pop-ups for this site to open your award notice.");
  };

  // ── Section: Application ───────────────────────────────────────────────────
  const openApply = (programId = "") => { setApplyScholarshipId(programId); setApplyDialogOpen(true); };
  const viewApplication = (id: string) => { setSelectedAppId(id); setViewOpen(true); };
  const withdrawPrompt = (a: typeof applications[number]) => { setSelectedAppId(a.id); setWithdrawOpen(true); };

  // Documents shown with an application: what was filed with it.
  const docsFor = (a: typeof applications[number]) => {
    const latest = new Map<string, Tables<"documents">>();
    [...documents].filter((d) => d.application_id === a.id)
      .sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))
      .forEach((d) => latest.set(d.document_type, d));
    return [...latest.values()];
  };

  const fmtVisit = (at: string) => new Date(at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

  // Does the student pass this application's program requirements? Same rules the office checks on approval.
  const requirementsChecklist = (app: typeof applications[number]) => {
    const program = scholarships.find((sc) => sc.id === app.scholarship_id);
    if (!program) return null;
    const checks = [
      ...programChecks(program, profile, {
        globalMinGrade: settings.min_grade_requirement, renewalMinGrade: settings.renewal_min_grade,
        renewalEnabled: settings.renewal_enabled, isRenewal: app.is_renewal,
      }),
      ...approvalDocsFor(program).map((t) => {
        const d = docsOf(app.id).get(t);
        return { key: `doc-${t}`, label: t, ok: d?.status === "Verified", detail: !d ? "Not uploaded" : d.status === "Pending" ? "Waiting for the office to verify" : d.status };
      }),
      ...(needsHousePin(program.office) ? [{ key: "house-pin", label: "House pinned on the map", ok: housePinned, detail: housePinned ? "Saved" : "Not yet (Documents tab)" }] : []),
      ...(needsHomeVisit(program.office) ? [{
        key: "home-visit", label: "Home visit", ok: !!app.home_visit_done_at,
        detail: app.home_visit_done_at ? "Done" : app.home_visit_at ? `Scheduled ${fmtVisit(app.home_visit_at)}` : "The office will schedule it",
      }] : []),
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
              {c.ok ? <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-700" /> : <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />}
              <span><span className="font-medium text-foreground">{c.label}</span> <span className="text-muted-foreground">· {c.detail}</span></span>
            </li>
          ))}
        </ul>
        {passing < checks.length && <p className="text-[11px] text-muted-foreground mt-2">The office can approve this application once every requirement is met.</p>}
      </div>
    );
  };

  // ── One document card, for an application in review (Documents tab) or the application form (appId null) ──
  // The photo rule and notes come from the program it's for.
  const docCard = (docType: string, program: { key: string; name: string; office: string | null; appId: string | null }) => {
      const uploaded = docsOf(program.appId).get(docType);
      const busy = uploadingDoc === `${program.appId ?? "form"}:${docType}`;
      const photo = needsPhoto(docType, program.office);
      const followUp = followUpDocuments(program.office).includes(docType);
      const note = documentNote(program.office, docType);
      // Uploaded as a file where a photo is needed.
      const notPhoto = photo && !!uploaded && uploaded.status !== "Verified" && !isPhoto(uploaded);
      const canRemove = !!uploaded && (!uploaded.application_id || uploaded.status === "Disapproved");
      const tone = !uploaded ? "" : uploaded.status === "Disapproved" ? "border-red-200" : uploaded.status === "Verified" ? "border-emerald-200" : "border-amber-100";
      return (
        <Panel key={`${program.key}-${docType}`} className={`p-4 ${tone}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                !uploaded ? "bg-muted" : uploaded.status === "Disapproved" ? "bg-red-100" : uploaded.status === "Verified" ? "bg-emerald-100" : "bg-amber-100"}`}>
                <FileText className={`h-5 w-5 ${
                  !uploaded ? "text-muted-foreground" : uploaded.status === "Disapproved" ? "text-red-600" : uploaded.status === "Verified" ? "text-emerald-700" : "text-amber-700"}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{docType}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {uploaded ? [uploaded.file_name, fmtSize(uploaded.file_size)].filter(Boolean).join(" · ") : photo ? "Not uploaded · photo (JPG or PNG)" : "Not uploaded"}
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
                <Input type="file" className="hidden" accept={photo ? "image/jpeg,image/png" : ".pdf,.jpg,.jpeg,.png"} disabled={busy}
                  onChange={async (e) => {
                    const input = e.target;
                    const file = input.files?.[0];
                    input.value = ""; // so picking the same file again still fires onChange
                    if (file) await uploadDocument(docType, file, program.office, program.appId);
                  }} />
                <span className={`inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 sm:py-1.5 text-xs font-semibold transition-colors ${
                  busy ? "opacity-50 pointer-events-none border-border text-muted-foreground" :
                  uploaded && uploaded.status !== "Disapproved" ? "border-primary/20 text-primary hover:bg-accent" : "border-primary bg-primary text-white hover:bg-primary"
                }`}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  {busy ? "Uploading…" : uploaded ? (uploaded.status === "Disapproved" ? "Upload new" : "Replace") : "Upload"}
                </span>
              </Label>
            </div>
          </div>
          {(followUp || note || notPhoto) && (
            <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              {followUp && <p>Can be uploaded after you apply (needed before approval).</p>}
              {note && <p className="font-medium text-foreground">{note}</p>}
              {notPhoto && <p className="font-medium text-red-700">This program needs a photo (JPG or PNG). Upload a photo to replace this file.</p>}
            </div>
          )}
          {uploaded && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <DocStatusBadge status={uploaded.status} />
              <span className="text-[11px] text-muted-foreground">Uploaded {new Date(uploaded.uploaded_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
          )}
          {docType === HOUSE_PHOTO && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${housePinned ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <p className="font-semibold flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{housePinned ? "House pinned on the map" : "Pin your house on the map too"}</p>
              {housePinned && profile?.home_landmark && <p className="mt-0.5">Landmark: {profile.home_landmark}</p>}
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs bg-white" onClick={() => setHouseOpen(true)}>{housePinned ? "Change pin" : "Pin location"}</Button>
                {housePinned && (
                  <a className="inline-flex h-8 items-center rounded-lg border bg-white px-2.5 font-medium hover:bg-muted" target="_blank" rel="noreferrer"
                    href={googleMapsLink({ lat: profile!.home_lat!, lng: profile!.home_lng! })}>Open in Google Maps</a>
                )}
              </div>
            </div>
          )}
          {uploaded?.status === "Disapproved" && uploaded.review_note && (
            <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <span className="font-semibold">Reason: </span>{uploaded.review_note}
            </p>
          )}
        </Panel>
      );
  };

  const Application = () => (
    <div className="space-y-5">
      {locked && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Lock className="h-4 w-4 text-amber-700 shrink-0" />
          <p className="text-sm text-amber-800">
            You are approved for <strong>{approvedApps.map((a) => a.scholarships?.name ?? "a scholarship").join(", ")}</strong>. Your school details are now locked, but you can still apply to other open programs. Each program reviews you against its own requirements.
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
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" />
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
            {a.changes_requested && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> The office needs changes from you
                  {a.changes_requested_at && <span className="font-normal text-xs text-red-700">· {formatDate(a.changes_requested_at)}</span>}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{a.changes_requested}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" className="rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs" disabled={markingDone === a.id}
                    onClick={() => markChangesDone(a.id)}>
                    {markingDone === a.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}I&apos;ve made the changes
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl text-xs border-red-200 text-red-700 hover:bg-red-100" onClick={() => setActive("documents")}>
                    <Upload className="mr-1 h-3 w-3" /> Go to Documents
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl text-xs border-red-200 text-red-700 hover:bg-red-100" onClick={() => setActive("help")}>
                    <HelpCircle className="mr-1 h-3 w-3" /> Ask the office
                  </Button>
                </div>
              </div>
            )}
            <ApplicationTimeline app={a} payments={payments} />
            {(a.status === "Pending" || a.status === "Waitlisted") && needsHomeVisit(a.scholarships?.office) && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${a.home_visit_done_at ? "border-emerald-200 bg-emerald-50 text-emerald-800" : a.home_visit_at ? "border-primary/20 bg-accent text-foreground" : "border-border bg-muted/40 text-muted-foreground"}`}>
                <p className="font-semibold flex items-center gap-1.5"><Home className="h-4 w-4 shrink-0" />
                  {a.home_visit_done_at ? "Home visit done" : a.home_visit_at ? `Home visit: ${fmtVisit(a.home_visit_at)}` : "Home visit not scheduled yet"}
                </p>
                <p className="mt-0.5 text-xs">
                  {a.home_visit_done_at ? "Thank you. The office has visited your home." : a.home_visit_at ? (a.home_visit_note || "Please be home at that time.") : "The office will set a date and notify you."}
                </p>
              </div>
            )}
            {(a.status === "Pending" || a.status === "Waitlisted") && requirementsChecklist(a)}
            {a.status === "Approved" && needsMoa(a.scholarships?.office) && (() => {
              const moa = documents.filter((d) => d.document_type === MOA && d.application_id === a.id)
                .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0];
              const busy = uploadingMoa === a.id;
              const tone = moa?.status === "Verified" ? "border-emerald-200 bg-emerald-50" : moa?.status === "Disapproved" || !moa ? "border-amber-200 bg-amber-50" : "border-border bg-muted/40";
              return (
                <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
                  <p className="font-semibold text-foreground">Signed MOA agreement letter</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {!moa ? "Needed before your first payout. Sign the MOA and upload a clear photo of it (JPG or PNG)."
                      : moa.status === "Verified" ? "Verified by the office."
                      : moa.status === "Disapproved" ? `The office asked for a new photo.${moa.review_note ? ` Reason: ${moa.review_note}` : ""}`
                      : "Uploaded. Waiting for the office to check it."}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {moa && <DocStatusBadge status={moa.status} />}
                    {moa && <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => openDocument(moa)}><Eye className="mr-1 h-3 w-3" />View</Button>}
                    {moa?.status !== "Verified" && (
                      <label className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${busy ? "opacity-60" : "cursor-pointer border-primary bg-primary text-white"}`}>
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}{moa ? "Upload new photo" : "Upload photo"}
                        <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy}
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadMoa(a, f); }} />
                      </label>
                    )}
                  </div>
                </div>
              );
            })()}
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
              {a.status === "Approved" && (
                <Button size="sm" variant="outline" className="text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-xl" onClick={() => openAwardNotice(a)}>
                  <Printer className="mr-1 h-3 w-3" /> Award notice
                </Button>
              )}
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
                <p className="text-xl font-bold text-black">{Number(appAward) > 0 ? `${peso(appAward)}${appProgram?.release_schedule === "semester" ? " per semester" : ""}` : "To be announced"}</p>
              </div>
              <div className="rounded-xl bg-muted border border-muted p-4">
                <p className="text-xs text-muted-foreground mb-1">Required grade</p>
                <p className="text-xl font-bold text-black">{appMinGrade > 0 ? `${appMinGrade} and above` : "No minimum"}</p>
              </div>
              {appProgram && (
                <>
                  <div className="rounded-xl bg-muted border border-muted p-4">
                    <p className="text-xs text-muted-foreground mb-1">Application deadline</p>
                    <p className="text-sm font-semibold text-black">{appProgram.deadline ? `${formatDate(appProgram.deadline)} (${deadlineLabel(appProgram.deadline)})` : "No closing date"}</p>
                  </div>
                  <div className="rounded-xl bg-muted border border-muted p-4">
                    <p className="text-xs text-muted-foreground mb-1">Slots</p>
                    <p className="text-sm font-semibold text-black">{slotsLabel(appProgram)}</p>
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
                  `Keep these documents on file with this application: ${approvalDocsFor(appProgram ?? currentApp?.scholarships ?? undefined).join(", ") || "none required"}${appProgram && photosOnly(appProgram.office) ? " (photos, JPG or PNG)" : ""}.`,
                  ...(needsHomeVisit(appProgram?.office) ? ["The office visits your home before deciding."] : []),
                  ...(needsMoa(appProgram?.office) ? [`A signed ${MOA} is needed before your first payout.`] : []),
                  ...[LETTER_OF_INTENT, ...approvalDocsFor(appProgram)].flatMap((t) => { const n = documentNote(appProgram?.office, t); return n ? [`${t}: ${n.replace(/^Also s/, "S")}`] : []; }),
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
        <ApplicationHistory applications={applications} onView={viewApplication} onContact={() => setActive("help")} />
      </Panel>

      {/* View */}
      <AppDialog open={viewOpen && !!selectedApp} onOpenChange={setViewOpen} size="lg" className="rounded-2xl"
        title={selectedApp?.scholarships?.name || "Application details"}
        description={selectedApp && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={selectedApp.status} />
            <span>{selectedApp.is_renewal ? "Renewal" : "New application"} · submitted {new Date(selectedApp.created_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}</span>
          </div>
        )}
        footer={<>
          <Button variant="outline" className="rounded-xl" onClick={() => setViewOpen(false)}>Close</Button>
          {selectedApp?.status === "Approved" && (
            <Button className="rounded-xl" onClick={() => openAwardNotice(selectedApp)}>
              <Printer className="mr-2 h-4 w-4" /> Print award notice
            </Button>
          )}
        </>}>
        {selectedApp && (
          <>
            <DisapprovalReason app={selectedApp} onContact={() => { setViewOpen(false); setActive("help"); }} />
            <DetailGrid className="rounded-xl">
              <Detail label="School">{selectedApp.school_name || "—"}</Detail>
              <Detail label="Course · Year">{[selectedApp.course, selectedApp.year_level].filter(Boolean).join(" · ") || "—"}</Detail>
              <Detail label="Average grade">{selectedApp.average_grade ?? "—"}</Detail>
              <Detail label="Amount approved">{peso(selectedApp.amount_approved)}</Detail>
            </DetailGrid>
            {selectedApp.notes && selectedApp.status !== "Disapproved" && (
              <DialogSection title="Remarks from the scholarship office">
                <p className="text-sm whitespace-pre-wrap rounded-xl bg-muted/50 px-3 py-2">{selectedApp.notes}</p>
              </DialogSection>
            )}
            <DialogSection title="Documents">
              {docsFor(selectedApp).length === 0 ? <p className="text-sm text-muted-foreground">None on file.</p> : (
                <ul className="space-y-1.5">
                  {docsFor(selectedApp).map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={() => openDocument(d)}
                        className="w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted text-left cursor-pointer">
                        <span className="min-w-0 truncate"><span className="font-medium">{d.document_type}</span> · {d.file_name}</span>
                        <span className="flex items-center gap-2 shrink-0"><DocStatusBadge status={d.status} /><Eye className="h-3.5 w-3.5 text-muted-foreground" /></span>
                      </button>
                      {d.document_type === LETTER_OF_INTENT && d.status === "Disapproved" && (selectedApp.status === "Pending" || selectedApp.status === "Waitlisted") && (
                        <div className="mt-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          <p>{d.review_note ? `Reason: ${d.review_note}` : "The office asked for a new photo of your letter of intent."}</p>
                          <label className={`mt-1.5 inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-2.5 py-1 font-medium ${replacingLetter ? "opacity-60" : "cursor-pointer hover:bg-red-100"}`}>
                            {replacingLetter ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Replace photo
                            <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={replacingLetter}
                              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replaceLetter(selectedApp, f); }} />
                          </label>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </DialogSection>
            {selectedApp.certified_at && (
              <p className="text-xs text-muted-foreground">Certified true and correct on {new Date(selectedApp.certified_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}.</p>
            )}
          </>
        )}
      </AppDialog>

      {/* Withdraw */}
      <AppDialog open={withdrawOpen} onOpenChange={(o) => { if (!withdrawing) setWithdrawOpen(o); }} size="sm" className="rounded-2xl"
        title="Withdraw this application?"
        footer={<>
          <Button variant="outline" className="rounded-xl" disabled={withdrawing} onClick={() => setWithdrawOpen(false)}>Keep application</Button>
          <Button variant="destructive" className="rounded-xl" disabled={withdrawing} onClick={withdrawApplication}>
            {withdrawing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Withdraw
          </Button>
        </>}>
        <p className="text-sm text-muted-foreground">
          Your application for <span className="font-semibold text-foreground">{selectedApp?.scholarships?.name}</span> will be withdrawn. Your other applications and your uploaded documents are kept, and you can apply to this program again while it is open.
        </p>
      </AppDialog>

      {/* Apply */}
      <AppDialog open={applyDialogOpen} onOpenChange={(o) => { if (!applyLoading) { setApplyDialogOpen(o); if (!o) pickLetter(null); } }} size="md" className="rounded-2xl"
        title={isRenewing ? "Renew Scholarship" : "Apply for Scholarship"}
        description={<>You can apply to every open program. <strong className="text-foreground">Each program decides on its own</strong>: you are approved only if you meet that program&apos;s requirements{minGrade > 0 && <>, including an average grade of at least <strong className="text-foreground">{minGrade}</strong></>}.</>}
        footer={<>
          <Button variant="outline" className="rounded-xl" disabled={applyLoading} onClick={() => { setApplyDialogOpen(false); pickLetter(null); }}>Cancel</Button>
          <Button
            disabled={!canApplyMore || !applyScholarshipId || appliedProgramIds.has(applyScholarshipId) || applyLoading || applyIssues.length > 0 || applyMissing.length > 0 || applyNotPhotos.length > 0 || (letterNeeded && !applyLetter) || !applyCertified}
            className="rounded-xl"
            onClick={submitApplication}>
            {applyLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isRenewing ? "Submit Renewal" : "Submit Application"}
          </Button>
        </>}>
        {isRenewing && (
          <div className="flex items-start gap-3 bg-accent border border-primary/20 rounded-xl px-4 py-3 text-sm text-foreground">
            <GraduationCap className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>This is a <strong>renewal</strong> (renewal {Math.min(approvedBefore, settings.max_renewals)} of {settings.max_renewals} allowed). You were approved for this program before, so the renewal grade requirement applies{settings.renewal_min_grade > 0 ? <> ({settings.renewal_min_grade})</> : null}.</span>
          </div>
        )}
        {applyIssues.length > 0 && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">{applyIssues.map((m) => <p key={m}>{m}</p>)}</div>
          </div>
        )}
        <DialogField label="Scholarship Program *" htmlFor="apply-program">
          <Select value={applyScholarshipId} onValueChange={setApplyScholarshipId}>
            <SelectTrigger id="apply-program" className="rounded-xl border-border"><SelectValue placeholder="Select program" /></SelectTrigger>
            <SelectContent>
              {scholarships.filter((s) => (availabilityInfo(s).canApply && !appliedProgramIds.has(s.id)) || s.id === applyScholarshipId).map((s) => (
                <SelectItem key={s.id} value={s.id} disabled={!availabilityInfo(s).canApply || appliedProgramIds.has(s.id)}>
                  {s.name}{Number(s.amount) > 0 ? ` · ${peso(s.amount)}` : ""}{appliedProgramIds.has(s.id) ? " (already applied)" : !availabilityInfo(s).canApply ? ` (${availabilityInfo(s).label})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DialogField>
        {applyProgram && applyDocs.length > 0 && (
          <DialogSection title={`Documents for ${applyProgram.name}`}>
            <p className="text-xs text-muted-foreground mb-2">
              {applyMissing.length > 0 || applyNotPhotos.length > 0
                ? `Upload ${photosOnly(applyProgram.office) ? "a photo of " : ""}each document to submit. Each application has its own documents, so upload them here even if another application has them.`
                : "All set. These are on file for this application."}
            </p>
            <div className="grid grid-cols-1 gap-2">{applyDocs.map((t) => docCard(t, { key: "apply", name: applyProgram.name, office: applyProgram.office ?? null, appId: null }))}</div>
          </DialogSection>
        )}
        {applyLater.length > 0 && (
          <div className="rounded-xl border border-primary/20 bg-accent px-4 py-3 text-sm text-foreground">
            <p className="font-semibold mb-1">After you apply</p>
            <ul className="list-disc pl-4 space-y-0.5">{applyLater.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {letterNeeded && (
        <DialogField label="Letter of intent (photo) *" htmlFor="apply-letter"
          hint={`A letter to this program saying why you are applying. Take a clear photo of the whole page, or choose one (JPG or PNG). Each application needs its own.${documentNote(applyProgram?.office, LETTER_OF_INTENT) ? ` ${documentNote(applyProgram?.office, LETTER_OF_INTENT)}` : ""}`}>
          {applyLetter ? (
            <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL) */}
              <img src={applyLetter.url} alt="Your letter of intent" className="h-16 w-12 shrink-0 rounded-md border object-cover" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">{applyLetter.file.name}</p>
                <p className="text-xs text-muted-foreground">{applyLetter.file.size < 1048576 ? `${Math.max(1, Math.round(applyLetter.file.size / 1024))} KB` : `${(applyLetter.file.size / 1048576).toFixed(1)} MB`}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" className="rounded-lg" disabled={applyLoading} onClick={() => pickLetter(null)}>Remove</Button>
            </div>
          ) : (
            <label htmlFor="apply-letter" className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground hover:bg-muted/50">
              <Upload className="h-4 w-4" />Take or choose a photo
            </label>
          )}
          <input id="apply-letter" type="file" accept="image/jpeg,image/png" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickLetter(f); }} />
        </DialogField>
        )}
        <label className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-foreground cursor-pointer">
          <Checkbox checked={applyCertified} onCheckedChange={(v) => setApplyCertified(v === true)} className="mt-0.5" />
          <span>I certify that the information and documents I have provided are true and correct.</span>
        </label>
      </AppDialog>
    </div>
  );

  // ── Section: Documents ─────────────────────────────────────────────────────
  const Documents = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Each application has its own documents. Upload them under the application they&apos;re for; once an application is decided, its documents can no longer change.</p>


      {docPrograms.length === 0 ? (
        <Panel className="p-6 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold text-foreground">Your documents show up here once you apply</p>
          <p className="mt-1 text-sm text-muted-foreground">Each program asks for its own documents. When you apply, you upload the ones needed to apply in the application form; anything the program needs later is listed here.</p>
          <Button className="mt-4 rounded-xl" onClick={() => setActive("application")}><FileText className="mr-2 h-4 w-4" />Apply for a scholarship</Button>
        </Panel>
      ) : docPrograms.map((program) => {
        const docs = approvalDocsFor(program);
        const done = docs.filter((t) => docOkIn(program.key, t)).length;
        const a = program.app;
        const filed = program.editable ? [] : docsFor(a);
        return (
          <Panel key={program.key} className={`p-4 sm:p-5 space-y-3 ${program.editable ? "" : "bg-muted/20"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{program.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[isOffice(program.office) ? OFFICE_LABEL[program.office] : null, a.academic_year, `submitted ${formatDate(a.created_at)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={a.status} />
                {program.editable && <span className="text-sm font-bold text-primary">{done}/{docs.length}</span>}
              </div>
            </div>
            {program.editable ? (
              <>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${docs.length ? (done / docs.length) * 100 : 100}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{photosOnly(program.office) ? "Photos (JPG or PNG)" : "PDF, JPG or PNG"}, up to {settings.max_upload_mb} MB each.</p>
                {docs.length === 0 ? <p className="text-sm text-muted-foreground">This program doesn&apos;t ask for documents.</p> : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{docs.map((t) => docCard(t, { ...program, appId: program.key }))}</div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {a.status === "Withdrawn" ? "Withdrawn." : a.status === "Approved" ? "Approved." : a.status === "Disapproved" ? "Decided." : "From an earlier academic year."} These are the documents filed with it{a.status === "Approved" ? ", and they can no longer change" : "; nothing more is needed"}.
                </p>
                {filed.length === 0 ? <p className="text-sm text-muted-foreground">No documents on file.</p> : (
                  <ul className="space-y-1.5">
                    {filed.map((d) => (
                      <li key={d.id}>
                        <button type="button" onClick={() => openDocument(d)}
                          className="w-full flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-sm hover:bg-muted text-left cursor-pointer">
                          <span className="min-w-0 truncate"><span className="font-medium">{d.document_type}</span> · {d.file_name}</span>
                          <span className="flex items-center gap-2 shrink-0"><DocStatusBadge status={d.status} /><Eye className="h-3.5 w-3.5 text-muted-foreground" /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Panel>
        );
      })}

      <HouseLocationDialog open={houseOpen} onOpenChange={setHouseOpen} userId={userId} saved={profile} onSaved={() => refreshProfile(userId)} />

      <AppDialog open={!!removeDoc} onOpenChange={(o) => { if (!o && !removingDoc) setRemoveDoc(null); }} size="sm" className="rounded-2xl"
        title="Remove this document?"
        footer={<>
          <Button variant="outline" className="rounded-xl" disabled={removingDoc} onClick={() => setRemoveDoc(null)}>Keep it</Button>
          <Button variant="destructive" className="rounded-xl" disabled={removingDoc} onClick={removeDocument}>
            {removingDoc && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Remove
          </Button>
        </>}>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{removeDoc?.document_type}</span> ({removeDoc?.file_name}) will be deleted. You will need to upload it again before you can apply.
        </p>
      </AppDialog>
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
          applyBlocked={applyBlocked} approvedTotal={approvedTotal} locked={locked} isDisbursed={isDisbursed} academicYear={academicYear}
          docStatus={{
            uploaded: docsUploaded, required: openDocs.length, missing: missingDocs,
            disapproved: openDocs.filter((x) => docsOf(x.p.key).get(x.t)?.status === "Disapproved").map((x) => ({ type: x.label, note: docsOf(x.p.key).get(x.t)?.review_note ?? null })),
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
        <ProfileSection profile={profile} userId={userId} userEmail={userEmail} locked={locked}
          gradeUpdates={gradeUpdates} onChanged={() => refreshProfile(userId)} onContact={() => setActive("help")} />
      );
      case "settings":      return SettingsView(); // called, not rendered: its children keep their state
      case "help":          return <HelpSection name={displayName} email={userEmail} />;
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
            <p className="text-sm font-display font-bold text-sidebar-foreground truncate">San Jose</p>
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
