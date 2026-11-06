"use client";

// Asks the student about a photo with quality problems before it's uploaded: retake it, or upload anyway
// (the reviewer then sees "Uploaded despite warning"). Problems the student can't fix (what the file says
// about itself, matching files) are never shown here; only the reviewer sees those.
//
//   const [checkFile, checkDialog] = useUploadCheck();
//   const check = await checkFile(file);   // null = the student chose to retake
//   ...render {checkDialog}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "@/components/icons";
import { ISSUE_TEXT, checkUpload, type UploadCheck } from "@/lib/doc-checks";

type Pending = { file: File; url: string | null; check: UploadCheck; resolve: (c: UploadCheck | null) => void };

export function useUploadCheck(): [(file: File) => Promise<UploadCheck | null>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const [checking, setChecking] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => () => { if (pending?.url) URL.revokeObjectURL(pending.url); }, [pending]);

  const checkFile = useCallback(async (file: File) => {
    setChecking(true);
    let check: UploadCheck;
    try { check = await checkUpload(file); } catch { check = { sha256: null, imageHash: null, flags: [], issues: [] }; }
    finally { setChecking(false); }
    if (check.issues.length === 0) return check;
    return new Promise<UploadCheck | null>((resolve) => {
      setPending({ file, check, resolve, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    });
  }, []);

  const finish = (proceed: boolean) => {
    const p = pendingRef.current;
    if (!p) return;
    p.resolve(proceed ? { ...p.check, flags: [...p.check.flags, "uploaded_anyway"] } : null);
    setPending(null);
  };

  const dialog = (
    <>
      {checking && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-background px-4 py-2 text-sm shadow-lg">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Checking your photo…
        </div>
      )}
      <AppDialog open={!!pending} onOpenChange={(o) => { if (!o) finish(false); }} size="md" className="rounded-2xl"
        title="Check your photo"
        description="The office needs to read every word. A clearer photo gets your document verified faster."
        footer={<>
          <Button variant="outline" className="rounded-xl" onClick={() => finish(true)}>Upload anyway</Button>
          <Button className="rounded-xl" onClick={() => finish(false)}>Retake photo</Button>
        </>}>
        {pending?.url && (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL)
          <img src={pending.url} alt="Your photo" className="mx-auto max-h-64 w-auto rounded-lg border object-contain" />
        )}
        <ul className="space-y-1.5">
          {pending?.check.issues.map((i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{ISSUE_TEXT[i] ?? i}
            </li>
          ))}
        </ul>
      </AppDialog>
    </>
  );
  return [checkFile, dialog];
}
