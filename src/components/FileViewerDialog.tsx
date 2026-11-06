"use client";

// Stored files (documents, receipts, grade reports) open over the page instead of in another tab.

import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Download } from "@/components/icons";

export type ViewedFile = { title: string; url: string; name?: string | null; mime?: string | null };

export function fileKind(mime?: string | null, name?: string | null): "image" | "pdf" | "other" {
  if (mime?.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  const ext = (name ?? "").split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "other";
}

/** A Supabase signed link that downloads the file instead of showing it. */
function downloadUrl(url: string, name?: string | null) {
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name || "")}`;
}

export function FileViewerDialog({ file, onClose }: { file: ViewedFile | null; onClose: () => void }) {
  const kind = file ? fileKind(file.mime, file.name ?? file.url) : "other";
  return (
    <AppDialog open={!!file} onOpenChange={(o) => !o && onClose()} size="lg" title={file?.title ?? "File"}
      footer={file && <>
        <Button variant="outline" asChild>
          <a href={downloadUrl(file.url, file.name)}><Download className="mr-1 h-4 w-4" /> Download</a>
        </Button>
        <Button onClick={onClose}>Close</Button>
      </>}>
      {/* Sized to the room left after the title and buttons, so the whole picture shows without scrolling. */}
      {file && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not an optimisable asset
        <img src={file.url} alt={file.title} className="mx-auto block h-auto max-h-[calc(100dvh-16rem)] w-auto max-w-full rounded-lg border object-contain" />
      )}
      {file && kind === "pdf" && <iframe src={file.url} title={file.title} className="h-[calc(100dvh-16rem)] w-full rounded-lg border bg-white" />}
      {file && kind === "other" && <p className="text-sm text-muted-foreground">This file can&apos;t be shown here. Use <strong>Download</strong> to open it.</p>}
    </AppDialog>
  );
}
