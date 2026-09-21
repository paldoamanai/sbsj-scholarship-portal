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
import { isAdminRole } from "@/lib/settings";

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

  const cancelSecondStep = async () => {
    await createClient().auth.signOut();
    setFactorId(null); setCode(""); setPassword("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error("Login failed", { description: error.message });
      setLoading(false);
      return;
    }

    if (await needsSecondStep()) {
      setLoading(false);
      return;
    }
    await goToDashboard();
  };

  return (
    <Layout>
      <div className="container flex items-center justify-center min-h-[70vh] py-12">
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
                  required
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              </div>
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
