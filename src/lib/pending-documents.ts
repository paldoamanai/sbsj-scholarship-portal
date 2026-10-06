import type { createClient } from "@/lib/supabase/client";
import { DOC_MIME, uploadUserDocument } from "@/lib/documents";

/**
 * Documents picked during registration when email confirmation is on. There is no session yet, so
 * they can't be uploaded; they are kept in this browser (IndexedDB) and uploaded on the first
 * dashboard visit after the student confirms their email and logs in on the same device.
 */

const DB_NAME = "sbsj-pending-docs";
const STORE = "docs";

type PendingDoc = { key: string; email: string; docType: string; file: Blob; name: string; type: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

const norm = (email: string) => email.trim().toLowerCase();

/** Keep the files for this email. Returns false if the browser can't store them. */
export async function savePendingDocuments(email: string, files: Record<string, File | null>): Promise<boolean> {
  try {
    const owner = norm(email);
    await run("readwrite", (store) => {
      for (const [docType, file] of Object.entries(files)) {
        if (!file) continue;
        const doc: PendingDoc = { key: `${owner}::${docType}`, email: owner, docType, file, name: file.name, type: file.type };
        store.put(doc);
      }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload any saved documents for this user, skipping types they already have, then forget them.
 * Returns what was uploaded and what failed (to re-upload by hand).
 */
export async function uploadPendingDocuments(
  supabase: ReturnType<typeof createClient>,
  opts: { userId: string; email: string; existingTypes: Set<string>; maxBytes: number }
): Promise<{ uploaded: string[]; failed: string[] }> {
  const uploaded: string[] = [];
  const failed: string[] = [];
  if (typeof indexedDB === "undefined") return { uploaded, failed };

  let docs: PendingDoc[] = [];
  try {
    docs = ((await run<PendingDoc[]>("readonly", (store) => store.getAll())) ?? []).filter((d) => d.email === norm(opts.email));
  } catch {
    return { uploaded, failed };
  }

  for (const d of docs) {
    if (!opts.existingTypes.has(d.docType)) {
      const file = new File([d.file], d.name, { type: d.type });
      if (!DOC_MIME.includes(file.type) || file.size > opts.maxBytes) failed.push(d.docType);
      else {
        const result = await uploadUserDocument(supabase, { userId: opts.userId, docType: d.docType, file });
        if ("error" in result) failed.push(d.docType);
        else uploaded.push(d.docType);
      }
    }
    try { await run("readwrite", (store) => store.delete(d.key)); } catch { /* ignore */ }
  }
  return { uploaded, failed };
}
