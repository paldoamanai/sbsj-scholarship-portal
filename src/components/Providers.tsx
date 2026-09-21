"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import EdgeSwipeNav from "@/components/EdgeSwipeNav";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <EdgeSwipeNav />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
