"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const Layout = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  // On the landing page the header sits over the hero photo; elsewhere it's a solid bar in the page flow.
  const overlay = pathname === "/";

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className={cn(
          "z-40 w-full",
          overlay ? "absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent" : "relative border-b bg-card"
        )}
      >
        {/* Brand accent along the top edge */}
        <div className="h-1 bg-gradient-primary" />
        <div className="container flex h-[4.5rem] items-center justify-between gap-4">
          <Link href="/" className="group flex min-w-0 items-center gap-3">
            <Image
              src="/municipal-logo.png"
              alt="SB San Jose Logo"
              width={48}
              height={48}
              priority
              className={cn(
                "h-11 w-11 shrink-0 rounded-full shadow-md sm:h-12 sm:w-12",
                overlay ? "ring-2 ring-white/50" : "ring-2 ring-primary/15"
              )}
            />
            <span className={cn("h-9 w-px shrink-0", overlay ? "bg-white/30" : "bg-border")} aria-hidden />
            <div className="min-w-0 leading-tight">
              <p
                className={cn(
                  "truncate text-[10px] font-semibold uppercase tracking-[0.2em] sm:text-[11px]",
                  overlay ? "text-orange-200" : "text-primary"
                )}
              >
                <span className="sm:hidden">SB San Jose</span>
                <span className="hidden sm:inline">Sangguniang Bayan ng San Jose</span>
              </p>
              <p
                className={cn(
                  "truncate font-display text-base font-bold tracking-tight transition-colors sm:text-lg",
                  overlay ? "text-white" : "text-foreground group-hover:text-primary"
                )}
              >
                Scholarship Portal
              </p>
            </div>
          </Link>

          {!overlay && (
            <Link
              href="/"
              aria-label="Back to home"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to home</span>
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
};

export default Layout;
