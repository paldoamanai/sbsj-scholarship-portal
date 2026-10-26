import type { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const DOC_MIME = ["application/pdf", "image/jpeg", "image/png"];

/** Filed with each application on its own, not shared like the required documents (migration 063). */
export const LETTER_OF_INTENT = "Letter of Intent";
/** Filed with an approved application before its first payout, where the office asks for one (migration 071). */
export const MOA = "MOA Agreement Letter";
/** Documents that belong to one application rather than the student's shared set. */
export const APPLICATION_DOCS = [LETTER_OF_INTENT, MOA];
export const PHOTO_MIME = ["image/jpeg", "image/png"];

// Storage keys reject many characters (accents, #, etc.), so keep file and folder names plain.
const plain = (v: string) =>
  v.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

export function safeFileName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? plain(name.slice(dot + 1)).slice(0, 8) : "";
  const base = (plain(dot > 0 ? name.slice(0, dot) : name) || "file").slice(0, 80);
  return ext ? `${base}.${ext}` : base;
}

export const docFolder = (type: string) => plain(type).toLowerCase() || "document";

/** The storage object path for a document. Older rows only have a (private-bucket) public URL. */
export function documentPath(d: Pick<Tables<"documents">, "storage_path" | "file_url">) {
  if (d.storage_path) return d.storage_path;
  const i = d.file_url.indexOf("/documents/");
  if (i === -1) return d.file_url.includes("://") ? null : d.file_url;
  return decodeURIComponent(d.file_url.slice(i + "/documents/".length).split("?")[0]);
}

/**
 * Upload a document to private storage and record it.
 * The file goes straight to storage; the database then re-checks type, size, ownership and the lock
 * against the stored object, so callers' own checks are only for a friendlier message.
 * A file the database refuses is removed again.
 */
export async function uploadUserDocument(
  supabase: ReturnType<typeof createClient>,
  opts: { userId: string; docType: string; file: File; applicationId?: string | null }
): Promise<{ row: Tables<"documents"> } | { error: string }> {
  const { userId, docType, file, applicationId } = opts;
  const path = docType === LETTER_OF_INTENT
    ? letterPath(userId, file)
    : docType === MOA
      ? `${userId}/moa/${Date.now()}-${safeFileName(file.name)}`
      : `${userId}/documents/${docFolder(docType)}/${Date.now()}-${safeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const { data, error } = await supabase.from("documents").insert({
    user_id: userId, application_id: applicationId ?? null, document_type: docType,
    file_url: path, storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type,
  }).select().single();
  if (error || !data) {
    await supabase.storage.from("documents").remove([path]);
    return { error: error?.message ?? "Could not save the document" };
  }
  return { row: data };
}

const letterPath = (userId: string, file: File) => `${userId}/letters/${Date.now()}-${safeFileName(file.name)}`;

/** Uploads a letter of intent photo for an application that is about to be submitted. Returns its path. */
export async function uploadLetterPhoto(supabase: ReturnType<typeof createClient>, userId: string, file: File) {
  const path = letterPath(userId, file);
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type });
  return error ? { error: error.message } : { path };
}

/**
 * Phone photos are often larger than the upload limit. Shrinks one that is (or is very large) to a
 * JPEG of at most 2400px on its long side, which keeps a letter readable. Other files pass through.
 */
export async function shrinkPhoto(file: File, maxBytes: number): Promise<File> {
  if (!PHOTO_MIME.includes(file.type) || file.size <= Math.min(maxBytes, 2 * 1024 * 1024)) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // a transparent PNG would turn black as a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
