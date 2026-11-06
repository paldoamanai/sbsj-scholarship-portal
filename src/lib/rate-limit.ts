import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Rate limits kept in the database (rate_limit_hits, migration 092), so they hold across server
// instances. Server-only: it needs the service role client. If the table or the client is missing, the
// limit fails open (never blocks), and callers can fall back to something lighter.

/** A visitor's IP address, hashed: enough to count requests without storing the address. */
export function visitorKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
  return createHash("sha256").update(`sbsj:${ip}`).digest("hex").slice(0, 32);
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number } | { ok: "unavailable" };

/**
 * Counts one request in `bucket` for `key` and says whether it's allowed: at most `max` in `windowMs`.
 * A refused request isn't counted, so waiting out the window always works.
 */
export async function rateLimit(admin: SupabaseClient | null, bucket: string, key: string, max: number, windowMs: number): Promise<LimitResult> {
  if (!admin) return { ok: "unavailable" };
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await admin.from("rate_limit_hits").select("hit_at")
    .eq("bucket", bucket).eq("key", key).gt("hit_at", since)
    .order("hit_at", { ascending: true }).limit(max);
  if (error) { console.error(`rate limit (${bucket}):`, error.message); return { ok: "unavailable" }; }
  if (data.length >= max) {
    const retryAt = new Date(data[0].hit_at).getTime() + windowMs;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) };
  }
  const { error: insErr } = await admin.from("rate_limit_hits").insert({ bucket, key });
  if (insErr) { console.error(`rate limit (${bucket}):`, insErr.message); return { ok: "unavailable" }; }
  // Now and then, clear hits older than a day.
  if (Math.random() < 0.05) {
    void admin.from("rate_limit_hits").delete().lt("hit_at", new Date(Date.now() - 86400000).toISOString()).then(() => undefined);
  }
  return { ok: true };
}

export const minutesText = (sec: number) => {
  const m = Math.ceil(sec / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
};
