"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { OFFICE_FULL_NAME, ROLE_DESCRIPTION, isOffice, isStaffRole, roleCanHaveOffice, staffLabel } from "@/lib/permissions";
import { PASSWORD_HINT, passwordProblem } from "@/validations/auth";
import { Skeleton } from "@/components/ui/skeleton";

/** Reached from a reset email or a staff invite (?invite=1): the link signs the person in, then sends them here. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "expired">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState(false);
  // The access an invite gives, shown so they know what they're accepting.
  const [access, setAccess] = useState<{ role: string; office: string | null } | null>(null);

  useEffect(() => {
    const isInvite = new URLSearchParams(window.location.search).get("invite") === "1";
    setInvite(isInvite);
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user && isInvite) {
        const { data: row } = await supabase.from("user_roles").select("role, office").eq("user_id", data.user.id).maybeSingle();
        if (row && isStaffRole(row.role)) setAccess({ role: row.role, office: row.office ?? null });
      }
      setReady(data.user ? "ok" : "expired");
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    const problem = passwordProblem(password);
    if (problem) errs.password = problem;
    if (password !== confirm) errs.confirm = "Passwords do not match";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    const supabase = createClient();
    // password_set ends a staff invite's "pending" state in the admin panel.
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    if (error) {
      setLoading(false);
      toast.error("Could not change your password", { description: error.message });
      return;
    }
    // A new password starts a fresh count of failed sign-in tries (migration 077).
    await fetch("/api/auth/lockout-reset", { method: "POST" }).catch(() => {});
    // Sign out so the next login goes through the normal steps (including two-factor, if on).
    await supabase.auth.signOut();
    toast.success(invite ? "Password set" : "Password changed", { description: "Log in with your new password." });
    router.push("/login");
  };

  return (
    <Layout>
      <div className="container flex items-center justify-center min-h-[70dvh] py-8 sm:py-12">
        <Card className="w-full max-w-md animate-scale-in overflow-hidden">
          <div className="h-1.5 bg-gradient-primary" />
          <CardHeader className="text-center pt-6">
            <div className="flex justify-center mb-3">
              <div className="h-14 w-14 rounded-full bg-orange-100 flex items-center justify-center">
                <KeyRound className="h-7 w-7 text-orange-600" />
              </div>
            </div>
            <CardTitle className="font-display text-2xl">{invite ? "Set your password" : "Set a new password"}</CardTitle>
            {ready === "ok" && invite && <CardDescription>Welcome to the scholarship office. Choose a password for your staff account.</CardDescription>}
            {ready === "expired" && <CardDescription>{invite
              ? "This invite link is invalid or has expired. Ask the Mayor Office to send the invite again."
              : "This reset link is invalid or has expired."}</CardDescription>}
          </CardHeader>
          <CardContent>
            {ready === "checking" && (
              <div className="space-y-4" aria-busy aria-label="Checking your link">
                {[1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-full" /></div>)}
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {ready === "expired" && !invite && (
              <Button asChild className="w-full bg-gradient-primary shadow-primary"><Link href="/forgot-password">Send a new link</Link></Button>
            )}
            {ready === "ok" && access && (
              <div className="mb-5 rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/30">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-orange-600" />Your access
                </p>
                <p className="mt-1 font-semibold text-foreground">{staffLabel(access.role, access.office)}</p>
                <p className="mt-1 text-muted-foreground">
                  {ROLE_DESCRIPTION[access.role as keyof typeof ROLE_DESCRIPTION]}
                  {roleCanHaveOffice(access.role) && (isOffice(access.office)
                    ? ` Only ${OFFICE_FULL_NAME[access.office]} programs, and their applicants and payments.`
                    : " Across all offices.")}
                </p>
              </div>
            )}
            {ready === "ok" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>New password</Label>
                  <Input type="password" autoComplete="new-password" autoFocus value={password}
                    onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }} />
                  <p className={`text-xs mt-1 ${errors.password ? "text-destructive" : "text-muted-foreground"}`}>{errors.password ?? PASSWORD_HINT}</p>
                </div>
                <div>
                  <Label>Confirm new password</Label>
                  <Input type="password" autoComplete="new-password" value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setErrors((p) => ({ ...p, confirm: undefined })); }} />
                  {errors.confirm && <p className="text-xs text-destructive mt-1">{errors.confirm}</p>}
                </div>
                <Button type="submit" className="w-full bg-gradient-primary shadow-primary" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {invite ? "Set password" : "Change password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
