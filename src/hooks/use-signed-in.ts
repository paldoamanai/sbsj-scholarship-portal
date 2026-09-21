"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Whether someone is signed in (false until known). */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setSignedIn(!!data.user)).catch(() => {});
  }, []);
  return signedIn;
}
