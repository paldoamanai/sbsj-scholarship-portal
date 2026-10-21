import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { isOffice, isStaffRole, roleCanHaveOffice, staffLabel } from "@/lib/permissions";

// Actions on staff accounts that need Supabase Auth's admin API (service role):
//   GET                         every staff account with its last sign-in and whether 2FA is on
//   POST { action: "invite" }   create a staff account and email the person a link to set a password
//                               (for an invite that is still pending, sends a fresh link instead)
//   POST { action: "reset_mfa" | "sign_out" | "reset_password", userId }
//   POST { action: "resend_invite" | "cancel_invite", userId }   only while the invite is pending
//   POST { action: "update_details", userId, firstName, lastName, email }
//   POST { action: "delete_account", userId }   deletes the login; the audit log keeps their history
// The caller must be allowed to manage settings (the Mayor Office), or be an Admin of an office (065),
// who manages only that office's Reviewer and Finance accounts. If they use 2FA, they must have passed it.

/** `office`: set for an office Admin, whose actions are limited to that office's Reviewer and Finance accounts. */
type Caller = { id: string; email: string; office: string | null };

const OFFICE_ADMIN_ROLES = ["reviewer", "finance_admin"];
/** Whether the caller may act on a staff account with this role and office. */
const inScope = (caller: Caller, role: string, office: string | null) =>
  !caller.office || (OFFICE_ADMIN_ROLES.includes(role) && office === caller.office);
const OUT_OF_SCOPE = "You can only manage Reviewer and Finance accounts in your own office";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function authorize(): Promise<{ caller: Caller; admin: SupabaseClient } | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: canManage }, { data: mfaOk }, { data: managed }] = await Promise.all([
    supabase.rpc("can_manage_settings", { _user_id: user.id }),
    supabase.rpc("mfa_ok", { _user: user.id }),
    supabase.rpc("staff_manager_office", { _user: user.id }),
  ]);
  const office = canManage === true ? null : isOffice(managed) ? managed : null;
  if (canManage !== true && !office) return NextResponse.json({ error: "Only the Mayor Office or an office Admin can do this" }, { status: 403 });
  if (mfaOk !== true) return NextResponse.json({ error: "Two-factor verification required" }, { status: 401 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 500 });
  const admin = createServiceClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { caller: { id: user.id, email: user.email ?? "", office }, admin };
}

const audit = (admin: SupabaseClient, caller: Caller, action: string, entityId: string, value: Record<string, unknown>) =>
  admin.from("audit_logs").insert({
    user_id: caller.id, user_email: caller.email, action, entity_type: "user_roles", entity_id: entityId, new_value: value,
  });

// The configured site URL, unless it points at localhost while the request came from a real domain
// (an .env copied to the server): that link would only open on the developer's own machine.
const isLocal = (url: string) => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
function siteUrl(request: Request) {
  const origin = new URL(request.url).origin;
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return configured && !(isLocal(configured) && !isLocal(origin)) ? configured : origin;
}

type Sent = { emailed: true } | { emailed: false; reason: string };

/** Emails a sign-in link through Resend. When it can't, says why, so the super admin can share the link instead. */
async function sendLinkEmail(to: string, subject: string, intro: string, link: string, button: string): Promise<Sent> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { emailed: false, reason: "Email isn't set up on this portal (RESEND_API_KEY is missing)." };
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
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "San Jose Scholarship <onboarding@resend.dev>", to, subject, html }),
  }).catch(() => null);
  if (res?.ok) return { emailed: true };
  // Resend explains itself, e.g. its test sender only delivers to the Resend account owner.
  const detail = await res?.json().then((b: { message?: string }) => b?.message).catch(() => null);
  return { emailed: false, reason: `The email could not be sent${detail ? `: ${detail}` : "."}` };
}

/** What the API returns after creating a link: the link itself only when it wasn't emailed. */
const linkResult = (sent: Sent, link: string) =>
  sent.emailed ? { ok: true, emailed: true, link: null } : { ok: true, emailed: false, link, reason: sent.reason };

// Invited staff set their password on /reset-password, which marks password_set. Accounts invited
// before that flag existed count as pending until their first sign-in.
const invitePending = (u: { invited_at?: string; last_sign_in_at?: string; user_metadata?: Record<string, unknown> } | null | undefined) => {
  if (!u?.invited_at) return false;
  const set = u.user_metadata?.password_set;
  return set === false || (set === undefined && !u.last_sign_in_at);
};

const INVITE_SUBJECT = "You've been added to the Mayor Office scholarship staff";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** A fresh set-your-password link for an invite that is still pending, at the account's current role and office. */
async function resendInvite(admin: SupabaseClient, caller: Caller, request: Request, userId: string, email: string, role: string, office: string | null) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create the link" }, { status: 500 });
  const link = `${siteUrl(request)}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=${encodeURIComponent("/reset-password?invite=1")}`;
  const sent = await sendLinkEmail(email, INVITE_SUBJECT,
    `You have ${staffLabel(role, office)} access to the scholarship portal. Set a password to sign in.`, link, "Set your password");
  await audit(admin, caller, "resend_staff_invite", userId, { email, role, office, emailed: sent.emailed });
  return NextResponse.json({ ...linkResult(sent, link), resent: true });
}

export async function GET() {
  const auth = await authorize();
  if (auth instanceof NextResponse) return auth;
  const { admin, caller } = auth;

  const { data: roles, error } = await admin.from("user_roles").select("*").neq("role", "student"); // "*": works before migration 060 too
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const visible = (roles ?? []).filter((r) => isStaffRole(r.role) && (r.user_id === caller.id || inScope(caller, r.role, r.office ?? null)));
  const staff = await Promise.all(visible.map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id);
    const u = data?.user;
    return {
      id: r.user_id,
      role: r.role as string,
      lastSignInAt: u?.last_sign_in_at ?? null,
      mfa: !!u?.factors?.some((f) => f.status === "verified"),
      // Invited but hasn't set a password yet.
      invited: invitePending(u),
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
    const requestedOffice = String(body?.office ?? "");
    // An office Admin's staff always join their office.
    const office = caller.office ?? (isOffice(requestedOffice) && roleCanHaveOffice(role) ? requestedOffice : null);
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    if (!firstName || !lastName) return NextResponse.json({ error: "Enter their first and last name" }, { status: 400 });
    if (!isStaffRole(role)) return NextResponse.json({ error: "Choose a staff role" }, { status: 400 });
    if (!inScope(caller, role, office)) return NextResponse.json({ error: "Office Admins can invite Reviewer or Finance staff for their own office" }, { status: 403 });

    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite", email, options: { data: { first_name: firstName, last_name: lastName, password_set: false } },
    });
    if (error || !data?.user) {
      if (!/already/i.test(error?.message ?? "")) return NextResponse.json({ error: error?.message ?? "Could not create the account" }, { status: 400 });

      // Already invited but never finished (often an expired link): move them to the role and office
      // picked now, and send a fresh link.
      const { data: prof } = await admin.from("profiles").select("id").ilike("email", escapeLike(email)).maybeSingle();
      const [{ data: existing }, { data: roleRow }] = prof
        ? await Promise.all([admin.auth.admin.getUserById(prof.id), admin.from("user_roles").select("*").eq("user_id", prof.id).maybeSingle()])
        : [{ data: null }, { data: null }];
      const oldOffice = (roleRow?.office as string | null | undefined) ?? null;
      if (!prof || !invitePending(existing?.user) || !isStaffRole(roleRow?.role) || !inScope(caller, roleRow!.role as string, oldOffice)) {
        return NextResponse.json({
          error: caller.office ? "That email already has an account. Ask the Mayor Office to give it access." : "That email already has an account. Find it under Add existing account instead.",
        }, { status: 400 });
      }
      const updated = roleRow!.role !== role || oldOffice !== office;
      if (updated) {
        const { error: roleErr } = await admin.from("user_roles")
          .update({ role, ...(office || oldOffice ? { office } : {}) }).eq("user_id", prof.id);
        if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 });
        await audit(admin, caller, "change_pending_invite", prof.id, { email, role, office, previous_role: roleRow!.role, previous_office: oldOffice });
      }
      const res = await resendInvite(admin, caller, request, prof.id, email, role, office);
      if (!res.ok) return res;
      return NextResponse.json({ ...(await res.json()), updated });
    }
    const userId = data.user.id;
    // The signup trigger made them a student; promote them straight away.
    const { error: roleErr } = await admin.from("user_roles").upsert({ user_id: userId, role, ...(office ? { office } : {}) }, { onConflict: "user_id" });
    if (roleErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }
    await audit(admin, caller, "invite_staff", userId, { email, role, office });

    const link = `${siteUrl(request)}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite&next=${encodeURIComponent("/reset-password?invite=1")}`;
    const sent = await sendLinkEmail(email, INVITE_SUBJECT,
      `You now have ${staffLabel(role, office)} access to the scholarship portal. Set a password to sign in.`, link, "Set your password");
    return NextResponse.json(linkResult(sent, link));
  }

  const userId = String(body?.userId ?? "");
  if (!userId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  if (userId === caller.id) return NextResponse.json({ error: "Use your own Profile page for your account" }, { status: 400 });
  const { data: roleRow } = await admin.from("user_roles").select("*").eq("user_id", userId).maybeSingle(); // "*": works before migration 060 too
  if (!isStaffRole(roleRow?.role)) return NextResponse.json({ error: "That account is not staff" }, { status: 400 });
  const role = roleRow!.role as string;
  const office = (roleRow?.office as string | null | undefined) ?? null;
  if (!inScope(caller, role, office)) return NextResponse.json({ error: OUT_OF_SCOPE }, { status: 403 });

  if (action === "reset_mfa") {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const f of data?.factors ?? []) {
      const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    // Sessions that already passed 2FA would otherwise stay signed in.
    const { error: revokeErr } = await admin.rpc("revoke_user_sessions", { _user_id: userId });
    await audit(admin, caller, "reset_staff_2fa", userId, { factors_removed: data?.factors?.length ?? 0, signed_out: !revokeErr });
    if (revokeErr) {
      return NextResponse.json({ error: `Two-factor was removed, but their sessions could not be ended: ${revokeErr.message}. Use Sign out everywhere.` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "resend_invite" || action === "cancel_invite") {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    if (!invitePending(u?.user)) return NextResponse.json({ error: "They already set a password, so there is no invite to change" }, { status: 400 });

    if (action === "resend_invite") {
      if (!u?.user?.email) return NextResponse.json({ error: "That account has no email address" }, { status: 400 });
      return resendInvite(admin, caller, request, userId, u.user.email, role, office);
    }

    // Deleting the account (and with it the role and profile) makes the old link useless.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(admin, caller, "cancel_staff_invite", userId, { email: u?.user?.email ?? null, role, office });
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
    const sent = await sendLinkEmail(email, "Reset your scholarship portal password",
      "The Mayor Office started a password reset for your staff account. Choose a new password to sign in again.", link, "Choose a new password");
    await audit(admin, caller, "reset_staff_password", userId, { emailed: sent.emailed });
    return NextResponse.json(linkResult(sent, link));
  }

  if (action === "update_details") {
    const email = String(body?.email ?? "").trim().toLowerCase();
    const firstName = String(body?.firstName ?? "").trim();
    const lastName = String(body?.lastName ?? "").trim();
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    if (!firstName || !lastName) return NextResponse.json({ error: "Enter their first and last name" }, { status: 400 });

    const [{ data: u }, { data: prof }] = await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin.from("profiles").select("email, first_name, last_name").eq("id", userId).maybeSingle(),
    ]);
    if (!u?.user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const oldEmail = (u.user.email ?? "").toLowerCase();
    if (email !== oldEmail) {
      const { data: taken } = await admin.from("profiles").select("id").ilike("email", escapeLike(email)).neq("id", userId).maybeSingle();
      if (taken) return NextResponse.json({ error: "Another account already uses that email" }, { status: 400 });
    }
    // Changed straight away, without a confirmation email: the Mayor Office vouches for the address.
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ...(email !== oldEmail ? { email, email_confirm: true } : {}),
      user_metadata: { ...u.user.user_metadata, first_name: firstName, last_name: lastName },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const { error: profErr } = await admin.from("profiles").update({ email, first_name: firstName, last_name: lastName }).eq("id", userId);
    if (profErr) return NextResponse.json({ error: `Sign-in details saved, but the profile wasn't: ${profErr.message}` }, { status: 500 });
    await audit(admin, caller, "update_staff_details", userId, {
      previous: { email: oldEmail, first_name: prof?.first_name ?? null, last_name: prof?.last_name ?? null },
      email, first_name: firstName, last_name: lastName,
    });
    return NextResponse.json({ ok: true, emailChanged: email !== oldEmail });
  }

  if (action === "delete_account") {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    // Deleting the login also ends its sessions and removes its role and profile. Records they
    // worked on stay; their "done by" columns become empty, and the audit log keeps their email.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(admin, caller, "delete_staff_account", userId, { email: u?.user?.email ?? null, role, office });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
