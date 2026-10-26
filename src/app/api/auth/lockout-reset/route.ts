import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearTries } from "@/lib/login-lockout";

// After a password reset: the new password starts a fresh count of failed tries (migration 077).
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearTries(user.email.toLowerCase());
  return NextResponse.json({ ok: true });
}
