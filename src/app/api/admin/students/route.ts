import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { linkResult, sendLinkEmail, serviceClient, siteUrl } from "@/lib/admin-api";

// Actions on student accounts that need Supabase Auth's admin API (service role):
//   POST { action: "set_active", userId, active }   deactivating also blocks sign-in and ends their sessions
//   POST { action: "reset_mfa" | "sign_out" | "reset_password", userId }
//   POST { action: "delete_account", userId, requestId? }   Mayor Office only; files, login and records go.
//                                                            Refused while the student has disbursed payments.
// Admins (staff_may 'manage') may use all but delete_account; an office Admin only on their office's students.
// If the caller uses 2FA, they must have passed it.

// About a hundred years: Supabase Auth has no "banned forever".
const BAN_FOREVER = "876000h";
// Every file a student uploads lives under a folder named after their id in these buckets.
const USER_BUCKETS = ["documents", "profile-pictures"];

type Caller = { id: string; email: string; isSuper: boolean };

async function authorize(): Promise<{ caller: Caller; supabase: Awaited<ReturnType<typeof createClient>>; admin: SupabaseClient } | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: canManage }, { data: isSuper }, { data: mfaOk }] = await Promise.all([
    supabase.rpc("staff_may", { _user: user.id, _perm: "manage" }),
    supabase.rpc("staff_may", { _user: user.id, _perm: "super" }),
    supabase.rpc("mfa_ok", { _user: user.id }),
  ]);
  if (canManage !== true) return NextResponse.json({ error: "Only admins can manage student accounts" }, { status: 403 });
  if (mfaOk !== true) return NextResponse.json({ error: "Two-factor verification required" }, { status: 401 });

  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 500 });
  return { caller: { id: user.id, email: user.email ?? "", isSuper: isSuper === true }, supabase, admin };
}

const audit = (admin: SupabaseClient, caller: Caller, action: string, entityId: string, value: Record<string, unknown>) =>
  admin.from("audit_logs").insert({
    user_id: caller.id, user_email: caller.email, action, entity_type: "profiles", entity_id: entityId, new_value: value,
  });

/** Every object path under `prefix` in a bucket (Storage lists one folder level at a time). */
async function listFiles(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const entries: { id: string | null; name: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    entries.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const paths = await Promise.all(entries.map((o) =>
    // Folders come back without an id.
    o.id ? Promise.resolve([`${prefix}/${o.name}`]) : listFiles(admin, bucket, `${prefix}/${o.name}`)));
  return paths.flat();
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (auth instanceof NextResponse) return auth;
  const { caller, supabase, admin } = auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const userId = String(body?.userId ?? "");

  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!roleRow) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (roleRow.role !== "student") return NextResponse.json({ error: "That account is not a student. Manage staff under Staff." }, { status: 400 });

  // Office Admins act only on students who applied to their office's programs (061's office_ok_person;
  // true for the Mayor Office and staff without an office).
  const { data: inOffice, error: officeErr } = await supabase.rpc("office_ok_person", { _person: userId });
  if (officeErr) return NextResponse.json({ error: officeErr.message }, { status: 500 });
  if (inOffice !== true) return NextResponse.json({ error: "This student has not applied to your office's programs" }, { status: 403 });

  if (action === "set_active") {
    const active = body?.active === true;
    // The database checks the caller may do this, records it on the profile and notifies the student.
    const { error } = await supabase.rpc("set_student_active", { _user_id: userId, _active: active });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : BAN_FOREVER });
    const { error: revokeErr } = active ? { error: null } : await admin.rpc("revoke_user_sessions", { _user_id: userId });
    await audit(admin, caller, active ? "activate_student" : "deactivate_student", userId, {
      is_active: active, sign_in_blocked: !active && !banErr, signed_out: !active && !revokeErr,
    });
    if (banErr || revokeErr) {
      return NextResponse.json({ error: `The account was ${active ? "activated" : "deactivated"}, but its sign-in could not be ${active ? "restored" : "blocked"}: ${(banErr ?? revokeErr)!.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_mfa") {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const f of data?.factors ?? []) {
      const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    // Sessions that already passed 2FA would otherwise stay signed in.
    const { error: revokeErr } = await admin.rpc("revoke_user_sessions", { _user_id: userId });
    await audit(admin, caller, "reset_student_2fa", userId, { factors_removed: data?.factors?.length ?? 0, signed_out: !revokeErr });
    if (revokeErr) {
      return NextResponse.json({ error: `Two-factor was removed, but their sessions could not be ended: ${revokeErr.message}. Use Sign out everywhere.` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "sign_out") {
    const { error } = await admin.rpc("revoke_user_sessions", { _user_id: userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(admin, caller, "sign_out_student", userId, {});
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_password") {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email) return NextResponse.json({ error: "That account has no email address" }, { status: 400 });
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create the link" }, { status: 500 });
    const link = `${siteUrl(request)}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/reset-password`;
    const sent = await sendLinkEmail(email, "Reset your scholarship portal password",
      "The scholarship office started a password reset for your account. Choose a new password to sign in again.", link, "Choose a new password");
    await audit(admin, caller, "reset_student_password", userId, { emailed: sent.emailed });
    return NextResponse.json(linkResult(sent, link));
  }

  if (action === "delete_account") {
    if (!caller.isSuper) return NextResponse.json({ error: "Only the Mayor Office can delete student accounts" }, { status: 403 });

    // Payments are deleted with the account, so money already released would vanish from the books.
    const { count: disbursed } = await admin.from("payments").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "Disbursed");
    if (disbursed) {
      return NextResponse.json({ error: `This student has ${disbursed} disbursed payment${disbursed === 1 ? "" : "s"}, which would be deleted with the account. Deactivate the account instead to keep the disbursement records.` }, { status: 409 });
    }

    // Their deletion request goes with the account, so the audit entry is what records it was honoured.
    const requestId = body?.requestId ? String(body.requestId) : null;

    const [{ data: u }, { data: prof }] = await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle(),
    ]);
    // Deleting the login removes their profile, applications, documents and notifications with it.
    // It goes first: if it fails, the student still has their account and every file it points to.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return NextResponse.json({ error: `The account was not deleted: ${error.message}` }, { status: 500 });

    let filesRemoved = 0;
    let filesError: string | null = null;
    for (const bucket of USER_BUCKETS) {
      const paths = await listFiles(admin, bucket, userId);
      for (let i = 0; i < paths.length && !filesError; i += 100) {
        const { error: rmError } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (rmError) filesError = rmError.message;
        else filesRemoved += Math.min(100, paths.length - i);
      }
    }
    await audit(admin, caller, "delete_student_account", userId, {
      email: u?.user?.email ?? null,
      name: [prof?.first_name, prof?.last_name].filter(Boolean).join(" ") || null,
      files_removed: filesRemoved,
      ...(filesError ? { files_error: filesError } : {}),
      request_id: requestId,
    });
    // The account is gone either way, so a file left behind is a warning, not a failure.
    return NextResponse.json(filesError
      ? { ok: true, warning: `Some of their files could not be removed (${filesError}). Clear the ${userId} folders in Supabase Storage.` }
      : { ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
