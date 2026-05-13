"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Home, Info, GraduationCap, Phone, LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const navLinks = [
  { label: "Home",         path: "/",            icon: Home },
  { label: "About",        path: "/about",        icon: Info },
  { label: "Scholarships", path: "/#scholarships", icon: GraduationCap },
  { label: "Contact",      path: "/contact",      icon: Phone },
];

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const activeLink = navLinks.find((l) => l.path === pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">

          {/* Brand */}
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

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-2">
            {user ? (
              <span className="text-sm text-muted-foreground">
                Hi, {user.email?.split("@")[0]}
              </span>
            ) : (
              <Link href="/register">
                <Button size="sm" className="bg-gradient-primary shadow-primary cursor-pointer">
                  Get Started
                </Button>
              </Link>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground data-[state=open]:bg-muted"
                  aria-label="Navigation menu"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 mt-1">
                {navLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname === link.path;
                  return (
                    <DropdownMenuItem key={link.path} asChild>
                      <Link
                        href={link.path}
                        className={`flex items-center gap-2.5 cursor-pointer ${
                          isActive ? "text-orange-700 font-semibold bg-orange-50" : ""
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? "text-orange-600" : "text-muted-foreground"}`} />
                        {link.label}
                        {isActive && (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
                {user && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="flex items-center gap-2.5 text-muted-foreground cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 cursor-pointer"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <nav className="md:hidden border-t bg-card p-4 animate-fade-in space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.path;
              return (
                <Link
                  key={link.path}
                  href={link.path}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-orange-50 text-orange-700 font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-orange-600" : "text-muted-foreground"}`} />
                  {link.label}
                </Link>
              );
            })}
            <div className="pt-2 border-t border-border/50 mt-2">
              {user ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => { setMobileOpen(false); handleLogout(); }}
                >
                  <LogOut className="mr-1 h-4 w-4" /> Logout
                </Button>
              ) : (
                <Link href="/register" onClick={() => setMobileOpen(false)}>
                  <Button size="sm" className="w-full bg-gradient-primary">
                    Get Started
                  </Button>
                </Link>
              )}
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
};

export default Layout;
