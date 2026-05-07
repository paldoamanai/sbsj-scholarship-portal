"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, X, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const navLinks = [
  { label: "Home", path: "/" },
  { label: "About", path: "/about" },
  { label: "Scholarships", path: "/#scholarships" },
  { label: "Contact", path: "/contact" },
];

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/municipal-logo.png"
              alt="SB San Jose Logo"
              width={40}
              height={40}
              className="h-10 w-10"
            />
            <div className="hidden sm:block">
              <p className="text-sm font-semibold leading-tight text-foreground">
                SB San Jose Scholarship Portal
              </p>
              <p className="text-xs text-muted-foreground">San Jose, Occidental Mindoro</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                href={link.path}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  pathname === link.path
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-sm text-muted-foreground">
                  Hi, {user.email?.split("@")[0]}
                </span>
                <Button size="sm" variant="outline" onClick={handleLogout}>
                  <LogOut className="mr-1 h-4 w-4" /> Logout
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 ml-2">
                <Link href="/login">
                  <Button size="sm" variant="outline">
                    Login
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm" className="bg-gradient-primary shadow-primary">
                    Register
                  </Button>
                </Link>
              </div>
            )}
          </nav>

          <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen && (
          <nav className="md:hidden border-t bg-card p-4 animate-fade-in space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                href={link.path}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-2 rounded-md text-sm font-medium ${
                  pathname === link.path
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full mt-2"
                onClick={() => {
                  setMobileOpen(false);
                  handleLogout();
                }}
              >
                <LogOut className="mr-1 h-4 w-4" /> Logout
              </Button>
            ) : (
              <div className="space-y-2 mt-2">
                <Link href="/login" onClick={() => setMobileOpen(false)}>
                  <Button size="sm" variant="outline" className="w-full">
                    Login
                  </Button>
                </Link>
                <Link href="/register" onClick={() => setMobileOpen(false)}>
                  <Button size="sm" className="w-full bg-gradient-primary">
                    Register
                  </Button>
                </Link>
              </div>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
};

export default Layout;
