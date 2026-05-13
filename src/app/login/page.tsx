"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, ShieldCheck, Loader2, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    const userRole = (roleData as any)?.role || "student";
    const dest = userRole === "admin" ? "/admin" : "/student-dashboard";
    router.push(dest);
    router.refresh();
  };

  return (
    <Layout>
      <div className="container flex items-center justify-center min-h-[70vh] py-12">
        <Card className="w-full max-w-md animate-scale-in">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-2xl">
              {isAdmin ? "Admin Login" : "Student Login"}
            </CardTitle>
            <CardDescription>Enter your credentials to access the system.</CardDescription>
          </CardHeader>
          <CardContent>
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
