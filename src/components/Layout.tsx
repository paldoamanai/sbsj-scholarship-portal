"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const Layout = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const home = pathname === "/";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="relative z-40 w-full border-b bg-card">
        {/* Brand accent along the top edge */}
        <div className="h-1 bg-gradient-primary" />
        <div className="container flex h-[4.5rem] items-center justify-between gap-4">
          <Link href="/" className="group flex min-w-0 items-center gap-3">
            <Image
              src="/municipal-logo.png"
              alt="Municipality of San Jose seal"
              width={48}
              height={48}
              priority
              className="h-11 w-11 shrink-0 rounded-full shadow-md ring-2 ring-primary/15 sm:h-12 sm:w-12"
            />
            <span className="h-9 w-px shrink-0 bg-border" aria-hidden />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-primary sm:text-[11px]">
                San Jose
              </p>
              <p className="truncate font-display text-base font-bold tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-lg">
                Scholarship Portal
              </p>
            </div>
          </Link>

          {!home && (
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
