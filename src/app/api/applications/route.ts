import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // ── Annual limit: 1 application per student per calendar year ──
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01T00:00:00.000Z`;
  const yearEnd   = `${currentYear + 1}-01-01T00:00:00.000Z`;

  const { data: existing, error: checkError } = await supabase
    .from("applications")
    .select("id, status")
    .eq("user_id", user.id)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd)
    .limit(1);

  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }

  if (existing && existing.length > 0) {
    return NextResponse.json(
      {
        error: `You have already submitted a scholarship application for ${currentYear}. You may apply again starting January ${currentYear + 1}.`,
        code: "ANNUAL_LIMIT_REACHED",
      },
      { status: 409 }
    );
  }
  // ──────────────────────────────────────────────────────────────

  const { data, error } = await supabase
    .from("applications")
    .insert({ user_id: user.id, scholarship_id: body.scholarship_id })
    .select()
    .single();

  if (error) {
    // P0001 = RAISE EXCEPTION from the scholarship rules trigger (closed, past deadline, full).
    return NextResponse.json({ error: error.message, code: error.code === "P0001" ? "PROGRAM_CLOSED" : undefined }, { status: error.code === "P0001" ? 409 : 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
