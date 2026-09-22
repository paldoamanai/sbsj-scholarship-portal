"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSignedIn } from "@/hooks/use-signed-in";

/** Landing-page helpers that appear after scrolling: a mobile "Apply Now" bar and a back-to-top button. */
export default function FloatingActions() {
  const router = useRouter();
  const signedIn = useSignedIn();
  const [scrolled, setScrolled] = useState(false);
  const [nearEnd, setNearEnd] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 600);
      // Step aside over the footer so its links and copyright stay readable.
      setNearEnd(window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 420);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 ${
          scrolled && !nearEnd ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <Button
          onClick={() => router.push(signedIn ? "/student-dashboard?section=application" : "/register")}
          className="w-full h-11 bg-gradient-primary shadow-primary cursor-pointer"
        >
          {signedIn ? "Go to My Application" : "Apply Now"} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <button
        type="button"
        aria-label="Back to top"
        tabIndex={scrolled && !nearEnd ? 0 : -1}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className={`fixed right-4 bottom-24 md:bottom-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all duration-300 cursor-pointer hover:bg-primary/90 ${
          scrolled && !nearEnd ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-3"
        }`}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </>
  );
}
