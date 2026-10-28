import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/admin-api";

// Login lockout: after MAX_FAILURES wrong passwords in a row, an account can't log in for LOCK_MINUTES
// (counted from the last wrong one). The browser signs in with Supabase itself and reports here:
//   { action: "check", email }   before signing in: 429 while locked
//   { action: "failed", email }  after a wrong email or password: how many tries are left, or 429
//   { action: "success" }        after signing in, with the session's bearer token: clears the count
// Failures are kept in login_failures (migration 083) so the lock holds across devices and server
// instances. Without the service role or the migration, the lockout is skipped, never the login.

const MAX_FAILURES = 3;
const LOCK_MINUTES = 10;
const LOCK_MS = LOCK_MINUTES * 60 * 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: true });

  if (action === "success") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (user?.email) await admin.from("login_failures").delete().eq("email", user.email.toLowerCase());
    return NextResponse.json({ ok: true });
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email || (action !== "check" && action !== "failed")) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  if (action === "failed") {
    const { error } = await admin.from("login_failures").insert({ email });
    if (error) { console.error("login lockout:", error.message); return NextResponse.json({ ok: true }); }
    await admin.from("login_failures").delete().lt("failed_at", new Date(Date.now() - 86400000).toISOString());
  }

  const { data, error } = await admin.from("login_failures").select("failed_at")
    .eq("email", email).gt("failed_at", new Date(Date.now() - LOCK_MS).toISOString())
    .order("failed_at", { ascending: false });
  if (error) { console.error("login lockout:", error.message); return NextResponse.json({ ok: true }); }

  const until = data.length >= MAX_FAILURES ? new Date(data[0].failed_at).getTime() + LOCK_MS : 0;
  if (until > Date.now()) {
    const minutes = Math.ceil((until - Date.now()) / 60000);
    return NextResponse.json({
      error: `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAt: new Date(until).toISOString(),
    }, { status: 429 });
  }
  return NextResponse.json({ ok: true, attemptsLeft: MAX_FAILURES - data.length, lockMinutes: LOCK_MINUTES });
}
