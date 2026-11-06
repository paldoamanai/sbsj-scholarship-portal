// Document checks, put together:
//   checkUpload()   in the student's browser, on the original file before it is shrunk: photo quality
//                   (shown to the student so they can retake it) and what the file says about itself.
//   fingerprint()   exact and "looks alike" fingerprints of the file actually uploaded.
//   scanDocument()  in a reviewer's browser, on the stored file: everything again, plus the text on it,
//                   the layout against a genuine sample, and where a house photo was taken.
// The results are saved with the document (migration 087), which adds duplicate checks across students.

import { photoLocation } from "@/lib/exif-gps";
import { distanceKm, placeAt, samePlaceName, type LatLng } from "@/lib/geo";
import { HOME_MUNICIPALITY } from "@/lib/barangays";
import { differenceHash, layoutSignature, layoutSimilarity, measureQuality, sha256Hex, toGray, toJpeg, type Layout, type Quality } from "./image";
import { readFileMeta, type FileMeta } from "./metadata";
import { checkText, ocr, type ProfileForText, type Signatory, type TextFindings } from "./text";

export { FLAG_INFO, flagInfo, documentRisk, applicationRisk, RISK_LABEL, RISK_TONE, SEVERITY_TONE, QUALITY_FLAGS, DISAPPROVAL_REASONS, HIGH_FLAGS } from "./flags";
export type { Risk, Severity } from "./flags";
export type { Layout } from "./image";
export type { Signatory } from "./text";

type Visual = { src: CanvasImageSource & { width: number; height: number }; width: number; height: number; pages?: number; done: () => void };

/** The image, or a PDF's first page, ready to draw. */
async function loadVisual(blob: Blob): Promise<Visual> {
  if (blob.type === "application/pdf") {
    const { renderFirstPage } = await import("./pdf");
    const { canvas, pages } = await renderFirstPage(blob);
    return { src: canvas, width: canvas.width, height: canvas.height, pages, done: () => {} };
  }
  const bmp = await createImageBitmap(blob);
  return { src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
}

const isPhoto = (blob: Blob) => blob.type === "image/jpeg" || blob.type === "image/png";

const metaSummary = (m: FileMeta) => ({
  kind: m.kind, width: m.width, height: m.height, make: m.make, model: m.model, software: m.software, taken: m.taken,
  c2pa: m.c2pa || undefined, aiLabel: m.aiLabel, aiPrompt: m.aiPrompt || undefined, scanned: m.scanned || undefined, pdf: m.pdf,
});

export type UploadChecks = {
  v: 1; at: string;
  meta: ReturnType<typeof metaSummary>;
  quality?: Quality;
  gps?: LatLng | null;
  flags: string[];
};

const STUDENT_MESSAGES: Record<string, string> = {
  blurry: "The photo looks blurry, so the text may be hard to read.",
  low_resolution: "The photo is small, so the text may be hard to read.",
  too_dark: "The photo is very dark.",
  glare: "Part of the document looks washed out by glare or light.",
  small_in_frame: "The document fills only a small part of the photo. Move closer.",
  cut_off: "Part of the document may be cut off at the edge of the photo.",
};

/** Checks a file the student picked. `warnings` are about photo quality only, for the student to act on. */
export async function checkUpload(original: File, docType: string): Promise<{ checks: UploadChecks; warnings: string[] }> {
  let quality: Quality | undefined;
  let size: { width: number; height: number } | undefined;
  try {
    const v = await loadVisual(original);
    size = { width: v.width, height: v.height };
    try { quality = measureQuality(toGray(v.src), { photo: isPhoto(original), shortSide: Math.min(v.width, v.height) }); } finally { v.done(); }
  } catch { /* can't decode it here; the server still checks type and size */ }
  const meta = await readFileMeta(original, isPhoto(original) ? size : undefined);
  const gps = docType === "House Photo" ? await photoLocation(original) : undefined;
  const flags = [...new Set([...meta.flags, ...(quality?.flags ?? [])])];
  return {
    checks: { v: 1, at: new Date().toISOString(), meta: metaSummary(meta), quality, gps, flags },
    warnings: (quality?.flags ?? []).map((f) => STUDENT_MESSAGES[f]).filter(Boolean),
  };
}

/** Exact (SHA-256) and "looks alike" fingerprints of a file. */
export async function fingerprint(file: Blob): Promise<{ sha256: string; phash: string | null }> {
  const sha256 = await sha256Hex(file);
  let phash: string | null = null;
  try {
    const v = await loadVisual(file);
    try { phash = differenceHash(toGray(v.src, 400)); } finally { v.done(); }
  } catch { /* not decodable */ }
  return { sha256, phash };
}

/** A genuine sample's fingerprint and layout, for comparing uploads with. */
export async function sampleSignature(file: Blob): Promise<{ phash: string; layout: Layout }> {
  const v = await loadVisual(file);
  try {
    return { phash: differenceHash(toGray(v.src, 400)), layout: layoutSignature(toGray(v.src, 800)) };
  } finally { v.done(); }
}

export type Sample = { id: string; document_type: string; place: string | null; layout: unknown; label?: string | null; storage_path: string; mime_type?: string | null };

export type ScanResult = {
  v: 1; at: string;
  quality?: Quality;
  meta: ReturnType<typeof metaSummary>;
  pages?: number;
  text: Omit<TextFindings, "flags"> | null;
  excerpt?: string;
  layout?: { sampleId: string; similarity: number } | null;
  location?: { distanceKm: number | null; town: string | null } | null;
  flags: string[];
};

/**
 * Checks a stored document in the reviewer's browser. Reading the text takes a few seconds per page;
 * the recognizer is downloaded once per session.
 */
export async function scanDocument(blob: Blob, ctx: {
  docType: string; profile: ProfileForText & { home_lat?: number | null; home_lng?: number | null };
  signatories: Signatory[]; samples: Sample[]; uploadChecks: UploadChecks | null; uploadedAt: Date; academicYear: string | null;
}): Promise<{ scan: ScanResult; sha256: string; phash: string | null; controlNo: string | null }> {
  const flags = new Set<string>();
  const sha256 = await sha256Hex(blob);
  const v = await loadVisual(blob);
  let phash: string | null = null;
  let quality: Quality | undefined;
  let layoutResult: ScanResult["layout"] = null;
  let ocrCanvas: HTMLCanvasElement | null = null;
  try {
    const gray = toGray(v.src);
    quality = measureQuality(gray, { photo: isPhoto(blob), shortSide: Math.min(v.width, v.height) });
    // The stored copy of a big photo was shrunk, so only blur, light and framing count from it.
    quality.flags.filter((f) => f !== "low_resolution").forEach((f) => flags.add(f));
    phash = differenceHash(toGray(v.src, 400));

    const samples = ctx.samples.filter((s) => s.document_type === ctx.docType && s.layout);
    if (samples.length) {
      const mine = layoutSignature(toGray(v.src, 800));
      const placeMatch = (s: Sample) => !s.place || [ctx.profile.barangay, ctx.profile.school_name].some((p) => p && samePlaceName(p, s.place));
      const pool = samples.some(placeMatch) ? samples.filter(placeMatch) : samples;
      const best = pool.map((s) => ({ s, sim: layoutSimilarity(mine, s.layout as Layout) })).sort((a, b) => b.sim - a.sim)[0];
      layoutResult = { sampleId: best.s.id, similarity: best.sim };
      if (best.sim < 0.45) flags.add("layout_differs");
    }

    // Text recognition works best on a page about 2000 px tall.
    const scale = Math.min(1, 2000 / Math.max(v.width, v.height));
    ocrCanvas = document.createElement("canvas");
    ocrCanvas.width = Math.round(v.width * scale); ocrCanvas.height = Math.round(v.height * scale);
    ocrCanvas.getContext("2d")?.drawImage(v.src, 0, 0, ocrCanvas.width, ocrCanvas.height);
  } finally { v.done(); }

  const meta = await readFileMeta(blob, isPhoto(blob) ? { width: v.width, height: v.height } : undefined);
  // Size and camera data of a shrunk copy say nothing about the original; the upload report covers those.
  meta.flags.filter((f) => !["ai_size", "no_camera_data"].includes(f)).forEach((f) => flags.add(f));

  // Text: a typed PDF carries it; otherwise read it from the image.
  let text = "", words: { text: string; confidence: number }[] = [], confidence = 0;
  if (blob.type === "application/pdf") {
    try {
      const { pdfText } = await import("./pdf");
      text = await pdfText(blob);
      if (text.replace(/\s/g, "").length >= 80) { confidence = 99; words = text.split(/\s+/).map((t) => ({ text: t, confidence: 99 })); }
    } catch { /* fall back to OCR */ }
  }
  if (text.replace(/\s/g, "").length < 80 && ocrCanvas && ctx.docType !== "House Photo") {
    const r = await ocr(ocrCanvas);
    text = r.text; words = r.words; confidence = r.confidence;
  }
  let findings: TextFindings | null = null;
  if (text) {
    findings = checkText({ text, words, confidence, docType: ctx.docType, profile: ctx.profile, signatories: ctx.signatories,
      uploadedAt: ctx.uploadedAt, academicYear: ctx.academicYear });
    findings.flags.forEach((f) => flags.add(f));
  }

  // Where a house photo was taken (from the upload report: the stored copy may have lost it).
  let location: ScanResult["location"] = null;
  const gps = ctx.uploadChecks?.gps;
  if (gps) {
    const pin = ctx.profile.home_lat != null && ctx.profile.home_lng != null ? { lat: ctx.profile.home_lat, lng: ctx.profile.home_lng } : null;
    const km = pin ? distanceKm(pin, gps) : null;
    if (km != null && km > 0.3) flags.add("photo_far_from_pin");
    let town: string | null = null;
    try { town = (await placeAt(gps))?.town ?? null; } catch { /* offline */ }
    if (town && !samePlaceName(town, HOME_MUNICIPALITY)) flags.add("photo_outside_town");
    location = { distanceKm: km == null ? null : Math.round(km * 100) / 100, town };
  }

  const textRest = findings ? Object.fromEntries(Object.entries(findings).filter(([k]) => k !== "flags")) : null;
  return {
    scan: {
      v: 1, at: new Date().toISOString(), quality, meta: metaSummary(meta), pages: v.pages,
      text: findings ? (textRest as Omit<TextFindings, "flags">) : null,
      excerpt: text ? text.replace(/\s+/g, " ").trim().slice(0, 1500) : undefined,
      layout: layoutResult, location, flags: [...flags].sort(),
    },
    sha256, phash, controlNo: findings?.controlNo ?? null,
  };
}

/** A JPEG of the image or PDF page, small enough to send to the AI detector. */
export async function detectorImage(blob: Blob): Promise<Blob | null> {
  const v = await loadVisual(blob);
  try { return await toJpeg(v.src, 1600); } finally { v.done(); }
}
