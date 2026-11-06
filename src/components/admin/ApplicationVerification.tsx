"use client";

// On an application: confirmations with whoever issued its documents (registrar, barangay, PSA, the
// originals), its random audit if it was picked, and barring the student from applying (migration 087).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReasonDialog } from "@/components/AppDialog";
import { Trash2, UserX } from "@/components/icons";
import { cn } from "@/lib/utils";

export const SOURCE_KINDS: Record<string, string> = {
  registrar: "School registrar (enrollment, grades)",
  barangay: "Barangay (indigency, residency)",
  psa: "PSA (birth certificate)",
  original: "Originals checked at the office",
  other: "Other",
};
const RESULT_TONE: Record<string, string> = {
  Confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Not confirmed": "border-red-200 bg-red-50 text-red-700",
  Waiting: "border-amber-200 bg-amber-50 text-amber-800",
  Open: "border-amber-200 bg-amber-50 text-amber-800",
  Passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Failed: "border-red-200 bg-red-50 text-red-700",
};
const when = (d: string) => new Date(d).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default function ApplicationVerification({
  applicationId, userId, studentName, canReview, canManage, staffName, onBarredChange,
}: {
  applicationId: string; userId: string; studentName: string; canReview: boolean; canManage: boolean;
  staffName: (id: string | null) => string; onBarredChange?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [checks, setChecks] = useState<Tables<"application_source_checks">[]>([]);
  const [audit, setAudit] = useState<Tables<"document_audits"> | null>(null);
  const [barred, setBarred] = useState<Tables<"barred_students"> | null>(null);
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState("registrar");
  const [result, setResult] = useState("Confirmed");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [auditNote, setAuditNote] = useState("");
  const [barOpen, setBarOpen] = useState(false);
  const [barReason, setBarReason] = useState("");

  const load = async () => {
    const [c, a, b] = await Promise.all([
      supabase.from("application_source_checks").select("*").eq("application_id", applicationId).order("checked_at", { ascending: false }),
      supabase.from("document_audits").select("*").eq("application_id", applicationId).order("selected_at", { ascending: false }).limit(1),
      supabase.from("barred_students").select("*").eq("user_id", userId).maybeSingle(),
    ]);
    setChecks(c.data ?? []); setAudit(a.data?.[0] ?? null); setBarred(b.data ?? null);
    setReady(!c.error);
  };
  useEffect(() => {
    setReady(false); load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, userId]);

  if (!ready) return null; // migration 087 not run yet, or still loading

  const addCheck = async () => {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("application_source_checks").insert({
      application_id: applicationId, kind, result, contact: contact.trim() || null, note: note.trim() || null, checked_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setContact(""); setNote("");
    toast.success("Confirmation recorded");
    load();
  };
  const removeCheck = async (id: string) => {
    const { error } = await supabase.from("application_source_checks").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };
  const resolveAudit = async (status: "Passed" | "Failed" | "Open") => {
    if (!audit) return;
    setBusy(true);
    const { error } = await supabase.rpc("resolve_document_audit", { _id: audit.id, _status: status, _note: auditNote.trim() || null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "Open" ? "Audit reopened" : `Audit marked ${status.toLowerCase()}`);
    setAuditNote("");
    load();
  };
  const setBar = async (on: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("set_student_barred", { _user: userId, _barred: on, _reason: on ? barReason.trim() : null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(on ? `${studentName} can no longer apply` : `${studentName} can apply again`);
    setBarOpen(false); setBarReason("");
    load(); onBarredChange?.();
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Verification with issuers</h3>
        {barred && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700" title={barred.reason}>
            Barred from applying
          </span>
        )}
      </div>

      {audit && (
        <div className={cn("rounded-lg border px-3 py-2 text-xs", RESULT_TONE[audit.status])}>
          <p className="font-semibold">Random audit {audit.academic_year}: {audit.status}</p>
          <p>Picked {when(audit.selected_at)}. {audit.status === "Open" ? "Check every original and confirm with the issuers, then pass or fail it." : audit.note ?? ""}</p>
          {canReview && audit.status === "Open" && (
            <div className="mt-2 space-y-2">
              <Input value={auditNote} maxLength={1000} onChange={(e) => setAuditNote(e.target.value)} placeholder="What was checked, or what was wrong (needed to fail)" className="h-8 bg-white text-xs" />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 bg-white text-xs" disabled={busy} onClick={() => resolveAudit("Passed")}>Passed</Button>
                <Button size="sm" variant="outline" className="h-7 bg-white text-xs text-destructive" disabled={busy || !auditNote.trim()} onClick={() => resolveAudit("Failed")}>Failed</Button>
              </div>
            </div>
          )}
          {canReview && audit.status !== "Open" && (
            <Button size="sm" variant="ghost" className="mt-1 h-6 px-1 text-[11px]" disabled={busy} onClick={() => resolveAudit("Open")}>Reopen</Button>
          )}
        </div>
      )}

      {checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No confirmations yet. For flagged documents, confirm with the school registrar or the barangay that issued them, or check the original.</p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 font-semibold", RESULT_TONE[c.result])}>{c.result}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{SOURCE_KINDS[c.kind] ?? c.kind}</span>
                {c.contact && <> · {c.contact}</>}
                {c.note && <span className="block text-muted-foreground">{c.note}</span>}
                <span className="block text-muted-foreground">{staffName(c.checked_by)} · {when(c.checked_at)}</span>
              </span>
              {canReview && (
                <button type="button" aria-label="Remove" className="text-muted-foreground hover:text-destructive" onClick={() => removeCheck(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canReview && (
        <div className="space-y-2 border-t pt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(SOURCE_KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{["Confirmed", "Not confirmed", "Waiting"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} placeholder="Who confirmed (name, office, phone)" className="h-9 text-xs" />
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="text-xs" />
          <Button size="sm" variant="outline" disabled={busy} onClick={addCheck}>Record confirmation</Button>
        </div>
      )}

      {canManage && (
        <div className="border-t pt-3">
          {barred ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Barred {when(barred.barred_at)}: {barred.reason}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setBar(false)}>Allow applying again</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setBarOpen(true)}>
              <UserX className="mr-1 h-3.5 w-3.5" />Bar from applying (fake documents)
            </Button>
          )}
        </div>
      )}

      <ReasonDialog open={barOpen} onClose={() => setBarOpen(false)} title={`Bar ${studentName} from applying?`}
        description="They won't be able to submit new applications. Their current applications aren't changed: disapprove or cancel them separately. This is recorded in the audit log."
        value={barReason} onChange={setBarReason} maxLength={1000} placeholder="What was found, e.g. altered grades confirmed with the registrar"
        confirmLabel="Bar from applying" busy={busy} onConfirm={() => setBar(true)} />
    </div>
  );
}
