// PDF reading with pdf.js, loaded only when a PDF is checked. The worker is served from /public
// (copied there by scripts/copy-pdf-worker.mjs before dev and build), so its version always matches.

import type { PDFDocumentProxy } from "pdfjs-dist";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;

function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

/** Opens a PDF; call close() when done with it. */
export async function openPdf(data: Uint8Array | ArrayBuffer): Promise<{ pdf: PDFDocumentProxy; close: () => Promise<void> }> {
  const m = await pdfjs();
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const task = m.getDocument({ data: bytes });
  return { pdf: await task.promise, close: () => task.destroy() };
}

/** The first page drawn to a canvas, its long side about `size` px, plus the page count. */
export async function renderFirstPage(blob: Blob, size = 1800): Promise<{ canvas: HTMLCanvasElement; pages: number }> {
  const { pdf, close } = await openPdf(await blob.arrayBuffer());
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: size / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { canvas, pages: pdf.numPages };
  } finally {
    await close();
  }
}

/** Text a PDF already carries (typed PDFs), so OCR isn't needed for it. */
export async function pdfText(blob: Blob, maxPages = 3): Promise<string> {
  const { pdf, close } = await openPdf(await blob.arrayBuffer());
  try {
    const parts: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return parts.join("\n");
  } finally {
    await close();
  }
}

/** Pages drawn to images (data URLs) for showing a PDF in the app, which works on phones too. */
export async function renderPages(blob: Blob, maxPages = 10, size = 1600): Promise<{ images: string[]; pages: number }> {
  const { pdf, close } = await openPdf(await blob.arrayBuffer());
  try {
    const images: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: size / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL("image/jpeg", 0.9));
    }
    return { images, pages: pdf.numPages };
  } finally {
    await close();
  }
}
