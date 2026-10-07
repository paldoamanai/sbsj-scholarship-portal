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
import { LogIn, ShieldCheck, Loader2, Eye, EyeOff, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { rememberCredential } from "@/lib/credentials";
import { isAdminRole } from "@/lib/settings";
import Captcha, { captchaEnabled } from "@/components/Captcha";

export default function LoginPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Second step for accounts with two-factor authentication on.
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Set when sign-in failed because the email hasn't been confirmed yet.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resending, setResending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const goToDashboard = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Login failed");
      setLoading(false);
      return;
    }

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleError) {
      toast.error("Failed to fetch user role");
      setLoading(false);
      return;
    }

    toast.success("Login successful!");
    const userRole = (roleData as { role?: string } | null)?.role || "student";
    const dest = isAdminRole(userRole) ? "/admin" : "/student-dashboard";
    router.push(dest);
    router.refresh();
  };

  // Password accepted: if the account needs a second step, ask for it before going anywhere.
  const needsSecondStep = async () => {
    const supabase = createClient();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.nextLevel !== "aal2" || aal.currentLevel === "aal2") return false;
    const { data: list } = await supabase.auth.mfa.listFactors();
    const factor = list?.totp?.find((f) => f.status === "verified");
    if (!factor) return false;
    setFactorId(factor.id);
    return true;
  };

  // Sent back here by the middleware with a password-only session: go straight to the code step.
  useEffect(() => {
    // /auth/callback sends people here when an email link was invalid, expired or opened on another device.
    if (new URLSearchParams(window.location.search).get("error") === "auth")
      toast.error("That link is invalid or has expired", { description: "Request a new one, or log in if your account is already verified." });
    needsSecondStep().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) { toast.error("Enter the 6-digit code from your authenticator app"); return; }
    setLoading(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      toast.error("That code didn't work", { description: error.message });
      setCode("");
      setLoading(false);
      return;
    }
    await goToDashboard();
  };

  const resendConfirmation = async () => {
    if (captchaEnabled && !captchaToken) { toast.error("Please complete the bot check"); return; }
    setResending(true);
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, captchaToken: captchaToken ?? undefined },
    });
    if (captchaEnabled) setCaptchaKey((k) => k + 1);
    setResending(false);
    if (error) toast.error("Could not resend the email", { description: error.message });
    else toast.success("Verification email sent", { description: `Check ${email}, including the Spam folder.` });
  };

  const cancelSecondStep = async () => {
    await createClient().auth.signOut();
    setFactorId(null); setCode(""); setPassword("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (captchaEnabled && !captchaToken) {
      toast.error("Please complete the bot check");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email, password, options: { captchaToken: captchaToken ?? undefined },
    });
    // Captcha tokens are single-use.
    if (captchaEnabled) setCaptchaKey((k) => k + 1);

    if (error) {
      const notConfirmed = error.code === "email_not_confirmed" || /not confirmed/i.test(error.message);
      setUnconfirmed(notConfirmed);
      toast.error("Login failed", {
        description: notConfirmed ? "Your email isn't verified yet. Open the link we emailed you, or resend it below." : error.message,
      });
      setLoading(false);
      return;
    }

    // Credentials are confirmed valid at this point (before any 2FA step, which
    // doesn't involve the password), so update/save them now.
    rememberCredential(email, password);

    if (await needsSecondStep()) {
      setLoading(false);
      return;
    }
    await goToDashboard();
  };

  return (
    <Layout>
      <div className="container flex items-center justify-center min-h-[70dvh] py-8 sm:py-12">
        <Card className="w-full max-w-md animate-scale-in overflow-hidden">
          <div className="h-1.5 bg-gradient-primary" />
          <CardHeader className="text-center pt-6">
            <div className="flex justify-center mb-3">
              <div className="h-14 w-14 rounded-full bg-orange-100 flex items-center justify-center">
                <GraduationCap className="h-7 w-7 text-orange-600" />
              </div>
            </div>
            <CardTitle className="font-display text-2xl">
              {isAdmin ? "Admin Login" : "Student Login"}
            </CardTitle>
            <CardDescription>Enter your credentials to access the system.</CardDescription>
          </CardHeader>
          <CardContent>
            {factorId ? (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <p className="text-sm text-muted-foreground">Open your authenticator app and enter the 6-digit code for this account.</p>
                <div>
                  <Label>Authentication code</Label>
                  <Input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="123456"
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                </div>
                <Button type="submit" className="w-full bg-gradient-primary shadow-primary" disabled={loading || code.length !== 6}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Verify
                </Button>
                <button type="button" onClick={cancelSecondStep} className="w-full text-sm text-muted-foreground hover:underline">Cancel and sign out</button>
              </form>
            ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  required
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setUnconfirmed(false); }}
                />
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <Label>Password</Label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {unconfirmed && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
                  Your email isn&apos;t verified yet.{" "}
                  <button type="button" onClick={resendConfirmation} disabled={resending} className="font-medium text-primary hover:underline disabled:opacity-50">
                    {resending ? "Sending…" : "Resend verification email"}
                  </button>
                </div>
              )}
              <Captcha key={captchaKey} onToken={setCaptchaToken} />
              <Button type="submit" className="w-full bg-gradient-primary shadow-primary" disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : isAdmin ? (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                Sign In
              </Button>
            </form>
            )}
            <div className="mt-4 text-center space-y-2">
              <button
                onClick={() => setIsAdmin(!isAdmin)}
                className="text-sm text-primary hover:underline"
              >
                {isAdmin ? "Login as Student" : "Login as Admin"}
              </button>
              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link href="/register" className="text-primary hover:underline">
                  Register here
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
