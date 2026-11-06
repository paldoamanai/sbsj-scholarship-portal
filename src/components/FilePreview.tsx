"use client";

// Documents open over the page instead of in a new tab. Images can be zoomed; PDFs are drawn page by page
// with pdf.js, because phone browsers often show an embedded PDF blank or download it instead.

import { useEffect, useState } from "react";
import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Minus, Plus } from "@/components/icons";

export type PreviewFile = { title: string; url: string; mime?: string | null; fileName?: string | null; description?: string };

/** "image/png", "application/pdf", or a guess from the file name. */
export function fileKind(mime?: string | null, name?: string | null): "image" | "pdf" | "other" {
  if (mime?.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  const ext = (name ?? "").split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "other";
}

function PdfPages({ url, zoom, title }: { url: string; zoom: number; title: string }) {
  const [state, setState] = useState<{ images: string[]; pages: number } | "loading" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("download failed");
        const blob = await res.blob();
        const { renderPages } = await import("@/lib/doc-checks/pdf");
        const out = await renderPages(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
        if (!cancelled) setState(out);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (state === "loading") return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening PDF…</div>;
  // Couldn't draw it (an old browser, or a damaged file): let the browser try.
  if (state === "error") return <iframe src={url} title={title} className="h-[70vh] w-full bg-white" />;
  return (
    <div className="space-y-2 p-2">
      {state.images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser
        <img key={i} src={src} alt={`${title}, page ${i + 1}`} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="mx-auto block border bg-white shadow-sm" />
      ))}
      {state.pages > state.images.length && (
        <p className="py-2 text-center text-xs text-muted-foreground">Showing the first {state.images.length} of {state.pages} pages. Download the file to see the rest.</p>
      )}
    </div>
  );
}

/** The file itself, zoomable, sized to fit a dialog or a side-by-side panel. */
export function FileView({ url, mime, title, fileName, height = "h-[65vh]" }: { url: string; mime?: string | null; title: string; fileName?: string | null; height?: string }) {
  const [zoom, setZoom] = useState(1);
  const kind = fileKind(mime, fileName ?? url);
  useEffect(() => { setZoom(1); }, [url]);
  return (
    <div className="space-y-1.5">
      {kind !== "other" && (
        <div className="flex items-center justify-end gap-1">
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><Minus className="h-4 w-4" /></Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Zoom in" disabled={zoom >= 5} onClick={() => setZoom((z) => Math.min(5, z + 0.5))}><Plus className="h-4 w-4" /></Button>
        </div>
      )}
      <div className={`${height} overflow-auto rounded-lg border bg-muted/30`}>
        {kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not an optimisable asset
          <img src={url} alt={title} style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }}
            className={zoom === 1 ? "mx-auto block h-full w-auto max-w-full object-contain" : "block"} />
        )}
        {kind === "pdf" && <PdfPages url={url} zoom={zoom} title={title} />}
        {kind === "other" && (
          <p className="p-4 text-sm text-muted-foreground">This file can&apos;t be shown here. Use <strong>Download</strong> to save it.</p>
        )}
      </div>
    </div>
  );
}

/** A dialog over the page with the file and Download / Close buttons. */
export function FilePreviewDialog({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
  const download = async () => {
    if (!file) return;
    try {
      // Cross-site links ignore the download attribute, so save it through a local copy.
      const blob = await (await fetch(file.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.fileName || file.title;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch { /* offline: nothing to save */ }
  };
  return (
    <AppDialog open={!!file} onOpenChange={(o) => { if (!o) onClose(); }} size="xl" title={file?.title ?? "Document"} description={file?.description}
      footer={file && <>
        <Button variant="outline" onClick={download}><Download className="mr-1 h-4 w-4" />Download</Button>
        <Button onClick={onClose}>Close</Button>
      </>}>
      {file && <FileView url={file.url} mime={file.mime} title={file.title} fileName={file.fileName} />}
    </AppDialog>
  );
}
