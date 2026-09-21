import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

// Called by a Supabase Database Webhook on INSERT into public.notifications.
// Emails the recipient through Resend, honoring the global email switch and the
// user's per-category email preference.

type NotificationRecord = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: string;
  link: string | null;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function authorized(request: Request) {
  const secret = process.env.NOTIFICATION_WEBHOOK_SECRET;
  const given = request.headers.get("x-webhook-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const record = body?.record as NotificationRecord | undefined;
  if (body?.type !== "INSERT" || body?.table !== "notifications" || !record?.user_id) {
    return NextResponse.json({ skipped: "not a notification insert" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !serviceKey) {
    return NextResponse.json({ skipped: "email is not configured" });
  }

  const supabase = createClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), serviceKey, {
    auth: { persistSession: false },
  });

  // Global switch (defaults to on when the setting row is missing).
  const { data: setting } = await supabase.from("system_settings").select("value").eq("key", "email_notifications").maybeSingle();
  if (setting && (setting.value === false || setting.value === "false")) {
    return NextResponse.json({ skipped: "email notifications are turned off" });
  }

  // Per-user preference for this category (missing row = on).
  const { data: pref } = await supabase
    .from("notification_preferences")
    .select("email")
    .eq("user_id", record.user_id)
    .eq("category", record.category)
    .maybeSingle();
  if (pref && pref.email === false) {
    return NextResponse.json({ skipped: "user turned off email for this category" });
  }

  // Master email switch. Account and system notices are always sent, like the per-category rule above.
  if (["application", "verification", "payment", "program"].includes(record.category)) {
    const { data: master } = await supabase.from("user_settings").select("email_enabled").eq("user_id", record.user_id).maybeSingle();
    if (master && master.email_enabled === false) {
      return NextResponse.json({ skipped: "user turned off email notifications" });
    }
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(record.user_id);
  const to = userData?.user?.email;
  if (userError || !to) {
    return NextResponse.json({ skipped: "recipient has no email" });
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const url = record.link && site ? `${site}${record.link}` : null;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="margin:0 0 12px;color:#111">${escapeHtml(record.title)}</h2>
      <p style="margin:0 0 20px;color:#444;line-height:1.5">${escapeHtml(record.message)}</p>
      ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open in the portal</a>` : ""}
      <p style="margin:24px 0 0;color:#888;font-size:12px">SB San Jose Scholarship Portal. You can change which emails you receive under Settings.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "SBSJ Scholarship <onboarding@resend.dev>",
      to,
      subject: record.title,
      html,
      text: `${record.title}\n\n${record.message}${url ? `\n\n${url}` : ""}`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Resend error", res.status, detail);
    return NextResponse.json({ error: "Email provider rejected the message", detail }, { status: 502 });
  }

  return NextResponse.json({ sent: true });
}
