"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Json, Tables } from "@/integrations/supabase/types";
import {
  PAYMENT_METHODS, SEMESTERS, SETTING_DEFAULTS, parseSettings, validateSetting,
  type AppSettings, type PaymentMethod, type SettingKey,
} from "@/lib/settings";

interface Props {
  rows: Tables<"system_settings">[];
  auditLogs: Tables<"audit_logs">[];
  /** Persists the given settings. Resolves true on success. */
  onSave: (changes: Partial<AppSettings>, action?: "update_setting" | "reset_settings") => Promise<boolean>;
}

const LABELS: Record<SettingKey, string> = {
  academic_year: "Academic year", current_semester: "Semester", min_grade_requirement: "Minimum grade",
  max_scholarships_per_student: "Max applications per year", payment_methods: "Payment methods",
  email_notifications: "Email notifications", applications_open: "Applications open",
  application_open_date: "Opening date", application_close_date: "Closing date",
  maintenance_mode: "Maintenance mode", maintenance_message: "Maintenance message",
  max_upload_mb: "Max upload size", program_name: "Program name", contact_email: "Contact email",
  contact_phone: "Contact phone", contact_address: "Contact address", office_hours: "Office hours",
};

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "On" : "Off") : v === "" || v == null ? "—" : String(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function SettingsPanel({ rows, auditLogs, onSave }: Props) {
  const saved = useMemo(() => parseSettings(rows), [rows]);
  const [draft, setDraft] = useState<AppSettings>(saved);
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Re-sync whenever the saved values change (after a save, reset or reload).
  useEffect(() => { setDraft(saved); setErrors({}); }, [saved]);

  const set = <K extends SettingKey>(key: K, value: AppSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const dirtyKeys = (keys: SettingKey[]) => keys.filter((k) => !same(draft[k], saved[k]));

  const saveSection = async (id: string, keys: SettingKey[]) => {
    const next: Partial<AppSettings> = {};
    const errs: Partial<Record<SettingKey, string>> = {};
    for (const k of dirtyKeys(keys)) {
      const value = k === "min_grade_requirement" || k === "max_scholarships_per_student" || k === "max_upload_mb"
        ? Number(draft[k]) : draft[k];
      const err = validateSetting(k, value);
      if (err) errs[k] = err; else (next as Record<string, unknown>)[k] = value;
    }
    if (draft.application_open_date && draft.application_close_date && draft.application_open_date > draft.application_close_date) {
      errs.application_close_date = "The closing date must be on or after the opening date";
    }
    setErrors(errs);
    if (Object.keys(errs).length || !Object.keys(next).length) return;
    setBusy(id);
    await onSave(next);
    setBusy(null);
  };

  const resetAll = async () => {
    setBusy("reset");
    await onSave({ ...SETTING_DEFAULTS }, "reset_settings");
    setBusy(null);
  };

  const SaveBar = ({ id, keys }: { id: string; keys: SettingKey[] }) => {
    const dirty = dirtyKeys(keys).length > 0;
    return (
      <div className="flex items-center gap-3 pt-1">
        <Button disabled={!dirty || busy !== null} onClick={() => saveSection(id, keys)}>
          {busy === id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes
        </Button>
        {dirty && (
          <>
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
            <Button variant="ghost" size="sm" onClick={() => { setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, saved[k]])) })); setErrors({}); }}>Discard</Button>
          </>
        )}
      </div>
    );
  };

  const Err = ({ k }: { k: SettingKey }) => (errors[k] ? <p className="text-xs text-destructive mt-1">{errors[k]}</p> : null);

  const toggleMethod = (m: PaymentMethod, on: boolean) => {
    const next = on ? [...draft.payment_methods, m] : draft.payment_methods.filter((x) => x !== m);
    set("payment_methods", PAYMENT_METHODS.filter((x) => next.includes(x)));
  };

  const history = useMemo(
    () => auditLogs.filter((l) => l.action === "update_setting" || l.action === "reset_settings").slice(0, 15),
    [auditLogs]
  );

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-display font-bold">System Settings</h2>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy !== null}><RotateCcw className="mr-2 h-4 w-4" />Reset to defaults</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
              <AlertDialogDescription>Every setting on this page returns to its factory default, including contact info and the application period. This is recorded in the audit log.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={resetAll}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Academic Year & Semester</CardTitle><CardDescription>New applications are stamped with these.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Academic Year</Label><Input value={draft.academic_year} placeholder="2025-2026" onChange={(e) => set("academic_year", e.target.value)} /><Err k="academic_year" /></div>
            <div><Label>Semester</Label>
              <Select value={draft.current_semester} onValueChange={(v) => set("current_semester", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEMESTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <SaveBar id="academic" keys={["academic_year", "current_semester"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Application Period</CardTitle><CardDescription>Students can only apply while applications are open and today falls inside the dates. Each scholarship also has its own deadline.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Applications open</p><p className="text-xs text-muted-foreground">Turn off to stop all new applications.</p></div>
            <Switch checked={draft.applications_open} onCheckedChange={(v) => set("applications_open", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Opening date</Label><Input type="date" value={draft.application_open_date} onChange={(e) => set("application_open_date", e.target.value)} /></div>
            <div><Label>Closing date</Label><Input type="date" value={draft.application_close_date} onChange={(e) => set("application_close_date", e.target.value)} /><Err k="application_close_date" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Leave a date blank for no limit.</p>
          <SaveBar id="period" keys={["applications_open", "application_open_date", "application_close_date"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Scholarship Criteria</CardTitle><CardDescription>Enforced when a student submits an application.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Minimum Grade Average (0 = no minimum)</Label><Input type="number" min={0} max={100} step="0.01" value={draft.min_grade_requirement} onChange={(e) => set("min_grade_requirement", e.target.value as unknown as number)} /><Err k="min_grade_requirement" /></div>
          <div><Label>Max Applications Per Student, Per Year</Label><Input type="number" min={1} max={20} step={1} value={draft.max_scholarships_per_student} onChange={(e) => set("max_scholarships_per_student", e.target.value as unknown as number)} /><Err k="max_scholarships_per_student" /></div>
          <SaveBar id="criteria" keys={["min_grade_requirement", "max_scholarships_per_student"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payment Methods</CardTitle><CardDescription>Only enabled methods can be chosen for new payments or by students.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {PAYMENT_METHODS.map((m) => (
            <div key={m} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
              <span className="text-sm">{m}</span>
              <Switch checked={draft.payment_methods.includes(m)} onCheckedChange={(v) => toggleMethod(m, v)} />
            </div>
          ))}
          <Err k="payment_methods" />
          {draft.payment_methods.length === 0 && <p className="text-xs text-destructive">Enable at least one payment method.</p>}
          <SaveBar id="payments" keys={["payment_methods"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Email Notifications</p><p className="text-xs text-muted-foreground">Master switch for all emails (applications, payments, reminders)</p></div>
            <Switch checked={draft.email_notifications} onCheckedChange={(v) => set("email_notifications", v)} />
          </div>
          <p className="text-xs text-muted-foreground">Emails are sent through Resend. SMS is not available. Each person can also turn categories on or off under Notifications.</p>
          <SaveBar id="notifications" keys={["email_notifications"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Uploads & Maintenance</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Max document upload size (MB)</Label><Input type="number" min={1} max={25} value={draft.max_upload_mb} onChange={(e) => set("max_upload_mb", e.target.value as unknown as number)} /><Err k="max_upload_mb" /></div>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Maintenance mode</p><p className="text-xs text-muted-foreground">Blocks student applications and document uploads. Admins are not affected.</p></div>
            <Switch checked={draft.maintenance_mode} onCheckedChange={(v) => set("maintenance_mode", v)} />
          </div>
          <div><Label>Message shown to students</Label><Textarea rows={2} maxLength={300} value={draft.maintenance_message} onChange={(e) => set("maintenance_message", e.target.value)} /></div>
          <SaveBar id="maintenance" keys={["max_upload_mb", "maintenance_mode", "maintenance_message"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Public Contact Info</CardTitle><CardDescription>Shown in the site footer and on the Contact page.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Program name</Label><Input maxLength={300} value={draft.program_name} onChange={(e) => set("program_name", e.target.value)} /><Err k="program_name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label><Input type="email" value={draft.contact_email} onChange={(e) => set("contact_email", e.target.value)} /><Err k="contact_email" /></div>
            <div><Label>Phone</Label><Input value={draft.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></div>
          </div>
          <div><Label>Address</Label><Input value={draft.contact_address} onChange={(e) => set("contact_address", e.target.value)} /></div>
          <div><Label>Office hours</Label><Input value={draft.office_hours} onChange={(e) => set("office_hours", e.target.value)} /></div>
          <SaveBar id="contact" keys={["program_name", "contact_email", "contact_phone", "contact_address", "office_hours"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Changes</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">No setting changes recorded yet.</p> : (
            <ul className="divide-y">
              {history.map((l) => {
                const prev = l.previous_value as { key?: string; value?: Json } | null;
                const next = l.new_value as { key?: string; value?: Json } | null;
                return (
                  <li key={l.id} className="py-2 text-sm">
                    {l.action === "reset_settings" ? <span className="font-medium">Reset all settings to defaults</span> : (
                      <><span className="font-medium">{LABELS[(next?.key ?? "") as SettingKey] ?? next?.key}</span>: {fmt(prev?.value)} → {fmt(next?.value)}</>
                    )}
                    <div className="text-xs text-muted-foreground">{l.user_email ?? "Unknown"} · {new Date(l.created_at).toLocaleString()}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
