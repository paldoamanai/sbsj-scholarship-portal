import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/admin-api";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { isStaffRole } from "@/lib/permissions";

// Server-only. Three failed sign-in tries (or two-factor codes) for an email from one network within
// 10 minutes pause that step for 10 minutes (migration 077). If the database or service key isn't
// there, sign-in still works, without the pause.

export type AttemptKind = "password" | "mfa";
export const MAX_TRIES = 3;
export const PAUSE_MINUTES = 10;

/** The visitor's network: their IP address as Vercel reports it. */
export function clientKey(request: Request) {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || "unknown";
}

/**
 * A Supabase client for one visitor's sign-in. Nothing is stored on the server; the session goes back
 * to their browser. Their IP is passed on, so Supabase's own per-IP limits apply to them, not to the
 * portal's server.
 */
export function visitorAuthClient(ip: string): SupabaseClient {
  return createClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: ip !== "unknown" ? { "X-Forwarded-For": ip } : {} },
  });
}

export async function pausedFor(email: string, client: string, kind: AttemptKind): Promise<number> {
  const svc = serviceClient();
  if (!svc) return 0;
  const { data, error } = await svc.rpc("login_lock_seconds", { _email: email, _client: client, _kind: kind });
  if (error) { console.error("login_lock_seconds", error.message); return 0; }
  return Number(data) || 0;
}

/** Records a try; returns the tries left before a pause (MAX_TRIES when it can't tell). */
export async function recordTry(email: string, client: string, kind: AttemptKind, ok: boolean): Promise<number> {
  const svc = serviceClient();
  if (!svc) return MAX_TRIES;
  const { data, error } = await svc.rpc("record_login_attempt", { _email: email, _client: client, _kind: kind, _ok: ok });
  if (error) { console.error("record_login_attempt", error.message); return MAX_TRIES; }
  return Number(data);
}

/** Starts the count again everywhere (after a password reset). */
export async function clearTries(email: string) {
  const svc = serviceClient();
  if (!svc) return;
  for (const kind of ["password", "mfa"] as const) {
    await svc.rpc("record_login_attempt", { _email: email, _client: "*", _kind: kind, _ok: true });
  }
}

/** Tells the account's owner (if the email has one) that sign-in was paused; staff pauses are audited. */
export async function notifyPaused(email: string, kind: AttemptKind, client: string) {
  const svc = serviceClient();
  if (!svc) return;
  const { data: profile } = await svc.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (!profile) return;
  const { data: role } = await svc.from("user_roles").select("role").eq("user_id", profile.id).maybeSingle();
  const staff = isStaffRole((role as { role?: string } | null)?.role);
  const what = kind === "password" ? "wrong passwords" : "wrong two-factor codes";
  await svc.from("notifications").insert({
    user_id: profile.id,
    title: "Sign-in paused after failed attempts",
    message: `Someone entered ${MAX_TRIES} ${what} for your account, so sign-in was paused for ${PAUSE_MINUTES} minutes. `
      + (kind === "password" ? "If this wasn't you, change your password." : "Someone may know your password: change it now."),
    type: "warning",
    category: "account",
    link: staff ? "/admin?section=profile" : "/student-dashboard?section=profile",
  });
  if (staff) {
    await svc.from("audit_logs").insert({
      user_id: profile.id, user_email: email, action: kind === "password" ? "sign_in_paused" : "two_factor_paused",
      entity_type: "auth", entity_id: profile.id, new_value: { network: client, tries: MAX_TRIES },
    });
  }
}

export const pausedMessage = (seconds: number) =>
  `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute${seconds > 60 ? "s" : ""}, or reset your password.`;
