import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/settings";

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scholarships")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

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

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!isAdminRole(roleData?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Whitelist columns so clients can't set arbitrary fields.
  const payload = {
    name: String(body.name ?? "").trim(),
    description: body.description ?? null,
    slots: Number(body.slots) || 0,
    deadline: body.deadline || null,
    eligibility: body.eligibility ?? null,
    is_active: body.is_active ?? true,
  };
  if (!payload.name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (payload.slots < 0) {
    return NextResponse.json({ error: "Slots cannot be negative" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("scholarships")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
