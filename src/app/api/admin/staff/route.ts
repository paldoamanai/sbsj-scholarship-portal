import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { isStaffRole, ROLE_LABEL } from "@/lib/permissions";

// Super admin actions on staff accounts that need Supabase Auth's admin API (service role):
//   GET                         every staff account with its last sign-in and whether 2FA is on
//   POST { action: "invite" }   create a staff account and email the person a link to set a password
//   POST { action: "reset_mfa" | "sign_out" | "reset_password", userId }
// The caller must be allowed to manage settings (a super admin) and, if they use 2FA, have passed it.

type Caller = { id: string; email: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function authorize(): Promise<{ caller: Caller; admin: SupabaseClient } | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: canManage }, { data: mfaOk }] = await Promise.all([
    supabase.rpc("can_manage_settings", { _user_id: user.id }),
    supabase.rpc("mfa_ok", { _user: user.id }),
  ]);
  if (canManage !== true) return NextResponse.json({ error: "Only a super admin can do this" }, { status: 403 });
  if (mfaOk !== true) return NextResponse.json({ error: "Two-factor verification required" }, { status: 401 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 500 });
  const admin = createServiceClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { caller: { id: user.id, email: user.email ?? "" }, admin };
}

const audit = (admin: SupabaseClient, caller: Caller, action: string, entityId: string, value: Record<string, unknown>) =>
  admin.from("audit_logs").insert({
    user_id: caller.id, user_email: caller.email, action, entity_type: "user_roles", entity_id: entityId, new_value: value,
  });

const siteUrl = (request: Request) =>
  (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

/** Emails a sign-in link through Resend. Returns false when email isn't configured or sending failed. */
async function sendLinkEmail(to: string, subject: string, intro: string, link: string, button: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="margin:0 0 12px;color:#111">${escapeHtml(subject)}</h2>
      <p style="margin:0 0 20px;color:#444;line-height:1.5">${escapeHtml(intro)}</p>
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a>
      <p style="margin:20px 0 0;color:#888;font-size:12px">This link works once. If you weren't expecting it, ignore this email.</p>
    </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "SBSJ Scholarship <onboarding@resend.dev>", to, subject, html }),
  }).catch(() => null);
  return !!res?.ok;
}

export async function GET() {
  const auth = await authorize();
  if (auth instanceof NextResponse) return auth;
  const { admin } = auth;

  const { data: roles, error } = await admin.from("user_roles").select("user_id, role").neq("role", "student");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const staff = await Promise.all((roles ?? []).filter((r) => isStaffRole(r.role)).map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id);
    const u = data?.user;
    return {
      id: r.user_id,
      role: r.role as string,
      lastSignInAt: u?.last_sign_in_at ?? null,
      mfa: !!u?.factors?.some((f) => f.status === "verified"),
      // Invited but hasn't set a password and signed in yet.
      invited: !!u?.invited_at && !u?.last_sign_in_at,
    };
  }));
  return NextResponse.json({ staff });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (auth instanceof NextResponse) return auth;
  const { caller, admin } = auth;
  const body = await request.json().catch(() => null) as Record<string, string> | null;
  const action = body?.action;

  if (action === "invite") {
    const email = String(body?.email ?? "").trim().toLowerCase();
    const firstName = String(body?.firstName ?? "").trim();
    const lastName = String(body?.lastName ?? "").trim();
    const role = String(body?.role ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    if (!firstName || !lastName) return NextResponse.json({ error: "Enter their first and last name" }, { status: 400 });
    if (!isStaffRole(role)) return NextResponse.json({ error: "Choose a staff role" }, { status: 400 });

    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite", email, options: { data: { first_name: firstName, last_name: lastName } },
    });
    if (error || !data?.user) {
      const exists = /already/i.test(error?.message ?? "");
      return NextResponse.json({
        error: exists ? "That email already has an account. Find it under Add existing account instead." : error?.message ?? "Could not create the account",
      }, { status: 400 });
    }
    const userId = data.user.id;
    // The signup trigger made them a student; promote them straight away.
    const { error: roleErr } = await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
    if (roleErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }
    await audit(admin, caller, "invite_staff", userId, { email, role });

    const link = `${siteUrl(request)}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite&next=/reset-password`;
    const emailed = await sendLinkEmail(email, "You've been added to the SB San Jose scholarship office",
      `You now have ${ROLE_LABEL[role]} access to the scholarship portal. Set a password to sign in.`, link, "Set your password");
    return NextResponse.json({ ok: true, emailed, link: emailed ? null : link });
  }

  const userId = String(body?.userId ?? "");
  if (!userId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  if (userId === caller.id) return NextResponse.json({ error: "Use your own Profile page for your account" }, { status: 400 });
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!isStaffRole(roleRow?.role)) return NextResponse.json({ error: "That account is not staff" }, { status: 400 });

  if (action === "reset_mfa") {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const f of data?.factors ?? []) {
      const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    // Sessions that already passed 2FA would otherwise stay signed in.
    await admin.rpc("revoke_user_sessions", { _user_id: userId });
    await audit(admin, caller, "reset_staff_2fa", userId, { factors_removed: data?.factors?.length ?? 0 });
    return NextResponse.json({ ok: true });
  }

  if (action === "sign_out") {
    const { error } = await admin.rpc("revoke_user_sessions", { _user_id: userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(admin, caller, "sign_out_staff", userId, {});
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_password") {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email) return NextResponse.json({ error: "That account has no email address" }, { status: 400 });
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create the link" }, { status: 500 });
    const link = `${siteUrl(request)}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/reset-password`;
    const emailed = await sendLinkEmail(email, "Reset your scholarship portal password",
      "A super admin started a password reset for your staff account. Choose a new password to sign in again.", link, "Choose a new password");
    await audit(admin, caller, "reset_staff_password", userId, { emailed });
    return NextResponse.json({ ok: true, emailed, link: emailed ? null : link });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
