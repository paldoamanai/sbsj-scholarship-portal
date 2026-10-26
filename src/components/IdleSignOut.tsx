"use client";

import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// Signs the person out after a stretch with no activity (mouse, keys, touch, scrolling) in any tab of
// the site, with a minute's warning first. Tabs share the last activity time through localStorage, so
// working in one tab keeps the others signed in, and a sign-out in one ends the others.

export const IDLE_MINUTES = 30;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const WARN_MS = 60 * 1000;
const ACTIVITY_KEY = "sbsj-last-activity";
const SIGNED_OUT_KEY = "sbsj-idle-signed-out";
// Writing the time on every mouse move would be wasteful; this often is plenty.
const WRITE_EVERY_MS = 5000;
const CHECK_EVERY_MS = 1000;
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
// Pages that sign the person in from a link; the timer leaves them alone.
const SKIP = ["/auth/", "/reset-password"];

const now = () => Date.now();
function readActivity() {
  try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0; } catch { return 0; }
}
function writeActivity(t: number) {
  try { localStorage.setItem(ACTIVITY_KEY, String(t)); } catch { /* storage blocked */ }
}

export default function IdleSignOut() {
  const [signedIn, setSignedIn] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const last = useRef(now());
  const lastWrite = useRef(0);
  const warning = useRef(false);
  const signingOut = useRef(false);
  // "Stay signed in": set by the timer effect, which owns the activity state.
  const stayRef = useRef<() => void>(() => {});

  // Only runs while someone is signed in.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setSignedIn(!!session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!signedIn || SKIP.some((p) => window.location.pathname.startsWith(p))) return;

    // A fresh start counts as activity, and so does whatever another tab recorded more recently.
    last.current = Math.max(now(), readActivity());
    writeActivity(last.current);

    const touch = (force = false) => {
      const t = now();
      last.current = t;
      if (force || t - lastWrite.current > WRITE_EVERY_MS) { lastWrite.current = t; writeActivity(t); }
    };
    // While the warning is up, only "Stay signed in" keeps the session, so a stray mouse move doesn't.
    const onActivity = () => { if (!warning.current) touch(); };

    const signOut = async () => {
      if (signingOut.current) return;
      signingOut.current = true;
      try { localStorage.setItem(SIGNED_OUT_KEY, String(now())); } catch { /* ignore */ }
      await createClient().auth.signOut({ scope: "local" });
      window.location.replace("/login?reason=idle");
    };

    const check = () => {
      const idle = now() - Math.max(last.current, readActivity());
      if (idle >= IDLE_MS) { void signOut(); return; }
      const showWarning = idle >= IDLE_MS - WARN_MS;
      warning.current = showWarning;
      setSecondsLeft(showWarning ? Math.ceil((IDLE_MS - idle) / 1000) : null);
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNED_OUT_KEY && !signingOut.current) { signingOut.current = true; window.location.replace("/login?reason=idle"); }
      if (e.key === ACTIVITY_KEY) check();
    };
    // Timers slow down in background tabs; look again as soon as the tab is back.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };

    EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    stayRef.current = () => { warning.current = false; touch(true); check(); };

    return () => {
      EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
      warning.current = false;
      setSecondsLeft(null);
    };
  }, [signedIn]);

  const stay = () => stayRef.current();
  const signOutNow = async () => {
    signingOut.current = true;
    try { localStorage.setItem(SIGNED_OUT_KEY, String(now())); } catch { /* ignore */ }
    await createClient().auth.signOut({ scope: "local" });
    window.location.replace("/login");
  };

  return (
    <AppDialog open={secondsLeft != null} onOpenChange={(o) => { if (!o) stay(); }} size="sm" className="rounded-2xl"
      title="Are you still there?"
      description={`For your security, you'll be signed out in ${secondsLeft ?? 0} second${secondsLeft === 1 ? "" : "s"} because there's been no activity for ${IDLE_MINUTES - 1} minutes.`}
      footer={<>
        <Button variant="outline" className="rounded-xl" onClick={signOutNow}>Sign out</Button>
        <Button className="rounded-xl" onClick={stay} autoFocus>Stay signed in</Button>
      </>}>
      <p className="text-sm text-muted-foreground">Anything you haven&apos;t saved will be lost if you&apos;re signed out.</p>
    </AppDialog>
  );
}
