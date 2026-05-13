/**
 * Supabase clients expect the project base URL only (https://<ref>.supabase.co).
 * A common misconfiguration is pasting the REST endpoint, which breaks auth URLs.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) return "";
  let url = raw.trim().replace(/\/+$/, "");
  url = url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  return url;
}
