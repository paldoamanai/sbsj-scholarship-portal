"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Camera, CheckCircle, Download, Loader2, Lock, Upload, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ProfileImage from "@/components/ProfileImage";
import { Panel, SectionTitle } from "@/components/student/ui";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/avatar";
import { safeFileName, DOC_MIME } from "@/lib/documents";
import { YEAR_LEVEL_OPTIONS, coursesFor, isCollege, isSHS, schoolsFor, withCurrent } from "@/lib/academics";
import { profileCompleteness } from "@/lib/profile";
import { emailChangeSchema, gradeSubmissionSchema, passwordSchema, studentProfileSchema, type StudentProfileForm } from "@/validations/profile";
import { useSystemSettings } from "@/hooks/use-system-settings";
import type { Tables } from "@/integrations/supabase/types";

const toForm = (p: Tables<"profiles"> | null): StudentProfileForm => ({
  first_name: p?.first_name ?? "", middle_name: p?.middle_name ?? "", last_name: p?.last_name ?? "",
  sex: (p?.sex as StudentProfileForm["sex"]) ?? "", civil_status: (p?.civil_status as StudentProfileForm["civil_status"]) ?? "",
  nationality: p?.nationality ?? "", dob: p?.dob ?? "",
  phone: p?.phone ?? "", street_address: p?.street_address ?? "", barangay: p?.barangay ?? "", municipality: p?.municipality ?? "",
  province: p?.province ?? "", zip_code: p?.zip_code ?? "",
  guardian_name: p?.guardian_name ?? "", guardian_relationship: p?.guardian_relationship ?? "", guardian_phone: p?.guardian_phone ?? "",
  school_name: p?.school_name ?? "", course: p?.course ?? "", year_level: (p?.year_level as StudentProfileForm["year_level"]) ?? "",
  student_id_number: p?.student_id_number ?? "",
});

const fmtDay = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—";

function Field({ label, error, hint, children, className = "" }: {
  label: string; error?: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground font-medium mb-1.5 block">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive mt-1">{error}</p> : hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}

const inputCls = "rounded-xl border-border focus:border-primary focus:ring-primary/20";

export default function ProfileSection({ profile, userId, userEmail, applications, locked, gradeUpdates, dataRequests, onChanged }: {
  profile: Tables<"profiles"> | null;
  userId: string;
  userEmail: string;
  applications: Pick<Tables<"applications">, "status">[];
  /** This year's scholarship is approved: identity and school details are locked. */
  locked: boolean;
  gradeUpdates: Tables<"grade_updates">[];
  dataRequests: Tables<"data_requests">[];
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { settings } = useSystemSettings();

  // ── profile form ──
  const [form, setForm] = useState<StudentProfileForm>(() => toForm(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(toForm(profile)); setErrors({}); }, [profile]);

  const saved = useMemo(() => toForm(profile), [profile]);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof StudentProfileForm>(key: K, value: StudentProfileForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };
  const idsLocked = applications.some((a) => a.status !== "Withdrawn");
  const completeness = profileCompleteness(profile);

  const schools = withCurrent(schoolsFor(form.year_level), form.school_name);
  const courses = withCurrent(coursesFor(form.year_level, form.school_name), form.course);

  const changeYearLevel = (v: string) => {
    // SHS and college use different school / course lists, so switching between them clears both.
    const switched = isSHS(form.year_level) !== isSHS(v) && (isSHS(form.year_level) || isCollege(form.year_level));
    setForm((f) => ({ ...f, year_level: v as StudentProfileForm["year_level"], ...(switched ? { school_name: "", course: "" } : {}) }));
    setErrors((e) => ({ ...e, year_level: "" }));
  };

  const save = async () => {
    const parsed = studentProfileSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { const k = String(i.path[0]); if (!errs[k]) errs[k] = i.message; });
      setErrors(errs);
      toast.error("Check the highlighted fields");
      return;
    }
    setSaving(true);
    // Empty text is stored as null so "not filled in" is one state.
    const payload = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v]));
    const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
    setSaving(false);
    if (error) { toast.error("Could not save", { description: error.message }); return; }
    toast.success("Profile saved");
    onChanged();
  };

  // ── photo ──
  const [photoBusy, setPhotoBusy] = useState(false);
  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setPhotoBusy(true);
    const err = await uploadAvatar(supabase, userId, file);
    setPhotoBusy(false);
    if (err) { toast.error(err); return; }
    toast.success("Profile photo updated");
    onChanged();
  };

  // ── grade submission ──
  const pendingGrade = gradeUpdates.find((g) => g.status === "Pending");
  const [grade, setGrade] = useState("");
  const [term, setTerm] = useState(`${settings.current_semester} ${settings.academic_year}`);
  const [gradeFile, setGradeFile] = useState<File | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [gradeErr, setGradeErr] = useState("");

  const pickGradeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    if (!DOC_MIME.includes(file.type)) { toast.error("Upload a PDF, JPG or PNG file."); return; }
    if (file.size > settings.max_upload_mb * 1024 * 1024) { toast.error(`File is too large (max ${settings.max_upload_mb} MB).`); return; }
    setGradeFile(file);
  };

  const submitGrade = async () => {
    const parsed = gradeSubmissionSchema.safeParse({ grade: grade.trim() === "" ? NaN : Number(grade), term });
    if (!parsed.success) { setGradeErr(parsed.error.issues[0]?.message ?? "Check the form"); return; }
    if (!gradeFile) { setGradeErr("Attach your grade report"); return; }
    setGradeErr("");
    setGradeBusy(true);
    const path = `${userId}/grades/${Date.now()}-${safeFileName(gradeFile.name)}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, gradeFile, { contentType: gradeFile.type });
    if (upErr) { setGradeBusy(false); toast.error("Upload failed", { description: upErr.message }); return; }
    const { error } = await supabase.rpc("submit_grade_update", { _grade: parsed.data.grade, _term: parsed.data.term, _path: path });
    setGradeBusy(false);
    if (error) {
      await supabase.storage.from("documents").remove([path]);
      toast.error("Could not submit", { description: error.message });
      return;
    }
    toast.success("Grade submitted. The office will verify it.");
    setGrade(""); setGradeFile(null);
    onChanged();
  };

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

  const displayName = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || userEmail.split("@")[0];
  const guardianRequired = isSHS(form.year_level);

  return (
    <div className="space-y-5">
      {locked && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Your scholarship is approved, so your name, birth date, school, course and year level are locked. You can still update your contact details, address, guardian, photo and password. Contact the office to correct anything that&apos;s locked.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Avatar + completeness */}
        <Panel className="p-4 sm:p-6 text-center flex flex-col items-center">
          <div className="relative mb-4">
            <ProfileImage value={profile?.profile_picture_url} alt="Profile" className="h-24 w-24 rounded-2xl object-cover"
              fallback={<div className="h-24 w-24 rounded-2xl bg-accent flex items-center justify-center"><User className="h-10 w-10 text-primary" /></div>} />
            <Label className={`absolute -bottom-2 -right-2 h-8 w-8 rounded-xl flex items-center justify-center cursor-pointer shadow-md transition-colors ${photoBusy ? "opacity-50 pointer-events-none bg-muted-foreground/70" : "bg-primary hover:bg-primary"}`}>
              <Input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" disabled={photoBusy} onChange={pickPhoto} aria-label="Change profile photo" />
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Camera className="h-4 w-4 text-white" />}
            </Label>
          </div>
          <h3 className="font-display font-bold text-sidebar-accent">{displayName}</h3>
          <p className="text-sm text-muted-foreground mt-0.5 break-all">{userEmail}</p>
          <p className="text-[11px] text-muted-foreground mt-1">JPG, PNG or WebP · up to 2 MB</p>

          <div className="w-full mt-5 text-left">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-foreground">Profile complete</span>
              <span className={`font-bold ${completeness.percent === 100 ? "text-emerald-600" : "text-primary"}`}>{completeness.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completeness.percent}%` }} />
            </div>
            {completeness.missing.length > 0 ? (
              <p className="text-xs text-muted-foreground mt-2">Still needed: {completeness.missing.map((m) => m.label).join(", ")}.</p>
            ) : (
              <p className="text-xs text-emerald-600 mt-2">Everything the office needs is filled in.</p>
            )}
          </div>
        </Panel>

        <div className="lg:col-span-2 space-y-5">
          {/* Personal */}
          <Panel>
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Personal Information</SectionTitle></div>
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name *" error={errors.first_name}><Input className={inputCls} autoComplete="given-name" value={form.first_name} disabled={locked} onChange={(e) => set("first_name", e.target.value)} /></Field>
              <Field label="Middle name" error={errors.middle_name}><Input className={inputCls} value={form.middle_name} disabled={locked} onChange={(e) => set("middle_name", e.target.value)} /></Field>
              <Field label="Last name *" error={errors.last_name}><Input className={inputCls} autoComplete="family-name" value={form.last_name} disabled={locked} onChange={(e) => set("last_name", e.target.value)} /></Field>
              <Field label="Date of birth" error={errors.dob}><Input type="date" className={inputCls} value={form.dob} disabled={locked} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("dob", e.target.value)} /></Field>
              <Field label="Sex" error={errors.sex}>
                <Select value={form.sex} onValueChange={(v) => set("sex", v as StudentProfileForm["sex"])} disabled={locked}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Civil status" error={errors.civil_status}>
                <Select value={form.civil_status} onValueChange={(v) => set("civil_status", v as StudentProfileForm["civil_status"])}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="Single">Single</SelectItem><SelectItem value="Married">Married</SelectItem><SelectItem value="Widowed">Widowed</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Nationality" error={errors.nationality}><Input className={inputCls} value={form.nationality} onChange={(e) => set("nationality", e.target.value)} /></Field>
            </div>
          </Panel>

          {/* Contact & address */}
          <Panel>
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Contact &amp; Address</SectionTitle></div>
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Mobile number" error={errors.phone} hint="09XXXXXXXXX or +639XXXXXXXXX"><Input className={inputCls} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="Email"><Input className={`${inputCls} bg-muted`} value={userEmail} disabled /></Field>
              <Field label="Street / house no." error={errors.street_address} className="sm:col-span-2"><Input className={inputCls} autoComplete="street-address" value={form.street_address} onChange={(e) => set("street_address", e.target.value)} /></Field>
              <Field label="Barangay" error={errors.barangay}><Input className={inputCls} value={form.barangay} onChange={(e) => set("barangay", e.target.value)} /></Field>
              <Field label="Municipality" error={errors.municipality}><Input className={inputCls} value={form.municipality} onChange={(e) => set("municipality", e.target.value)} /></Field>
              <Field label="Province" error={errors.province}><Input className={inputCls} value={form.province} onChange={(e) => set("province", e.target.value)} /></Field>
              <Field label="ZIP code" error={errors.zip_code}><Input className={inputCls} inputMode="numeric" autoComplete="postal-code" maxLength={4} value={form.zip_code} onChange={(e) => set("zip_code", e.target.value)} /></Field>
            </div>
          </Panel>

          {/* Guardian */}
          <Panel>
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Parent / Guardian</SectionTitle></div>
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={`Full name${guardianRequired ? " *" : ""}`} error={errors.guardian_name}><Input className={inputCls} value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} /></Field>
              <Field label="Relationship" error={errors.guardian_relationship}><Input className={inputCls} value={form.guardian_relationship} placeholder="e.g. Mother" onChange={(e) => set("guardian_relationship", e.target.value)} /></Field>
              <Field label={`Mobile number${guardianRequired ? " *" : ""}`} error={errors.guardian_phone}><Input className={inputCls} type="tel" inputMode="tel" autoComplete="off" value={form.guardian_phone} onChange={(e) => set("guardian_phone", e.target.value)} /></Field>
              {guardianRequired && <p className="text-xs text-muted-foreground self-end pb-2">Required for Grade 11–12 students.</p>}
            </div>
          </Panel>

          {/* School */}
          <Panel>
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>School &amp; IDs</SectionTitle></div>
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Year level" error={errors.year_level}>
                <Select value={form.year_level} onValueChange={changeYearLevel} disabled={locked}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder="Select year level" /></SelectTrigger>
                  <SelectContent>{YEAR_LEVEL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="School" error={errors.school_name}>
                <Select value={form.school_name} onValueChange={(v) => setForm((f) => ({ ...f, school_name: v, course: "" }))} disabled={locked || !form.year_level}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder={form.year_level ? "Select school" : "Select year level first"} /></SelectTrigger>
                  <SelectContent>{schools.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Course / strand" error={errors.course} className="sm:col-span-2">
                <Select value={form.course} onValueChange={(v) => set("course", v)} disabled={locked || !form.year_level || (isCollege(form.year_level) && !form.school_name)}>
                  <SelectTrigger className="rounded-xl border-border"><SelectValue placeholder={isCollege(form.year_level) && !form.school_name ? "Select school first" : "Select course / strand"} /></SelectTrigger>
                  <SelectContent>{courses.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Student ID number" error={errors.student_id_number} hint={idsLocked ? "Locked once you have applied. Contact the office to correct it." : undefined}>
                <Input className={inputCls} value={form.student_id_number} disabled={idsLocked} onChange={(e) => set("student_id_number", e.target.value)} />
              </Field>
            </div>
          </Panel>

          <div className="flex items-center gap-3 flex-wrap">
            <Button disabled={!dirty || saving} className="bg-primary hover:bg-primary text-white rounded-xl px-6" onClick={save}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes
            </Button>
            {dirty && <span className="text-xs text-amber-700">You have unsaved changes.</span>}
            {dirty && <Button variant="ghost" className="rounded-xl text-xs" onClick={() => { setForm(saved); setErrors({}); }}>Discard</Button>}
          </div>
        </div>
      </div>

      {/* Academic standing */}
      <Panel>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-muted"><SectionTitle>Academic Standing</SectionTitle></div>
        <div className="p-4 sm:p-6 space-y-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="rounded-xl bg-muted border border-muted px-5 py-3">
              <p className="text-xs text-muted-foreground">Average grade</p>
              <p className="text-2xl font-bold text-sidebar-accent">{profile?.average_grade ?? "—"}</p>
            </div>
            {profile?.average_grade != null && (
              profile.grade_verified_at ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                  <CheckCircle className="h-3.5 w-3.5" /> Verified{profile.grade_term ? ` · ${profile.grade_term}` : ""} · {fmtDay(profile.grade_verified_at)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Self-declared at registration. Submit your grade report to get it verified.
                </span>
              )
            )}
          </div>

          {pendingGrade ? (
            <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Your grade of <strong>{pendingGrade.grade}</strong> for {pendingGrade.term} is waiting for the office to verify ({fmtDay(pendingGrade.created_at)}).
            </p>
          ) : (
            <div className="space-y-3 max-w-xl">
              <p className="text-sm text-muted-foreground">
                Your grade can only be changed by submitting your latest grade report. The office verifies it, then it replaces your current grade. This is what programs and renewals check.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="New average grade"><Input className={inputCls} type="number" inputMode="decimal" min={0} max={100} step="0.01" value={grade} onChange={(e) => { setGrade(e.target.value); setGradeErr(""); }} placeholder="e.g. 91.5" /></Field>
                <Field label="Term"><Input className={inputCls} value={term} maxLength={60} onChange={(e) => { setTerm(e.target.value); setGradeErr(""); }} /></Field>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-xl px-3 py-2 hover:bg-muted transition-colors min-w-0">
                  <Upload className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate max-w-[220px]">{gradeFile ? gradeFile.name : "Attach grade report (PDF, JPG, PNG)"}</span>
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={pickGradeFile} />
                </label>
                <Button className="bg-primary hover:bg-primary text-white rounded-xl" disabled={gradeBusy} onClick={submitGrade}>
                  {gradeBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit for verification
                </Button>
              </div>
              {gradeErr && <p className="text-xs text-destructive">{gradeErr}</p>}
            </div>
          )}

          {gradeUpdates.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Your submissions</p>
              <ul className="space-y-1.5">
                {gradeUpdates.map((g) => (
                  <li key={g.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span><strong>{g.grade}</strong> · {g.term} · {fmtDay(g.created_at)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        g.status === "Verified" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : g.status === "Rejected" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {g.status === "Pending" ? "Pending review" : g.status}
                      </span>
                    </div>
                    {g.status === "Rejected" && g.review_note && <p className="text-xs text-red-700 mt-1">Reason: {g.review_note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>

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
              <p className="font-semibold">Deletion request · {r.status === "Pending" ? "waiting for the office" : `${r.status.toLowerCase()} ${fmtDay(r.handled_at)}`} · sent {fmtDay(r.created_at)}</p>
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
