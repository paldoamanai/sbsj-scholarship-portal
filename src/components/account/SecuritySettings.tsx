"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; status: string; friendly_name?: string | null };

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Sign-in details, two-factor authentication and "sign out other devices". Shared by the student and
 * admin profile pages. Two-factor is enforced at sign-in (login page + middleware), not just recorded.
 */
export default function SecuritySettings({ userId, logAudit }: {
  userId: string;
  /** Admins pass their audit logger; students don't have one. */
  logAudit?: (action: string, entityType: string, entityId?: string) => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [info, setInfo] = useState<{ created_at?: string; last_sign_in_at?: string }>({});
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setInfo({ created_at: data.user.created_at, last_sign_in_at: data.user.last_sign_in_at });
    });
  }, [supabase]);

  // ── sessions ──
  const [sessionBusy, setSessionBusy] = useState(false);
  const signOutOthers = async () => {
    setSessionBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setSessionBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit?.("sign_out_other_sessions", "auth", userId);
    toast.success("Signed out of all other devices");
  };

  // ── two-factor (TOTP) ──
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const loadFactors = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  };
  useEffect(() => { loadFactors(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const verified = factors.find((f) => f.status === "verified");

  const startEnroll = async () => {
    setBusy(true);
    // Clear abandoned, unverified enrolments first.
    for (const f of factors.filter((x) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${Date.now()}` });
    setBusy(false);
    if (error || !data) { toast.error("Could not start setup", { description: error?.message ?? "Two-factor may not be enabled for this project." }); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const confirmEnroll = async () => {
    if (!enroll || !/^\d{6}$/.test(code)) { toast.error("Enter the 6-digit code from your app"); return; }
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
    setBusy(false);
    if (error) { toast.error("Invalid code", { description: error.message }); return; }
    await logAudit?.("enable_2fa", "auth", userId);
    toast.success("Two-factor authentication enabled", { description: "You'll be asked for a code every time you sign in." });
    setEnroll(null); setCode(""); loadFactors();
  };
  const disable2fa = async () => {
    if (!verified) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    if (error) {
      // Supabase asks for a fresh second step before removing a factor.
      toast.error("Could not disable", { description: error.message });
      return;
    }
    await logAudit?.("disable_2fa", "auth", userId);
    toast.success("Two-factor authentication disabled");
    loadFactors();
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Last sign-in</p><p className="font-medium">{fmt(info.last_sign_in_at)}</p></div>
        <div><p className="text-xs text-muted-foreground">Account created</p><p className="font-medium">{fmt(info.created_at)}</p></div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium flex items-center gap-2"><Smartphone className="h-4 w-4" />Two-factor authentication {verified && <Badge variant="secondary">On</Badge>}</p>
            <p className="text-xs text-muted-foreground">Ask for a code from an authenticator app (Google Authenticator, Authy…) each time you sign in.</p>
          </div>
          {verified ? (
            <Button variant="outline" size="sm" onClick={disable2fa} disabled={busy}>Disable</Button>
          ) : !enroll ? (
            <Button size="sm" onClick={startEnroll} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Enable</Button>
          ) : null}
        </div>
        {enroll && (
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Two-factor QR code" className="h-40 w-40 bg-white p-2 rounded" />
            <p className="text-xs text-muted-foreground break-all">Can&apos;t scan? Enter this key instead: <code>{enroll.secret}</code></p>
            <div className="flex gap-2 flex-wrap">
              <Input inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="w-32" />
              <Button onClick={confirmEnroll} disabled={busy}>Verify</Button>
              <Button variant="ghost" onClick={async () => { await supabase.auth.mfa.unenroll({ factorId: enroll.id }); setEnroll(null); setCode(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium flex items-center gap-2"><LogOut className="h-4 w-4" />Other devices</p>
          <p className="text-xs text-muted-foreground">Sign out everywhere except this device, for example if you used a shared computer.</p>
        </div>
        <Button variant="outline" size="sm" onClick={signOutOthers} disabled={sessionBusy}>
          {sessionBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Sign out others
        </Button>
      </div>
    </div>
  );
}
