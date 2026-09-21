"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { desktopAlertsEnabled, desktopAlertsSupported, disableDesktopAlerts, enableDesktopAlerts } from "@/lib/desktop-alerts";

type Category = { key: "application" | "verification" | "payment" | "program"; label: string; hint: string };
type Pref = { in_app: boolean; email: boolean };
type Master = { email_enabled: boolean; in_app_enabled: boolean };

const saved = () => toast.success("Saved", { id: "prefs-saved", duration: 1500 });

export default function NotificationPreferences({ userId, categories, email }: { userId: string; categories: Category[]; email?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { settings } = useSystemSettings();
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});
  const [master, setMaster] = useState<Master>({ email_enabled: true, in_app_enabled: true });
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);

  // Desktop alerts are a per-device choice kept in this browser, not part of the account.
  const [desktop, setDesktop] = useState(false);
  const [desktopSupported, setDesktopSupported] = useState(true);
  useEffect(() => { setDesktopSupported(desktopAlertsSupported()); setDesktop(desktopAlertsEnabled()); }, []);
  const toggleDesktop = async (on: boolean) => {
    if (!on) { disableDesktopAlerts(); setDesktop(false); saved(); return; }
    const permission = await enableDesktopAlerts();
    if (permission !== "granted") {
      toast.error("Desktop alerts are blocked", { description: "Allow notifications for this site in your browser's site settings, then try again." });
      setDesktop(false);
      return;
    }
    setDesktop(true);
    saved();
  };

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from("notification_preferences").select("*").eq("user_id", userId),
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    ]).then(([prefRes, masterRes]) => {
      const next: Record<string, Pref> = {};
      (prefRes.data ?? []).forEach((r) => { next[r.category] = { in_app: r.in_app, email: r.email }; });
      setPrefs(next);
      if (masterRes.data) setMaster({ email_enabled: masterRes.data.email_enabled, in_app_enabled: masterRes.data.in_app_enabled });
      setLoaded(true);
    });
  }, [userId, supabase]);

  const get = (key: string): Pref => prefs[key] ?? { in_app: true, email: true };

  const update = async (key: string, patch: Partial<Pref>) => {
    const before = get(key);
    const next = { ...before, ...patch };
    setPrefs((p) => ({ ...p, [key]: next }));
    const { error } = await supabase.from("notification_preferences").upsert({ user_id: userId, category: key, ...next });
    if (error) {
      setPrefs((p) => ({ ...p, [key]: before }));
      toast.error("Could not save preference", { description: error.message });
      return;
    }
    saved();
  };

  const updateMaster = async (patch: Partial<Master>) => {
    const before = master;
    const next = { ...before, ...patch };
    setMaster(next);
    const { error } = await supabase.from("user_settings").upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() });
    if (error) {
      setMaster(before);
      toast.error("Could not save setting", { description: error.message });
      return;
    }
    saved();
  };

  const sendTest = async () => {
    setTesting(true);
    const { error } = await supabase.rpc("send_test_notification");
    setTesting(false);
    if (error) { toast.error("Could not send the test", { description: error.message }); return; }
    toast.success("Test sent", { description: email ? `Check your inbox at ${email} and your notifications here.` : "Check your notifications." });
  };

  const emailOffByOffice = !settings.email_notifications;

  return (
    <div className="space-y-4">
      {emailOffByOffice && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>The office has turned email notifications off for now. You&apos;ll still get in-app notifications, and your email choices below will apply again once emails are back on.</span>
        </div>
      )}

      {email && <p className="text-sm text-muted-foreground">Emails are sent to <strong className="text-foreground">{email}</strong>. To use a different address, change your email in your profile.</p>}

      <div className="rounded-xl border border-border divide-y divide-border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div><p className="text-sm font-medium">Email notifications</p><p className="text-xs text-muted-foreground">Turn off to stop all emails about applications, verification, payments and programs.</p></div>
          <Switch disabled={!loaded} checked={master.email_enabled} onCheckedChange={(v) => updateMaster({ email_enabled: v })} aria-label="All email notifications" />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div><p className="text-sm font-medium">In-app notifications</p><p className="text-xs text-muted-foreground">Turn off to stop these appearing in your dashboard. Emails are unaffected.</p></div>
          <Switch disabled={!loaded} checked={master.in_app_enabled} onCheckedChange={(v) => updateMaster({ in_app_enabled: v })} aria-label="All in-app notifications" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Desktop alerts on this device</p>
          <p className="text-xs text-muted-foreground">
            {desktopSupported ? "Show a browser notification when something arrives while this site is open in a background tab. This doesn't work when the site is closed." : "This browser doesn't support desktop alerts."}
          </p>
        </div>
        <Switch disabled={!desktopSupported} checked={desktop} onCheckedChange={toggleDesktop} aria-label="Desktop alerts on this device" />
      </div>

      <div>
        <div className="grid grid-cols-[1fr_64px_64px] gap-3 pb-2 text-xs font-medium text-muted-foreground border-b border-border">
          <span>Notify me about</span><span className="text-center">In-app</span><span className="text-center">Email</span>
        </div>
        {categories.map((c) => (
          <div key={c.key} className="grid grid-cols-[1fr_64px_64px] gap-3 items-center py-3 border-b border-border last:border-0">
            <div><p className="text-sm font-medium">{c.label}</p><p className="text-xs text-muted-foreground">{c.hint}</p></div>
            <div className="flex justify-center">
              <Switch disabled={!loaded || !master.in_app_enabled} checked={master.in_app_enabled && get(c.key).in_app} onCheckedChange={(v) => update(c.key, { in_app: v })} aria-label={`${c.label} in-app`} />
            </div>
            <div className="flex justify-center">
              <Switch disabled={!loaded || !master.email_enabled || emailOffByOffice} checked={master.email_enabled && get(c.key).email} onCheckedChange={(v) => update(c.key, { email: v })} aria-label={`${c.label} email`} />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground pt-3">Account and system notices, such as replies to your requests, are always delivered.</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <Button variant="outline" className="rounded-xl" disabled={testing} onClick={sendTest}>
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send me a test notification
        </Button>
        <span className="text-xs text-muted-foreground">Shows up here and, if email is set up, in your inbox. Once every few minutes.</span>
      </div>
    </div>
  );
}
