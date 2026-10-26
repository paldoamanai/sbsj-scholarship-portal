"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import SecuritySettings from "@/components/account/SecuritySettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut, ShieldCheck } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

/**
 * Staff accounts must use two-factor (migration 075): until one has an authenticator set up, the
 * database shows it nothing, so the admin panel is replaced by the setup. The middleware already asks
 * accounts that have one for its code at sign-in.
 */
export default function StaffTwoFactorGate({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<"checking" | "ok" | "setup">("checking");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setState("ok"); return; } // the admin page sends signed-out visitors to /login
      setUserId(session.user.id);
      const { data, error } = await supabase.auth.mfa.listFactors();
      // If the check itself fails, let the page load; the database still enforces the rule.
      if (error) { setState("ok"); return; }
      setState((data?.totp ?? []).some((f) => f.status === "verified") ? "ok" : "setup");
    })();
  }, [supabase]);

  if (state === "checking") return <DashboardSkeleton variant="admin" />;
  if (state === "ok") return <>{children}</>;

  return (
    <div className="min-h-dvh bg-muted/30 flex items-start sm:items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Set up two-factor authentication</CardTitle>
          <CardDescription>
            Staff accounts handle student records and payments, so they need a code from an authenticator app
            (Google Authenticator, Authy or similar) at every sign-in. Set it up to open the admin panel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecuritySettings userId={userId} required onEnabled={() => window.location.reload()} />
          <Button variant="ghost" className="w-full" onClick={async () => { await supabase.auth.signOut({ scope: "local" }); window.location.replace("/login"); }}>
            <LogOut className="mr-2 h-4 w-4" />Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
