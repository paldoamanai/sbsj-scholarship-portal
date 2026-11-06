import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/admin-api";
import { minutesText, rateLimit, visitorKey } from "@/lib/rate-limit";

// Signs in with email and password on the server, so the limits can't be skipped from the browser:
//   * account lock: after MAX_FAILURES wrong passwords in a row, that account can't sign in for
//     LOCK_MINUTES (counted from the last wrong one). Kept in login_failures (migration 083).
//   * visitor limit: at most IP_MAX attempts per IP_WINDOW from one visitor, whatever the account
//     (rate_limit_hits, migration 092), against someone trying many accounts.
//   * the bot check (Turnstile), when it's on, is passed through to Supabase.
// On success the session cookies are set on the response; the page carries on (role checks, 2FA) with
// the browser client, which reads them.
// Without the service role or the migrations, the limits are skipped, never the login.
//
//   POST { email, password, captchaToken? }
//   200 { ok: true }
//   401 { error, code, attemptsLeft?, lockMinutes? }   wrong email or password (or another sign-in error)
//   429 { error, retryAt? }                             locked out or too many attempts

const MAX_FAILURES = 3;
const LOCK_MINUTES = 10;
const LOCK_MS = LOCK_MINUTES * 60 * 1000;
const IP_MAX = 30;
const IP_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const captchaToken = typeof body?.captchaToken === "string" && body.captchaToken ? body.captchaToken : undefined;
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password", code: "bad_request" }, { status: 400 });

  const admin = serviceClient();

  // Per visitor, across accounts.
  const visitor = await rateLimit(admin, "login-ip", visitorKey(request), IP_MAX, IP_WINDOW_MS);
  if (visitor.ok === false) {
    return NextResponse.json({ error: `Too many login attempts from this device. Try again in ${minutesText(visitor.retryAfterSec)}.` }, { status: 429 });
  }

  // Per account.
  const recentFailures = async () => {
    if (!admin) return null;
    const { data, error } = await admin.from("login_failures").select("failed_at")
      .eq("email", email).gt("failed_at", new Date(Date.now() - LOCK_MS).toISOString())
      .order("failed_at", { ascending: false });
    if (error) { console.error("login lockout:", error.message); return null; }
    return data;
  };
  const lockedResponse = (failures: { failed_at: string }[] | null) => {
    const until = failures && failures.length >= MAX_FAILURES ? new Date(failures[0].failed_at).getTime() + LOCK_MS : 0;
    if (until <= Date.now()) return null;
    return NextResponse.json({
      error: `Too many failed login attempts. Try again in ${minutesText((until - Date.now()) / 1000)}.`,
      retryAt: new Date(until).toISOString(),
    }, { status: 429 });
  };
  const before = await recentFailures();
  const locked = lockedResponse(before);
  if (locked) return locked;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });

  if (error) {
    // Only a wrong email or password counts toward the account lock.
    if (error.code === "invalid_credentials" && admin) {
      const { error: insErr } = await admin.from("login_failures").insert({ email });
      if (insErr) console.error("login lockout:", insErr.message);
      else void admin.from("login_failures").delete().lt("failed_at", new Date(Date.now() - 86400000).toISOString()).then(() => undefined);
      const after = await recentFailures();
      const nowLocked = lockedResponse(after);
      if (nowLocked) return nowLocked;
      return NextResponse.json({
        error: error.message, code: error.code,
        attemptsLeft: after ? MAX_FAILURES - after.length : undefined, lockMinutes: LOCK_MINUTES,
      }, { status: 401 });
    }
    return NextResponse.json({ error: error.message, code: error.code ?? "sign_in_failed" }, { status: error.status === 429 ? 429 : 401 });
  }

  if (admin) await admin.from("login_failures").delete().eq("email", email);
  return NextResponse.json({ ok: true });
}
