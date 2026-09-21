"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseSettings, SETTING_DEFAULTS, type AppSettings } from "@/lib/settings";

/** Loads the public system settings (readable by everyone) and falls back to defaults. */
export function useSystemSettings() {
  const [settings, setSettings] = useState<AppSettings>(SETTING_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("system_settings")
      .select("key, value")
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setSettings(parseSettings(data));
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  return { settings, loaded };
}
