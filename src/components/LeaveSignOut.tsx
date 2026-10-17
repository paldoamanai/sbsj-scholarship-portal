"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Signs the person out once they have left the website: closed every tab of it, or the browser.
// A tab remembers (sessionStorage) that it has been on the site, so refreshes and in-site navigation
// keep the session. A tab without that mark asks the site's other open tabs whether any is still
// there; if none answers, the visitor had left, and the session they come back with is ended.

const TAB_KEY = "sbsj-tab-active";
const CHANNEL = "sbsj-presence";
const ANSWER_MS = 400;
// A sign-in this recent is a fresh one (an email confirmation or reset link opened in a new tab), not a return.
const FRESH_SIGN_IN_MS = 5 * 60 * 1000;
// Pages that sign the person in from a link; the guard leaves them alone.
const SKIP = ["/auth/", "/reset-password"];
const PROTECTED = ["/student-dashboard", "/admin"];

function markTab() {
  try { sessionStorage.setItem(TAB_KEY, "1"); } catch { /* storage blocked */ }
}
function tabWasHere() {
  try { return sessionStorage.getItem(TAB_KEY) === "1"; } catch { return true; }
}

/** Resolves true if another open tab of the site answers. */
function anotherTabOpen(channel: BroadcastChannel) {
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { channel.removeEventListener("message", onMsg); resolve(false); }, ANSWER_MS);
    const onMsg = (e: MessageEvent) => {
      if (e.data !== "here") return;
      clearTimeout(t);
      channel.removeEventListener("message", onMsg);
      resolve(true);
    };
    channel.addEventListener("message", onMsg);
    channel.postMessage("anyone");
  });
}

export default function LeaveSignOut() {
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    // Answer other tabs that are checking whether the site is still open.
    const answer = (e: MessageEvent) => { if (e.data === "anyone" && tabWasHere()) channel.postMessage("here"); };
    channel.addEventListener("message", answer);

    const check = async () => {
      const path = window.location.pathname;
      if (tabWasHere() || SKIP.some((p) => path.startsWith(p))) { markTab(); return; }

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const lastSignIn = session?.user.last_sign_in_at ? new Date(session.user.last_sign_in_at).getTime() : 0;
      if (!session || Date.now() - lastSignIn < FRESH_SIGN_IN_MS || await anotherTabOpen(channel)) { markTab(); return; }

      // Only this browser's session; the person stays signed in on their other devices.
      await supabase.auth.signOut({ scope: "local" });
      markTab();
      if (PROTECTED.some((p) => path.startsWith(p))) window.location.replace("/login");
      else window.location.reload();
    };
    void check();

    return () => { channel.removeEventListener("message", answer); channel.close(); };
  }, []);

  return null;
}
