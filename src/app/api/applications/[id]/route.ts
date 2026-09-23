import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/settings";
import { applicationDetailsSchema } from "@/validations/application";

const ADMIN_FIELDS = ["status", "notes", "amount_approved", "disbursement_status"] as const;

async function loadContext(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;

  // Independent lookups, run together.
  const [{ data: app }, { data: roleData }] = await Promise.all([
    supabase.from("applications").select("disbursement_status, user_id, status").eq("id", id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!app) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  return {
    supabase,
    app,
    isAdmin: isAdminRole(roleData?.role),
    isOwner: app.user_id === user.id,
  } as const;
}

// Students may edit their statement and household details while the application is pending.
// Admins may change the review fields only. The database trigger enforces the same rules.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await loadContext(id);
  if ("error" in ctx) return ctx.error;
  const { supabase, app, isAdmin, isOwner } = ctx;

  if (app.disbursement_status === "Disbursed") {
    return NextResponse.json({ error: "Application is locked after disbursement" }, { status: 403 });
  }
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let update: Record<string, unknown>;
  if (isAdmin) {
    update = Object.fromEntries(ADMIN_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
  } else {
    if (app.status !== "Pending") {
      return NextResponse.json({ error: "Only a pending application can be edited" }, { status: 409 });
    }
    const parsed = applicationDetailsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid details" }, { status: 400 });
    }
    // household_income/size are optional in the schema, so a caller may omit them entirely (the
    // current UI always sends all three together, but a partial body must not wipe a saved value).
    update = { statement: parsed.data.statement };
    if ("household_income" in body) update.household_income = parsed.data.household_income ?? null;
    if ("household_size" in body) update.household_size = parsed.data.household_size ?? null;
  }

  const { data, error } = await supabase
    .from("applications")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "P0001" ? 409 : 500 });
  }
  return NextResponse.json(data);
}

// "Cancel" for a student: marks the application Withdrawn (the row is kept for the record and
// stops counting toward the yearly limit). Approved applications can't be withdrawn.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await loadContext(id);
  if ("error" in ctx) return ctx.error;
  const { supabase, app, isOwner } = ctx;

  if (!isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (app.status === "Withdrawn") return NextResponse.json({ error: "Already withdrawn" }, { status: 409 });
  if (app.status !== "Pending" && app.status !== "Waitlisted") {
    return NextResponse.json({ error: `A ${app.status.toLowerCase()} application can't be withdrawn` }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("applications")
    .update({ status: "Withdrawn", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "P0001" ? 409 : 500 });
  }
  return NextResponse.json(data);
}
