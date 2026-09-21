import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studentProfileSchema } from "@/validations/profile";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "P0001" ? 409 : 500 });
  }

  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only the editable profile fields are accepted (the schema is the allowlist); everything else,
  // such as is_active, average_grade or email, is ignored. The database enforces the same rules.
  const parsed = studentProfileSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  }
  const fields = parsed.data;

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "P0001" ? 409 : 500 });
  }

  return NextResponse.json(data);
}
