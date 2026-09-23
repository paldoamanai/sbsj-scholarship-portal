"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, User, ShieldCheck, Mail, KeyRound, History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import NotificationPreferences from "@/components/notifications/NotificationPreferences";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/avatar";
import ProfileImage from "@/components/ProfileImage";
import SecuritySettings from "@/components/account/SecuritySettings";
import { adminProfileSchema, passwordSchema } from "@/validations/profile";
import type { Tables, Json } from "@/integrations/supabase/types";
import { STAFF_ROLE_LABELS, type StaffRole } from "@/lib/settings";

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
    setPhotoBusy(true);
    const err = await uploadAvatar(supabase, userId, file);
    setPhotoBusy(false);
    if (err) { toast.error("Could not update photo", { description: err }); return; }
    await logAudit("update_profile_photo", "profiles", userId);
    toast.success("Profile photo updated");
    onChanged();
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
                <ProfileImage value={profile?.profile_picture_url} alt="Profile" className="h-20 w-20 rounded-full object-cover"
                  fallback={<User className="h-10 w-10 text-muted-foreground" />} />
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
                <Badge>{STAFF_ROLE_LABELS[role as StaffRole] ?? role ?? "Admin"}</Badge>
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
        <CardContent>
          <SecuritySettings userId={userId} logAudit={logAudit} />
        </CardContent>
      </Card>

      {/* Notification preferences */}
      <Card>
        <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle><CardDescription>Choose what reaches you in the dashboard and by email.</CardDescription></CardHeader>
        <CardContent>
          <NotificationPreferences userId={userId} email={email} categories={[
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
