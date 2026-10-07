"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isAdminRole } from "@/lib/settings";

/** Whether someone is signed in (false until known). */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setSignedIn(!!data.user)).catch(() => {});
  }, []);
  return signedIn;
}

/** Whether someone is signed in, and which dashboard is theirs (staff go to /admin). */
export function useAccountLink() {
  const [account, setAccount] = useState({ signedIn: false, dashboardHref: "/student-dashboard" });
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser()
      .then(async ({ data }) => {
        if (!data.user) return;
        setAccount({ signedIn: true, dashboardHref: "/student-dashboard" });
        const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
        if (isAdminRole(role?.role)) setAccount({ signedIn: true, dashboardHref: "/admin" });
      })
      .catch(() => {});
  }, []);
  return account;
}
