"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { isStaffRole } from "@/lib/permissions";
import { deviceId, deviceLabel, sessionIdOf } from "@/lib/device";

// After each sign-in (once the two-factor step, if any, is done):
//   * records this browser as one of the account's devices; the database notifies the person the
//     first time an account is used on a new one (migration 075)
//   * staff: ends their sessions on every other device, so a staff account is used on one device at a time
// While a staff member is signed in it also checks now and then that this session still exists, so a
// device signed out by a newer sign-in elsewhere goes to the login page instead of failing quietly.

const CHECK_EVERY_MS = 60 * 1000;
const SKIP = ["/auth/", "/reset-password"];
const notedKey = (sid: string) => `sbsj-signin-noted-${sid}`;

export default function AccountWatch() {
  useEffect(() => {
    if (SKIP.some((p) => window.location.pathname.startsWith(p))) return;
    const supabase = createClient();
    let staff = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let leaving = false;

    const signedOutElsewhere = async () => {
      if (leaving) return;
      leaving = true;
      await supabase.auth.signOut({ scope: "local" });
      window.location.replace("/login?reason=other_device");
    };

    // The session is gone (signed out from another device) when Supabase Auth no longer accepts it.
    const checkStillSignedIn = async () => {
      if (!staff || document.visibilityState !== "visible") return;
      const { error } = await supabase.auth.getUser();
      if (error && (error.status === 401 || error.status === 403)) void signedOutElsewhere();
    };

    const onSignedIn = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      // Wait for the code step; this runs again once it's done (MFA_CHALLENGE_VERIFIED).
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") return;

      const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle();
      staff = isStaffRole((role as { role?: string } | null)?.role);

      const sid = sessionIdOf(session.access_token);
      let noted = false;
      try { noted = !!sid && localStorage.getItem(notedKey(sid)) === "1"; } catch { /* storage blocked */ }
      if (sid && !noted) {
        try { localStorage.setItem(notedKey(sid), "1"); } catch { /* storage blocked */ }
        // Older databases don't have note_sign_in yet; that only skips the alert.
        await supabase.rpc("note_sign_in", { _device_id: deviceId(), _label: deviceLabel() });
        if (staff) await supabase.auth.signOut({ scope: "others" });
      }

      if (staff && !timer) timer = setInterval(checkStillSignedIn, CHECK_EVERY_MS);
    };

    void onSignedIn();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "MFA_CHALLENGE_VERIFIED") void onSignedIn();
      if (event === "SIGNED_OUT" && timer) { clearInterval(timer); timer = null; staff = false; }
    });
    const onVisible = () => { void checkStillSignedIn(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
