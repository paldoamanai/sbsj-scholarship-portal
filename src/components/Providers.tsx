"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import EdgeSwipeNav from "@/components/EdgeSwipeNav";
import LeaveSignOut from "@/components/LeaveSignOut";
import IdleSignOut from "@/components/IdleSignOut";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <EdgeSwipeNav />
        <LeaveSignOut />
        <IdleSignOut />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
