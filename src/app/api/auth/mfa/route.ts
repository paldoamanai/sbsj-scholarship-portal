import { NextResponse } from "next/server";
import { MAX_TRIES, clientKey, notifyPaused, pausedFor, pausedMessage, recordTry, visitorAuthClient } from "@/lib/login-lockout";

// The two-factor code at sign-in, through the server so wrong codes are counted like wrong passwords
// (migration 077). Takes the browser's password-only session and returns the upgraded one.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { access_token?: unknown; refresh_token?: unknown; factorId?: unknown; code?: unknown } | null;
  const access_token = typeof body?.access_token === "string" ? body.access_token : "";
  const refresh_token = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  const factorId = typeof body?.factorId === "string" ? body.factorId : "";
  const code = typeof body?.code === "string" ? body.code : "";
  if (!access_token || !refresh_token || !factorId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app" }, { status: 400 });
  }

  const client = clientKey(request);
  const supabase = visitorAuthClient(client);
  const { data: set, error: setError } = await supabase.auth.setSession({ access_token, refresh_token });
  const email = set.user?.email?.toLowerCase();
  if (setError || !email) return NextResponse.json({ error: "Your sign-in expired. Enter your password again." }, { status: 401 });

  const wait = await pausedFor(email, client, "mfa");
  if (wait > 0) return NextResponse.json({ error: pausedMessage(wait), code: "paused", retryAfter: wait }, { status: 429 });

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    const wrong = error.code === "mfa_verification_failed" || /invalid|incorrect/i.test(error.message);
    if (!wrong) return NextResponse.json({ error: error.message, code: error.code ?? null }, { status: 400 });
    const left = await recordTry(email, client, "mfa", false);
    if (left <= 0) {
      await notifyPaused(email, "mfa", client);
      const paused = await pausedFor(email, client, "mfa");
      return NextResponse.json({ error: pausedMessage(paused || 600), code: "paused", retryAfter: paused || 600 }, { status: 429 });
    }
    return NextResponse.json({
      error: `That code didn't work. ${left} attempt${left === 1 ? "" : "s"} left before sign-in is paused for 10 minutes.`,
      code: "mfa_verification_failed", attemptsLeft: Math.min(left, MAX_TRIES),
    }, { status: 401 });
  }

  await recordTry(email, client, "mfa", true);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Sign-in failed. Try again." }, { status: 500 });
  return NextResponse.json({ access_token: session.access_token, refresh_token: session.refresh_token });
}
