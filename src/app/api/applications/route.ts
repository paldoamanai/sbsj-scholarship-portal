import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applicationsBlockedReason, parseSettings } from "@/lib/settings";
import { isAdminRole } from "@/lib/settings";
import { submitApplicationSchema } from "@/validations/application";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  let query = supabase
    .from("applications")
    .select("*, scholarships(name, description, amount)")
    .order("created_at", { ascending: false });

  if (!isAdminRole(roleData?.role)) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = submitApplicationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid application", code: "VALIDATION" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const { data: settingRows } = await supabase.from("system_settings").select("key, value");
  const settings = parseSettings(settingRows);

  const blocked = applicationsBlockedReason(settings);
  if (blocked) {
    return NextResponse.json(
      { error: blocked, code: settings.maintenance_mode ? "MAINTENANCE" : "APPLICATIONS_CLOSED" },
      { status: 503 }
    );
  }

  // ── One application per program per year ──
  // Students may apply to (and be approved for) every open program; each program decides on its own.
  // UTC year, matching the database trigger and the dashboard.
  const currentYear = new Date().getUTCFullYear();
  const yearStart = `${currentYear}-01-01T00:00:00.000Z`;
  const yearEnd   = `${currentYear + 1}-01-01T00:00:00.000Z`;

  const { data: yearApps, error: checkError } = await supabase
    .from("applications")
    .select("scholarship_id")
    .eq("user_id", user.id)
    .neq("status", "Withdrawn")
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd);

  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }

  if (yearApps?.some((a) => a.scholarship_id === input.scholarship_id)) {
    return NextResponse.json(
      { error: "You have already applied to this program this year.", code: "ALREADY_APPLIED" },
      { status: 409 }
    );
  }
  // Minimum grade, application window, required documents, renewal rules and the same check are also
  // enforced by a database trigger, which is what actually protects the table.

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      scholarship_id: input.scholarship_id,
      certified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    // P0001 = RAISE EXCEPTION from the scholarship rules trigger (closed, past deadline, full).
    if (error.code === "P0001") {
      return NextResponse.json({ error: error.message, code: "APPLICATION_RULE" }, { status: 409 });
    }
    // 42501 = row-level security: an account with 2FA enrolled that hasn't completed it this session.
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "Complete two-factor verification (sign out and back in), then try again.", code: "MFA_REQUIRED" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
