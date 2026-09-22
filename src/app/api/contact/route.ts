import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SETTING_DEFAULTS } from "@/lib/settings";

// Emails a public contact-form message to the LGU's contact email (the `contact_email`
// system setting, editable by admins) through Resend. The visitor's address is set as
// Reply-To so staff can answer straight from their inbox.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Light per-instance throttle: 5 messages per 10 minutes per IP.
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 5;
function throttled(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim();
  const subject = String(body?.subject ?? "").trim() || "Website inquiry";
  const message = String(body?.message ?? "").trim();

  // Honeypot: real visitors never fill this hidden field. Pretend success so bots move on.
  if (String(body?.website ?? "").trim() !== "") return NextResponse.json({ sent: true });

  if (!name || name.length > 100) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!EMAIL_RE.test(email) || email.length > 255) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  if (subject.length > 150) return NextResponse.json({ error: "The subject is too long." }, { status: 400 });
  if (!message || message.length > 1000) return NextResponse.json({ error: "Please enter a message of up to 1000 characters." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (throttled(ip)) {
    return NextResponse.json({ error: "Too many messages. Please try again in a few minutes." }, { status: 429 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Messaging is temporarily unavailable. Please email us directly instead." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: setting } = await supabase.from("system_settings").select("value").eq("key", "contact_email").maybeSingle();
  const to = typeof setting?.value === "string" && setting.value.trim() ? setting.value.trim() : SETTING_DEFAULTS.contact_email;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2 style="margin:0 0 4px;color:#111">${escapeHtml(subject)}</h2>
      <p style="margin:0 0 16px;color:#666;font-size:13px">From ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt; via the scholarship portal contact form</p>
      <p style="margin:0;color:#222;line-height:1.55;white-space:pre-wrap">${escapeHtml(message)}</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "SBSJ Scholarship <onboarding@resend.dev>",
      to,
      reply_to: email,
      subject: `[Contact form] ${subject}`,
      html,
      text: `From: ${name} <${email}>\n\n${message}`,
    }),
  });

  if (!res.ok) {
    console.error("Contact email failed", res.status, await res.text());
    return NextResponse.json({ error: "We couldn't send your message. Please try again or email us directly." }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
}
