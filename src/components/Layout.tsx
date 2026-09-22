"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Home, Info, GraduationCap, Phone, LogOut, Menu, X, LayoutDashboard, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
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

const Layout = ({ children, transparentOnTop = false }: { children: React.ReactNode; transparentOnTop?: boolean }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  // On the landing page the header floats over the hero photo, then turns solid once you scroll.
  const overlay = transparentOnTop && !scrolled && !mobileOpen;
  const name = user?.email?.split("@")[0] ?? "";

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className={cn(
          "sticky top-0 z-50 transition-[background-color,box-shadow,border-color] duration-300",
          overlay
            ? "bg-gradient-to-b from-black/55 to-transparent"
            : "bg-card/90 backdrop-blur-md border-b border-border/60 shadow-sm"
        )}
      >
        <div className="container flex h-16 items-center justify-between gap-4">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <Image
              src="/municipal-logo.png"
              alt="SB San Jose Logo"
              width={40}
              height={40}
              className={cn("h-10 w-10 rounded-full transition-shadow", overlay && "ring-2 ring-white/40")}
            />
            <div className="leading-tight">
              <p className={cn("text-[15px] font-bold tracking-tight", overlay ? "text-white" : "text-foreground")}>
                SB San Jose
              </p>
              <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", overlay ? "text-white/75" : "text-primary")}>
                Scholarship Portal
              </p>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-3">
            <div
              className={cn(
                "hidden lg:flex items-center gap-1 rounded-full p-1 transition-colors",
                overlay ? "bg-white/10 backdrop-blur-md ring-1 ring-white/20" : "bg-muted/70"
              )}
            >
              {navLinks.filter((l) => l.path !== "/").map((link) => {
                const isActive = pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    href={link.path}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      overlay
                        ? isActive ? "bg-white text-foreground" : "text-white/85 hover:bg-white/15 hover:text-white"
                        : isActive ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "flex h-10 items-center gap-2 rounded-full pl-1 pr-3 text-sm font-medium cursor-pointer transition-colors data-[state=open]:bg-muted",
                      overlay ? "text-white hover:bg-white/15" : "text-foreground hover:bg-muted"
                    )}
                    aria-label="Account menu"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary text-sm font-bold uppercase text-white">
                      {name.charAt(0) || "U"}
                    </span>
                    <span className="max-w-[9rem] truncate">{name}</span>
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 mt-1">
                  {navLinks.map((link) => {
                    const Icon = link.icon;
                    const isActive = pathname === link.path;
                    return (
                      <DropdownMenuItem key={link.path} asChild className="lg:hidden">
                        <Link
                          href={link.path}
                          className={`flex items-center gap-2.5 cursor-pointer ${isActive ? "text-orange-700 font-semibold bg-orange-50" : ""}`}
                        >
                          <Icon className={`h-4 w-4 ${isActive ? "text-orange-600" : "text-muted-foreground"}`} />
                          {link.label}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator className="lg:hidden" />
                  <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2.5 cursor-pointer">
                    <LogOut className="h-4 w-4 text-muted-foreground" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                    overlay ? "text-white hover:bg-white/15" : "text-foreground hover:bg-muted"
                  )}
                >
                  Sign In
                </Link>
                <Link href="/register">
                  <Button className="h-10 rounded-full px-5 bg-gradient-primary shadow-primary cursor-pointer font-semibold">
                    Get Started
                  </Button>
                </Link>
                {/* Below lg the inline links don't fit, so they live in a menu. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-10 w-10 rounded-full lg:hidden", overlay ? "text-white hover:bg-white/15 hover:text-white" : "text-muted-foreground")}
                      aria-label="Navigation menu"
                    >
                      <Menu className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52 mt-1">
                    {navLinks.map((link) => {
                      const Icon = link.icon;
                      const isActive = pathname === link.path;
                      return (
                        <DropdownMenuItem key={link.path} asChild>
                          <Link
                            href={link.path}
                            className={`flex items-center gap-2.5 cursor-pointer ${isActive ? "text-orange-700 font-semibold bg-orange-50" : ""}`}
                          >
                            <Icon className={`h-4 w-4 ${isActive ? "text-orange-600" : "text-muted-foreground"}`} />
                            {link.label}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </nav>

          {/* Mobile */}
          <div className="md:hidden flex items-center gap-1">
            {!user && (
              <Link
                href="/login"
                className={cn("inline-flex h-11 items-center px-3 text-sm font-semibold", overlay ? "text-white" : "text-primary")}
              >
                Sign In
              </Link>
            )}
            <button
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full cursor-pointer transition-colors",
                overlay ? "text-white hover:bg-white/15" : "hover:bg-muted"
              )}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
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
            <div className="pt-2 border-t border-border/50 mt-2 space-y-2">
              {user ? (
                <>
                  <Link href="/student-dashboard" onClick={() => setMobileOpen(false)}>
                    <Button size="sm" variant="outline" className="w-full">
                      <LayoutDashboard className="mr-1 h-4 w-4" /> Dashboard
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => { setMobileOpen(false); handleLogout(); }}
                  >
                    <LogOut className="mr-1 h-4 w-4" /> Logout
                  </Button>
                </>
              ) : (
                <>
                  <Link href="/login" onClick={() => setMobileOpen(false)}>
                    <Button size="sm" variant="outline" className="w-full">
                      Sign In
                    </Button>
                  </Link>
                  <Link href="/register" onClick={() => setMobileOpen(false)}>
                    <Button size="sm" className="w-full bg-gradient-primary">
                      Get Started
                    </Button>
                  </Link>
                </>
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
