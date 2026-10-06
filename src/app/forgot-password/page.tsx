"use client";

import { useState } from "react";
import Link from "next/link";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Captcha, { captchaEnabled } from "@/components/Captcha";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error("Enter a valid email address"); return; }
    if (captchaEnabled && !captchaToken) { toast.error("Please complete the bot check"); return; }
    setLoading(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      captchaToken: captchaToken ?? undefined,
    });
    if (captchaEnabled) setCaptchaKey((k) => k + 1);
    setLoading(false);
    // Don't reveal whether the email has an account; only real failures (rate limit, captcha) are shown.
    if (error) { toast.error("Could not send the reset email", { description: error.message }); return; }
    setSent(true);
  };

  return (
    <Layout>
      <div className="container flex items-center justify-center min-h-[70dvh] py-8 sm:py-12">
        <Card className="w-full max-w-md animate-scale-in overflow-hidden">
          <div className="h-1.5 bg-gradient-primary" />
          <CardHeader className="text-center pt-6">
            <div className="flex justify-center mb-3">
              <div className="h-14 w-14 rounded-full bg-orange-100 flex items-center justify-center">
                {sent ? <MailCheck className="h-7 w-7 text-orange-600" /> : <KeyRound className="h-7 w-7 text-orange-600" />}
              </div>
            </div>
            <CardTitle className="font-display text-2xl">{sent ? "Check your email" : "Forgot password"}</CardTitle>
            <CardDescription>
              {sent
                ? <>If an account exists for <span className="font-medium text-foreground break-all">{email.trim()}</span>, we sent a link to set a new password. It expires in one hour.</>
                : "Enter the email you registered with and we'll send you a link to set a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-3">
                <Button asChild className="w-full bg-gradient-primary shadow-primary"><Link href="/login">Back to Login</Link></Button>
                <button type="button" onClick={() => setSent(false)} className="w-full text-sm text-muted-foreground hover:underline">
                  Didn&apos;t get it? Try again
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required autoFocus
                    placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Captcha key={captchaKey} onToken={setCaptchaToken} />
                <Button type="submit" className="w-full bg-gradient-primary shadow-primary" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Remembered it? <Link href="/login" className="text-primary hover:underline">Log in</Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
