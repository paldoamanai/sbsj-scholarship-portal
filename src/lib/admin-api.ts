import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

// Server-only helpers shared by the /api/admin routes, which act on accounts through Supabase Auth's admin API.

/** A Supabase client with the service role, or null when SUPABASE_SERVICE_ROLE_KEY isn't set. */
export function serviceClient(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createServiceClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The configured site URL, unless it points at localhost while the request came from a real domain
// (an .env copied to the server): that link would only open on the developer's own machine.
const isLocal = (url: string) => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
export function siteUrl(request: Request) {
  const origin = new URL(request.url).origin;
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return configured && !(isLocal(configured) && !isLocal(origin)) ? configured : origin;
}

export type Sent = { emailed: true } | { emailed: false; reason: string };

/** Emails a sign-in link through Resend. When it can't, says why, so the super admin can share the link instead. */
export async function sendLinkEmail(to: string, subject: string, intro: string, link: string, button: string): Promise<Sent> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { emailed: false, reason: "Email isn't set up on this portal (RESEND_API_KEY is missing)." };
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="margin:0 0 12px;color:#111">${escapeHtml(subject)}</h2>
      <p style="margin:0 0 20px;color:#444;line-height:1.5">${escapeHtml(intro)}</p>
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a>
      <p style="margin:20px 0 0;color:#888;font-size:12px">This link works once. If you weren't expecting it, ignore this email.</p>
    </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "San Jose Scholarship <onboarding@resend.dev>", to, subject, html }),
  }).catch(() => null);
  if (res?.ok) return { emailed: true };
  // Resend explains itself, e.g. its test sender only delivers to the Resend account owner.
  const detail = await res?.json().then((b: { message?: string }) => b?.message).catch(() => null);
  return { emailed: false, reason: `The email could not be sent${detail ? `: ${detail}` : "."}` };
}

/** What the API returns after creating a link: the link itself only when it wasn't emailed. */
export const linkResult = (sent: Sent, link: string) =>
  sent.emailed ? { ok: true, emailed: true, link: null } : { ok: true, emailed: false, link, reason: sent.reason };

