import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applicationsBlockedReason, parseSettings } from "@/lib/settings";

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

  if (roleData?.role !== "admin") {
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

  const body = await request.json();

  const { data: settingRows } = await supabase.from("system_settings").select("key, value");
  const settings = parseSettings(settingRows);

  const blocked = applicationsBlockedReason(settings);
  if (blocked) {
    return NextResponse.json(
      { error: blocked, code: settings.maintenance_mode ? "MAINTENANCE" : "APPLICATIONS_CLOSED" },
      { status: 503 }
    );
  }

  // ── Per-year limit (max_scholarships_per_student, default 1) ──
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01T00:00:00.000Z`;
  const yearEnd   = `${currentYear + 1}-01-01T00:00:00.000Z`;

  const { count, error: checkError } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd);

  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }

  const limit = settings.max_scholarships_per_student;
  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      {
        error: `You have already submitted ${limit === 1 ? "a scholarship application" : `${limit} scholarship applications`} for ${currentYear}. You may apply again starting January ${currentYear + 1}.`,
        code: "ANNUAL_LIMIT_REACHED",
      },
      { status: 409 }
    );
  }
  // Minimum grade, application window and the same limit are also enforced by a database trigger.

  const { data, error } = await supabase
    .from("applications")
    .insert({ user_id: user.id, scholarship_id: body.scholarship_id })
    .select()
    .single();

  if (error) {
    // P0001 = RAISE EXCEPTION from the scholarship rules trigger (closed, past deadline, full).
    return NextResponse.json({ error: error.message, code: error.code === "P0001" ? "APPLICATION_RULE" : undefined }, { status: error.code === "P0001" ? 409 : 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
