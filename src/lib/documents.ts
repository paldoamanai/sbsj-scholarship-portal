import type { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const DOC_MIME = ["application/pdf", "image/jpeg", "image/png"];

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
  const path = `${userId}/documents/${docFolder(docType)}/${Date.now()}-${safeFileName(file.name)}`;

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
