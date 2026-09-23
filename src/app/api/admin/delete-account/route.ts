import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { staffCan } from "@/lib/settings";
import { AVATAR_BUCKET } from "@/lib/avatar";

// Completes a student's account-deletion request: removes their files, then the account itself
// (every row keyed to the account goes with it). Needs SUPABASE_SERVICE_ROLE_KEY on the server.
//
// Deleting the account also deletes the request row, so the outcome is recorded in the audit log
// here rather than through handle_data_request().

// Every object under `prefix`, walking into sub-folders (storage lists one level at a time).
async function listAll(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths: string[] = [];
  for (const item of data) {
    const path = `${prefix}/${item.name}`;
    // Folders come back without an id.
    if (item.id === null) paths.push(...(await listAll(admin, bucket, path)));
    else paths.push(path);
  }
  return paths;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  if (!staffCan(roleRow?.role, "manage")) {
    return NextResponse.json({ error: "Only an admin can delete accounts" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!requestId) return NextResponse.json({ error: "Missing request" }, { status: 400 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({
      error: "Account deletion isn't set up on this server (SUPABASE_SERVICE_ROLE_KEY is missing). Delete the account in the Supabase dashboard instead.",
    }, { status: 501 });
  }

  // Read through the admin's own session, so row-level security still decides what they can see.
  const { data: req } = await supabase.from("data_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (req.status !== "Pending") return NextResponse.json({ error: "This request was already handled" }, { status: 409 });

  const uid = req.user_id as string;
  const [{ data: targetRole }, { count: disbursed }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "Disbursed"),
    supabase.from("profiles").select("first_name, last_name, email").eq("id", uid).maybeSingle(),
  ]);
  if (targetRole?.role && targetRole.role !== "student") {
    return NextResponse.json({ error: "Staff accounts can't be deleted here" }, { status: 409 });
  }
  // Disbursed payments are locked records; deleting the account would have to delete them too.
  if (disbursed) {
    return NextResponse.json({
      error: `This student has ${disbursed} disbursed payment${disbursed === 1 ? "" : "s"} that must be kept for audit. Decline the request and explain why.`,
    }, { status: 409 });
  }

  const admin = createServiceClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), serviceKey, {
    auth: { persistSession: false },
  });

  const [docs, avatars] = await Promise.all([listAll(admin, "documents", uid), listAll(admin, AVATAR_BUCKET, uid)]);
  if (docs.length) {
    const { error } = await admin.storage.from("documents").remove(docs);
    if (error) return NextResponse.json({ error: `Could not remove their documents: ${error.message}` }, { status: 500 });
  }
  if (avatars.length) await admin.storage.from(AVATAR_BUCKET).remove(avatars);

  const { error: delError } = await admin.auth.admin.deleteUser(uid);
  if (delError) {
    return NextResponse.json({ error: `Files were removed, but the account could not be deleted: ${delError.message}` }, { status: 500 });
  }

  const name = profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.email : null;
  await admin.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "complete_account_deletion",
    entity_type: "data_requests",
    entity_id: requestId,
    previous_value: { status: "Pending", student: name, email: profile?.email ?? null },
    new_value: { status: "Completed", files_removed: docs.length + avatars.length },
    user_agent: request.headers.get("user-agent")?.slice(0, 250) ?? null,
  });

  return NextResponse.json({ ok: true, filesRemoved: docs.length + avatars.length });
}
