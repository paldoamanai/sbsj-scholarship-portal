import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/settings";
import { scholarshipSchema } from "@/validations/scholarship";

// Public listing: active programs with their availability, without the internal budget.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scholarships_public");

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

  const parsed = scholarshipSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid scholarship" }, { status: 400 });
  }
  // The schema is a whitelist: clients can't set arbitrary fields.
  const payload = parsed.data;

  const { data, error } = await supabase
    .from("scholarships")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "P0001" ? 409 : 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
