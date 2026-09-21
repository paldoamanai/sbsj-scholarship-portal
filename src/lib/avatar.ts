import type { createClient } from "@/lib/supabase/client";

export const AVATAR_BUCKET = "profile-pictures";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The storage path behind a stored avatar value (older rows stored a public URL). */
export function avatarPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https?:\/\//.test(value)) return value;
  const i = value.indexOf(`/${AVATAR_BUCKET}/`);
  return i === -1 ? null : decodeURIComponent(value.slice(i + AVATAR_BUCKET.length + 2).split("?")[0]);
}

/**
 * Upload a profile photo to the private bucket and point the profile at it.
 * One file per user (replaced in place); returns an error message, or null on success.
 */
export async function uploadAvatar(supabase: ReturnType<typeof createClient>, userId: string, file: File): Promise<string | null> {
  const ext = AVATAR_TYPES[file.type];
  if (!ext) return "Choose a JPG, PNG or WebP image";
  if (file.size > AVATAR_MAX_BYTES) return "Photo must be 2 MB or smaller";

  const path = `${userId}/avatar/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type });
  if (upErr) return upErr.message;

  const { error: dbErr } = await supabase.from("profiles").update({ profile_picture_url: path }).eq("id", userId);
  if (dbErr) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return dbErr.message;
  }
  // Remove earlier photos so files don't pile up (best effort).
  const { data: existing } = await supabase.storage.from(AVATAR_BUCKET).list(`${userId}/avatar`);
  const stale = (existing ?? []).map((f) => `${userId}/avatar/${f.name}`).filter((p) => p !== path);
  if (stale.length) await supabase.storage.from(AVATAR_BUCKET).remove(stale);
  return null;
}
