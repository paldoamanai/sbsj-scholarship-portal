"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel, SectionTitle } from "@/components/student/ui";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { emailChangeSchema, passwordSchema } from "@/validations/profile";
import type { Tables } from "@/integrations/supabase/types";

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive mt-1">{error}</p> : hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}

const inputCls = "rounded-xl border-border focus:border-primary focus:ring-primary/20";

/** Sign-in details (email, password) and the student's data and privacy options. Lives on the Settings tab. */
export default function AccountSettings({ userId, userEmail, profile, dataRequests, onChanged }: {
  userId: string;
  userEmail: string;
  profile: Tables<"profiles"> | null;
  dataRequests: Tables<"data_requests">[];
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);

  // ── account: email + password ──
  const [newEmail, setNewEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const changeEmail = async () => {
    const parsed = emailChangeSchema.safeParse({ email: newEmail });
    if (!parsed.success) { setEmailErr(parsed.error.issues[0]?.message ?? "Enter a valid email"); return; }
    if (parsed.data.email === userEmail.toLowerCase()) { setEmailErr("That is already your email"); return; }
    setEmailErr("");
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email: parsed.data.email });
    setEmailBusy(false);
    if (error) { setEmailErr(error.message); return; }
    toast.success("Check your inbox", { description: "We sent a confirmation link. Your email changes once you confirm it (you may need to confirm from both the old and new address)." });
    setNewEmail("");
  };

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwBusy, setPwBusy] = useState(false);
  const changePassword = async () => {
    const parsed = passwordSchema.safeParse(pw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { const k = String(i.path[0]); if (!errs[k]) errs[k] = i.message; });
      setPwErrors(errs);
      return;
    }
    setPwErrors({});
    setPwBusy(true);
    // Verify the current password before allowing a change.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: pw.current });
    if (verifyErr) { setPwBusy(false); setPwErrors({ current: "Current password is incorrect" }); return; }
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setPwBusy(false);
    if (error) { setPwErrors({ next: error.message }); return; }
    toast.success("Password updated");
    setPw({ current: "", next: "", confirm: "" });
  };

  // ── privacy: export + deletion request ──
  const [exporting, setExporting] = useState(false);
  const exportData = async () => {
    setExporting(true);
    try {
      const tables = ["applications", "documents", "payments", "payment_issues", "grade_updates", "notifications", "data_requests"] as const;
      const results = await Promise.all(tables.map((t) => supabase.from(t).select("*").eq("user_id", userId)));
      const data: Record<string, unknown> = { exported_at: new Date().toISOString(), profile, email: userEmail };
      tables.forEach((t, i) => { data[t] = results[i].data ?? []; });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const pendingDeletion = dataRequests.find((r) => r.kind === "deletion" && r.status === "Pending");
  const [delOpen, setDelOpen] = useState(false);
  const [delReason, setDelReason] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const requestDeletion = async () => {
    setDelBusy(true);
    const { error } = await supabase.rpc("request_account_deletion", { _reason: delReason.trim() || null });
    setDelBusy(false);
    if (error) { toast.error("Could not send the request", { description: error.message }); return; }
    toast.success("Request sent. The office will respond here.");
    setDelOpen(false); setDelReason("");
    onChanged();
  };

  return (
    <div className="space-y-5">
      {/* Account */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel>
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Change Email</SectionTitle></div>
          <div className="p-4 sm:p-6 space-y-3 max-w-md">
            <Field label="New email address" error={emailErr}>
              <Input type="email" className={inputCls} value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setEmailErr(""); }} placeholder="you@example.com" />
            </Field>
            <Button className="bg-primary hover:bg-primary text-white rounded-xl" disabled={emailBusy || !newEmail.trim()} onClick={changeEmail}>
              {emailBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send confirmation
            </Button>
            <p className="text-xs text-muted-foreground">Your email stays the same until you confirm the link we send.</p>
          </div>
        </Panel>

        <Panel>
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Change Password</SectionTitle></div>
          <div className="p-4 sm:p-6 space-y-3 max-w-md">
            <Field label="Current password" error={pwErrors.current}><Input type="password" autoComplete="current-password" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" error={pwErrors.next} hint="At least 8 characters with an uppercase letter, a lowercase letter and a number."><Input type="password" autoComplete="new-password" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirm new password" error={pwErrors.confirm}><Input type="password" autoComplete="new-password" className={inputCls} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <Button className="bg-primary hover:bg-primary text-white rounded-xl" disabled={pwBusy} onClick={changePassword}>
              {pwBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update password
            </Button>
          </div>
        </Panel>
      </div>

      {/* Privacy */}
      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Your Data &amp; Privacy</SectionTitle></div>
        <div className="p-4 sm:p-6 space-y-4">
          <p className="text-sm text-muted-foreground">You can download a copy of the information we hold about you, or ask the office to delete your account and data.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-xl" disabled={exporting} onClick={exportData}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download my data
            </Button>
            <Button variant="outline" className="rounded-xl border-red-200 text-red-600 hover:bg-red-50" disabled={!!pendingDeletion} onClick={() => setDelOpen(true)}>
              Request account deletion
            </Button>
          </div>
          {dataRequests.map((r) => (
            <div key={r.id} className={`rounded-lg border px-3 py-2 text-xs ${r.status === "Pending" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-muted bg-muted/40 text-muted-foreground"}`}>
              <p className="font-semibold">Deletion request · {r.status === "Pending" ? "waiting for the office" : `${r.status.toLowerCase()} ${formatDate(r.handled_at)}`} · sent {formatDate(r.created_at)}</p>
              {r.response && <p className="mt-1 whitespace-pre-wrap text-foreground"><span className="font-semibold">Office: </span>{r.response}</p>}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Records the office must keep, such as disbursed payments, may be retained as the law requires.</p>
        </div>
      </Panel>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-display">Request account deletion</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The office will review your request and reply here. Deleting your account removes your profile, applications and documents, and can&apos;t be undone.</p>
          <div>
            <Label className="text-sm font-medium mb-1.5 block">Reason (optional)</Label>
            <Textarea rows={3} maxLength={1000} className="rounded-xl" value={delReason} onChange={(e) => setDelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setDelOpen(false)}>Cancel</Button>
            <Button className="rounded-xl bg-red-600 hover:bg-red-700 text-white" disabled={delBusy} onClick={requestDeletion}>
              {delBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
