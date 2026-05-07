import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const { data: app } = await supabase
    .from("applications")
    .select("disbursement_status, user_id")
    .eq("id", id)
    .single();

  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (app.disbursement_status === "Disbursed") {
    return NextResponse.json(
      { error: "Application is locked after disbursement" },
      { status: 403 }
    );
  }

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  const isAdmin = roleData?.role === "admin";
  const isOwner = app.user_id === user.id;

  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("applications")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
