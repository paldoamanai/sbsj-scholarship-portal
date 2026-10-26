import { NextResponse } from "next/server";
import { MAX_TRIES, clientKey, notifyPaused, pausedFor, pausedMessage, recordTry, visitorAuthClient } from "@/lib/login-lockout";

// Password sign-in, through the server so failed tries can be counted (migration 077). The session goes
// back to the browser, which stores it with supabase.auth.setSession().
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown; captchaToken?: unknown; verifyOnly?: unknown } | null;
  // "Change password" checks the current one the same way, counted, without starting a new session.
  const verifyOnly = body?.verifyOnly === true;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const captchaToken = typeof body?.captchaToken === "string" ? body.captchaToken : undefined;
  if (!email || !password || email.length > 254 || password.length > 200) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  }

  const client = clientKey(request);
  const wait = await pausedFor(email, client, "password");
  if (wait > 0) {
    return NextResponse.json({ error: pausedMessage(wait), code: "paused", retryAfter: wait }, { status: 429, headers: { "Retry-After": String(wait) } });
  }

  const auth = visitorAuthClient(client).auth;
  const { data, error } = await auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error || !data.session) {
    // Only a wrong email or password counts; an unverified email, a failed bot check or Supabase's own
    // rate limit don't.
    if (error?.code === "invalid_credentials" || /invalid login credentials/i.test(error?.message ?? "")) {
      const left = await recordTry(email, client, "password", false);
      if (left <= 0) {
        await notifyPaused(email, "password", client);
        const paused = await pausedFor(email, client, "password");
        return NextResponse.json({ error: pausedMessage(paused || 600), code: "paused", retryAfter: paused || 600 }, { status: 429 });
      }
      return NextResponse.json({
        error: left < MAX_TRIES ? `Wrong email or password. ${left} attempt${left === 1 ? "" : "s"} left before sign-in is paused for 10 minutes.` : "Wrong email or password.",
        code: "invalid_credentials", attemptsLeft: left,
      }, { status: 401 });
    }
    return NextResponse.json({ error: error?.message ?? "Sign-in failed", code: error?.code ?? null }, { status: error?.status && error.status >= 400 ? error.status : 400 });
  }

  await recordTry(email, client, "password", true);
  if (verifyOnly) {
    // Ends only this check's own session; the person's other sessions are untouched.
    await auth.signOut({ scope: "local" });
    return NextResponse.json({ verified: true });
  }
  return NextResponse.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
