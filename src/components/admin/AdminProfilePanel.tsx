"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, User, ShieldCheck, LogOut, Mail, KeyRound, Smartphone, History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import NotificationPreferences from "@/components/notifications/NotificationPreferences";
import { createClient } from "@/lib/supabase/client";
import { adminProfileSchema, passwordSchema } from "@/validations/profile";
import type { Tables, Json } from "@/integrations/supabase/types";

type Props = {
  profile: Tables<"profiles"> | null;
  email: string;
  userId: string;
  role: string;
  auditLogs: Tables<"audit_logs">[];
  logAudit: (action: string, entityType: string, entityId?: string, prev?: Json | null, next?: Json | null) => Promise<void>;
  onChanged: () => void;
};

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", admin: "Admin" };
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—");

const strength = (pw: string) => {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0-5
};

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-destructive mt-1">{msg}</p> : null;
}

export default function AdminProfilePanel({ profile, email, userId, role, auditLogs, logAudit, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);

  // ── account details (from auth) ──
  const [authInfo, setAuthInfo] = useState<{ created_at?: string; last_sign_in_at?: string }>({});
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setAuthInfo({ created_at: data.user.created_at, last_sign_in_at: data.user.last_sign_in_at });
    });
  }, [supabase]);

  // ── photo ──
  const [photoBusy, setPhotoBusy] = useState(false);
  const uploadPhoto = async (file: File | undefined) => {
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > MAX_PHOTO_BYTES) { toast.error("Photo must be 2 MB or smaller"); return; }
    setPhotoBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const filePath = `${userId}/avatar/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("profile-pictures").upload(filePath, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("profile-pictures").getPublicUrl(filePath);
      const { error: dbErr } = await supabase.from("profiles").update({ profile_picture_url: urlData.publicUrl }).eq("id", userId);
      if (dbErr) throw dbErr;
      // Remove previous avatars so files don't pile up (best effort).
      const { data: existing } = await supabase.storage.from("profile-pictures").list(`${userId}/avatar`);
      const stale = (existing ?? []).map((f) => `${userId}/avatar/${f.name}`).filter((p) => p !== filePath);
      if (stale.length) await supabase.storage.from("profile-pictures").remove(stale);
      await logAudit("update_profile_photo", "profiles", userId);
      toast.success("Profile photo updated");
      onChanged();
    } catch (e) {
      toast.error("Could not update photo", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPhotoBusy(false);
    }
  };

  // ── personal info ──
  const [info, setInfo] = useState({ first_name: "", last_name: "", phone: "" });
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});
  const [infoBusy, setInfoBusy] = useState(false);
  useEffect(() => {
    setInfo({ first_name: profile?.first_name || "", last_name: profile?.last_name || "", phone: profile?.phone || "" });
  }, [profile?.first_name, profile?.last_name, profile?.phone]);

  const saveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = adminProfileSchema.safeParse(info);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[String(i.path[0])] = i.message; });
      setInfoErrors(errs);
      return;
    }
    setInfoErrors({});
    setInfoBusy(true);
    const prev = { first_name: profile?.first_name, last_name: profile?.last_name, phone: profile?.phone };
    const { error } = await supabase.from("profiles").update(parsed.data).eq("id", userId);
    setInfoBusy(false);
    if (error) { toast.error("Could not save profile", { description: error.message }); return; }
    await logAudit("update_profile", "profiles", userId, prev, parsed.data);
    toast.success("Profile updated");
    onChanged();
  };
  const infoDirty = info.first_name !== (profile?.first_name || "") || info.last_name !== (profile?.last_name || "") || info.phone !== (profile?.phone || "");

  // ── email ──
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = newEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) { toast.error("Enter a valid email address"); return; }
    if (value.toLowerCase() === email.toLowerCase()) { toast.error("That is already your email"); return; }
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email: value });
    setEmailBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit("change_email_requested", "auth", userId, { email }, { email: value });
    toast.success("Confirmation sent", { description: "Check both your old and new inbox to confirm the change." });
    setNewEmail("");
  };

  // ── password ──
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwBusy, setPwBusy] = useState(false);
  const pwScore = strength(pw.next);
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
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
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: pw.current });
    if (verifyErr) { setPwBusy(false); setPwErrors({ current: "Current password is incorrect" }); return; }
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setPwBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit("change_password", "auth", userId);
    toast.success("Password updated");
    setPw({ current: "", next: "", confirm: "" });
  };

  // ── sessions ──
  const [sessionBusy, setSessionBusy] = useState(false);
  const signOutOthers = async () => {
    setSessionBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setSessionBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit("sign_out_other_sessions", "auth", userId);
    toast.success("Signed out of all other devices");
  };

  // ── two-factor (TOTP) ──
  type Factor = { id: string; status: string; friendly_name?: string | null };
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const loadFactors = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  };
  useEffect(() => { loadFactors(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const verified = factors.find((f) => f.status === "verified");

  const startEnroll = async () => {
    setMfaBusy(true);
    // Clear abandoned, unverified enrolments first.
    for (const f of factors.filter((x) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Admin ${Date.now()}` });
    setMfaBusy(false);
    if (error || !data) { toast.error("Could not start setup", { description: error?.message ?? "Two-factor may not be enabled for this project." }); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const confirmEnroll = async () => {
    if (!enroll || !/^\d{6}$/.test(mfaCode)) { toast.error("Enter the 6-digit code from your app"); return; }
    setMfaBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: mfaCode });
    setMfaBusy(false);
    if (error) { toast.error("Invalid code", { description: error.message }); return; }
    await logAudit("enable_2fa", "auth", userId);
    toast.success("Two-factor authentication enabled");
    setEnroll(null); setMfaCode(""); loadFactors();
  };
  const disable2fa = async () => {
    if (!verified) return;
    setMfaBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setMfaBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit("disable_2fa", "auth", userId);
    toast.success("Two-factor authentication disabled");
    loadFactors();
  };

  // ── my activity ──
  const myActivity = useMemo(() => auditLogs.filter((l) => l.user_id === userId).slice(0, 10), [auditLogs, userId]);

  const fullName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || "Admin";

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <h2 className="text-xl font-display font-bold">Admin Profile</h2>

      {/* Header + account details */}
      <Card>
        <CardContent className="py-6 space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-20 w-20 rounded-full bg-accent flex items-center justify-center overflow-hidden">
                {profile?.profile_picture_url ? (
                  <img src={profile.profile_picture_url} alt="Profile" className="h-20 w-20 rounded-full object-cover" />
                ) : (
                  <User className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <label aria-label="Change photo" className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer hover:bg-primary/90">
                {photoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={photoBusy}
                  onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold truncate">{fullName}</p>
              <p className="text-sm text-muted-foreground truncate">{email}</p>
              <div className="mt-1 flex gap-2">
                <Badge>{ROLE_LABEL[role] ?? role ?? "Admin"}</Badge>
                <Badge variant={profile?.is_active === false ? "destructive" : "secondary"}>{profile?.is_active === false ? "Inactive" : "Active"}</Badge>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 2 MB.</p>
          <div className="grid grid-cols-2 gap-3 text-sm border-t pt-4">
            <div><p className="text-xs text-muted-foreground">Member since</p><p className="font-medium">{fmt(authInfo.created_at)}</p></div>
            <div><p className="text-xs text-muted-foreground">Last sign-in</p><p className="font-medium">{fmt(authInfo.last_sign_in_at)}</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Personal info */}
      <Card>
        <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={saveInfo} className="space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ap-first">First Name</Label>
                <Input id="ap-first" value={info.first_name} onChange={(e) => setInfo({ ...info, first_name: e.target.value })} />
                <FieldError msg={infoErrors.first_name} />
              </div>
              <div>
                <Label htmlFor="ap-last">Last Name</Label>
                <Input id="ap-last" value={info.last_name} onChange={(e) => setInfo({ ...info, last_name: e.target.value })} />
                <FieldError msg={infoErrors.last_name} />
              </div>
            </div>
            <div>
              <Label htmlFor="ap-phone">Phone</Label>
              <Input id="ap-phone" inputMode="tel" placeholder="09XXXXXXXXX" value={info.phone} onChange={(e) => setInfo({ ...info, phone: e.target.value })} />
              <FieldError msg={infoErrors.phone} />
            </div>
            <Button type="submit" disabled={infoBusy || !infoDirty}>
              {infoBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Email Address</CardTitle>
          <CardDescription>Current: {email}. A confirmation link is sent to verify the change.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changeEmail} className="flex gap-2">
            <Input type="email" placeholder="new@email.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} aria-label="New email" />
            <Button type="submit" disabled={emailBusy || !newEmail}>{emailBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Change</Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" />Change Password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-3" noValidate>
            <div>
              <Label htmlFor="ap-cur">Current Password</Label>
              <Input id="ap-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              <FieldError msg={pwErrors.current} />
            </div>
            <div>
              <Label htmlFor="ap-new">New Password</Label>
              <Input id="ap-new" type="password" autoComplete="new-password" placeholder="Min 8 chars, upper, lower, number" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              {pw.next && (
                <div className="mt-2 space-y-1">
                  <Progress value={(pwScore / 5) * 100} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">{["Very weak", "Weak", "Fair", "Good", "Strong", "Very strong"][pwScore]}</p>
                </div>
              )}
              <FieldError msg={pwErrors.next} />
            </div>
            <div>
              <Label htmlFor="ap-conf">Confirm New Password</Label>
              <Input id="ap-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              <FieldError msg={pwErrors.confirm} />
            </div>
            <Button type="submit" disabled={pwBusy}>{pwBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Update Password</Button>
          </form>
        </CardContent>
      </Card>

      {/* Security: 2FA + sessions */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Security</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-2"><Smartphone className="h-4 w-4" />Two-factor authentication</p>
                <p className="text-xs text-muted-foreground">Require a code from an authenticator app when signing in.</p>
              </div>
              {verified ? (
                <Button variant="outline" size="sm" onClick={disable2fa} disabled={mfaBusy}>Disable</Button>
              ) : !enroll ? (
                <Button size="sm" onClick={startEnroll} disabled={mfaBusy}>{mfaBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Enable</Button>
              ) : null}
            </div>
            {verified && <Badge variant="secondary">Enabled</Badge>}
            {enroll && (
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-sm">Scan this QR code with Google Authenticator, Authy or similar, then enter the 6-digit code.</p>
                <img src={enroll.qr} alt="2FA QR code" className="h-40 w-40 bg-white p-2 rounded" />
                <p className="text-xs text-muted-foreground break-all">Can&apos;t scan? Key: <code>{enroll.secret}</code></p>
                <div className="flex gap-2">
                  <Input inputMode="numeric" maxLength={6} placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} className="w-32" />
                  <Button onClick={confirmEnroll} disabled={mfaBusy}>Verify</Button>
                  <Button variant="ghost" onClick={async () => { await supabase.auth.mfa.unenroll({ factorId: enroll.id }); setEnroll(null); setMfaCode(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium flex items-center gap-2"><LogOut className="h-4 w-4" />Other sessions</p>
              <p className="text-xs text-muted-foreground">Sign out of every device except this one.</p>
            </div>
            <Button variant="outline" size="sm" onClick={signOutOthers} disabled={sessionBusy}>
              {sessionBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Sign out others
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notification preferences */}
      <Card>
        <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle><CardDescription>Choose what reaches you in the dashboard and by email.</CardDescription></CardHeader>
        <CardContent>
          <NotificationPreferences userId={userId} categories={[
            { key: "application", label: "Applications", hint: "New applications submitted" },
            { key: "verification", label: "Verification", hint: "Duplicate ID flags" },
            { key: "payment", label: "Payments", hint: "Receipts, method choices and unpaid approvals" },
          ]} />
        </CardContent>
      </Card>

      {/* My activity */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />My Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {myActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <ul className="divide-y">
              {myActivity.map((l) => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{l.action.replace(/_/g, " ")} <span className="text-muted-foreground font-normal">· {l.entity_type}</span></span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{fmt(l.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
