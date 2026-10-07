"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile bot check for the auth forms. Turned on by setting NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * and enabling CAPTCHA protection (provider: Turnstile, same site's secret key) in Supabase → Auth →
 * Attack Protection. Supabase then requires the token on sign up, sign in, password reset and resend.
 * Without the env var this renders nothing and the forms work as before.
 *
 * A token is single-use: remount (change `key`) after each attempt to get a fresh one.
 */

export const CAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const captchaEnabled = CAPTCHA_SITE_KEY !== "";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error("Could not load the bot check")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export default function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!captchaEnabled) return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: CAPTCHA_SITE_KEY,
          callback: (t: string) => cb.current(t),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      cb.current(null);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (!captchaEnabled) return null;
  return <div ref={ref} className="flex justify-center min-h-[65px]" />;
}
