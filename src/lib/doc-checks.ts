// Upload checks, done in the student's browser before a file is uploaded (browser only).
//   * Quality (photos): blurry, too dark, glare, too small to read. The student is asked to retake.
//   * Fingerprints: SHA-256 of the file, and a "looks alike" image fingerprint, so a reviewer sees when
//     the same picture is used for different documents or by different students.
//   * What the file says about itself: editing software, a PDF made in Word/Canva or changed after it was
//     made, a screenshot. Only the reviewer sees these; missing information proves nothing.
// Checks flag, they never decide. If anything here fails, the upload goes ahead without them.

export type UploadCheck = {
  sha256: string | null;
  imageHash: string | null;
  flags: string[];              // everything found (stored with the document)
  issues: string[];             // the photo-quality ones the student is asked about
  metrics?: Record<string, number | string | boolean | undefined>;
};

// ── Labels (shared by the student prompt and the reviewer) ──
export const FLAG_LABEL: Record<string, { label: string; detail: string; tone: "quality" | "file" | "note" }> = {
  blurry: { label: "Blurry", detail: "The text looks soft or out of focus.", tone: "quality" },
  too_dark: { label: "Too dark", detail: "The photo is underexposed.", tone: "quality" },
  glare: { label: "Glare", detail: "Part of the page is washed out by light.", tone: "quality" },
  low_resolution: { label: "Low resolution", detail: "The image is small; fine print may not be readable.", tone: "quality" },
  uploaded_anyway: { label: "Uploaded despite warning", detail: "The student was told about the quality problems and uploaded anyway.", tone: "note" },
  editing_software: { label: "Editing software", detail: "The file says it was saved by a photo or design editor.", tone: "file" },
  pdf_designed: { label: "PDF made in Word/Canva", detail: "This PDF was created in a word processor or design app, not scanned. Official forms are usually scans or system printouts.", tone: "file" },
  pdf_edited: { label: "PDF changed after it was made", detail: "The PDF was modified after it was created, or saved by a PDF editor.", tone: "file" },
  screenshot: { label: "Screenshot", detail: "Looks like a screenshot rather than a photo or scan; it may have been downloaded or forwarded.", tone: "file" },
};

/** The student-facing message for a quality problem. */
export const ISSUE_TEXT: Record<string, string> = {
  blurry: "It looks blurry. Hold the phone steady, tap to focus, and try again.",
  too_dark: "It's too dark. Move to better light, or turn on a light.",
  glare: "There's glare on the page. Tilt the page or move away from the light.",
  low_resolution: "It's too small to read. Use a clearer, closer photo.",
};

// ── Fingerprints ──
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Gray = { data: Float32Array; w: number; h: number };

function toGray(src: CanvasImageSource & { width: number; height: number }, max = 1000): Gray {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  return { data, w, h };
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/**
 * Blur, 0 (sharp) to 1, after Crété-Roffet et al. (2007): blur again and see how much edge contrast
 * survives. Measured over tiles that have text; the 25th percentile, so one sharp corner doesn't hide
 * a blurry page.
 */
function blurScore(g: Gray): number {
  const { data, w, h } = g;
  const R = 4, n = 2 * R + 1, tiles = 8;
  const scores: number[] = [];
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    const x0 = Math.floor((tx * w) / tiles) + R + 1, x1 = Math.floor(((tx + 1) * w) / tiles) - R - 1;
    const y0 = Math.floor((ty * h) / tiles) + R + 1, y1 = Math.floor(((ty + 1) * h) / tiles) - R - 1;
    if (x1 <= x0 || y1 <= y0) continue;
    let sF = 0, sV = 0, edges = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      const dFv = Math.abs(data[i] - data[i - w]), dFh = Math.abs(data[i] - data[i - 1]);
      if (dFv <= 14 && dFh <= 14) continue;
      let bv = 0, bvp = 0, bh = 0, bhp = 0;
      for (let k = -R; k <= R; k++) { bv += data[i + k * w]; bvp += data[i - w + k * w]; bh += data[i + k]; bhp += data[i - 1 + k]; }
      if (dFv > 14) { sF += dFv; sV += Math.max(0, dFv - Math.abs(bv - bvp) / n); }
      if (dFh > 14) { sF += dFh; sV += Math.max(0, dFh - Math.abs(bh - bhp) / n); }
      edges++;
    }
    if (edges >= (x1 - x0) * (y1 - y0) * 0.01 && sF > 0) scores.push((sF - sV) / sF);
  }
  return scores.length ? percentile(scores, 0.25) : 0;
}

/** A 256-bit perceptual hash (16 x 16 low frequencies of a 32 x 32 DCT) as 64 hex characters. */
function imageHash(g: Gray): string {
  const N = 32, K = 16;
  const c = new Array(N * N).fill(0), cnt = new Array(N * N).fill(0);
  for (let y = 0; y < g.h; y++) {
    const r = Math.min(N - 1, Math.floor((y * N) / g.h));
    for (let x = 0; x < g.w; x++) { const k = r * N + Math.min(N - 1, Math.floor((x * N) / g.w)); c[k] += g.data[y * g.w + x]; cnt[k]++; }
  }
  for (let i = 0; i < c.length; i++) c[i] = cnt[i] ? c[i] / cnt[i] : 0;
  const cos = Array.from({ length: K }, (_, u) => Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));
  const rows = Array.from({ length: N }, (_, y) => Array.from({ length: K }, (_, u) => { let s = 0; for (let x = 0; x < N; x++) s += c[y * N + x] * cos[u][x]; return s; }));
  const coeffs: number[] = [];
  for (let v = 0; v < K; v++) for (let u = 0; u < K; u++) { let s = 0; for (let y = 0; y < N; y++) s += rows[y][u] * cos[v][y]; coeffs.push(s); }
  const median = [...coeffs.slice(1)].sort((a, b) => a - b)[Math.floor((coeffs.length - 1) / 2)];
  let hex = "";
  for (let i = 0; i < coeffs.length; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b++) nib = (nib << 1) | (coeffs[i + b] > median ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

// ── What the file says about itself ──
const EDITORS = /photoshop|lightroom|\bgimp\b|canva|picsart|snapseed|pixlr|photopea|fotor|meitu|facetune|polarr|inshot|ibis ?paint|affinity|coreldraw|paint\.net|illustrator|inkscape|remini|picwish|photoroom|airbrush|youcam|befunky|photodirector|picmonkey/i;
const DESIGNED_PDF = /canva|microsoft.{0,12}word|\bword\b|powerpoint|excel|google docs|google slides|libreoffice|openoffice|\bwps\b|\bpages\b|keynote|illustrator|photoshop|inkscape|affinity|coreldraw|publisher/i;
const PDF_EDITORS = /pdfescape|sejda|smallpdf|ilovepdf|pdf-xchange|phantompdf|pdffiller|dochub|pdfsimpli|formswift|lightpdf|pdf2go|pdfcandy|soda pdf|pdfelement|wondershare|pdf editor|edit ?pdf/i;
const SCANNERS = /scan|epson|canon|\bhp\b|hewlett|brother|xerox|ricoh|kyocera|konica|sharp|camscanner|adobe scan|microsoft lens|office lens|tap ?scanner|clear ?scan|naps2|vflat|notebloc|tiny ?scanner|fujitsu|paperstream/i;

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};
const clean = (s: string | undefined) => s?.replace(/\0+$/g, "").replace(/[^\x20-\x7e]/g, "").trim() || undefined;

type Meta = { make?: string; model?: string; software?: string; creatorTool?: string; producer?: string; creator?: string; created?: string; modified?: string; eofs?: number; linearized?: boolean; signed?: boolean };

function readExif(view: DataView, tiff: number, out: Meta) {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little), u32 = (o: number) => view.getUint32(o, little);
  const str = (e: number) => {
    const count = u32(e + 4), at = count <= 4 ? e + 8 : tiff + u32(e + 8);
    let s = "";
    for (let i = 0; i < count && at + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(at + i));
    return clean(s);
  };
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > view.byteLength) return;
  for (let i = 0, n = u16(ifd); i < n && ifd + 2 + i * 12 + 12 <= view.byteLength; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e);
    if (tag === 0x010f) out.make = str(e);
    else if (tag === 0x0110) out.model = str(e);
    else if (tag === 0x0131) out.software = str(e);
  }
}

async function readMeta(file: File): Promise<Meta> {
  const out: Meta = {};
  if (file.type === "application/pdf") {
    const text = latin1(new Uint8Array(await file.arrayBuffer()));
    const field = (k: string) => clean(new RegExp(`/${k}\\s*\\(([^)]{1,200})\\)`).exec(text)?.[1]);
    out.producer = field("Producer") ?? clean(/<pdf:Producer>([^<]{1,200})</i.exec(text)?.[1]);
    out.creator = field("Creator") ?? clean(/<xmp:CreatorTool>([^<]{1,200})</i.exec(text)?.[1]);
    out.created = field("CreationDate");
    out.modified = field("ModDate");
    out.eofs = (text.match(/%%EOF/g) ?? []).length;
    out.linearized = /\/Linearized/.test(text.slice(0, 2048));
    out.signed = /\/ByteRange\s*\[/.test(text);
    return out;
  }
  const bytes = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (file.type === "image/jpeg") {
    let off = 2;
    while (off + 4 <= bytes.length) {
      const marker = view.getUint16(off);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      const size = view.getUint16(off + 2), start = off + 4;
      if (marker === 0xffe1 && view.getUint32(start) === 0x45786966) { try { readExif(view, start + 6, out); } catch { /* unreadable */ } }
      else if (marker === 0xffe1) out.creatorTool ??= clean(/<xmp:CreatorTool>([^<]{1,200})</i.exec(latin1(bytes.subarray(start, Math.min(bytes.length, off + 2 + size))))?.[1]);
      off += 2 + size;
    }
  } else if (file.type === "image/png") {
    let off = 8;
    while (off + 12 <= bytes.length) {
      const len = view.getUint32(off), type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
      const data = bytes.subarray(off + 8, Math.min(bytes.length, off + 8 + len));
      if (type === "tEXt" || type === "iTXt") {
        const nul = data.indexOf(0), key = latin1(data.subarray(0, nul));
        if (/^software$/i.test(key)) out.software = clean(latin1(data.subarray(nul + 1)));
        const xmp = /<xmp:CreatorTool>([^<]{1,200})</i.exec(latin1(data));
        if (xmp) out.creatorTool = clean(xmp[1]);
      } else if (type === "eXIf") { try { readExif(new DataView(data.buffer, data.byteOffset, data.byteLength), 0, out); } catch { /* unreadable */ } }
      else if (type === "IEND") break;
      off += 12 + len;
    }
  }
  return out;
}

const pdfDate = (d?: string) => {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(d ?? "");
  return m ? Date.UTC(+m[1], +(m[2] ?? 1) - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : NaN;
};

function metaFlags(file: File, meta: Meta): string[] {
  const flags: string[] = [];
  const sources = [meta.software, meta.creatorTool, meta.producer, meta.creator].filter((v): v is string => !!v);
  const scanned = sources.some((s) => SCANNERS.test(s));
  if (file.type === "application/pdf") {
    if (!scanned && sources.some((s) => DESIGNED_PDF.test(s))) flags.push("pdf_designed");
    if (sources.some((s) => EDITORS.test(s) && !DESIGNED_PDF.test(s))) flags.push("editing_software");
    const changedLater = pdfDate(meta.modified) - pdfDate(meta.created) > 2 * 60 * 1000;
    const extraSaves = (meta.eofs ?? 0) > (meta.linearized ? 2 : 1) && !meta.signed;
    if (changedLater || extraSaves || sources.some((s) => PDF_EDITORS.test(s))) flags.push("pdf_edited");
  } else {
    if (sources.some((s) => EDITORS.test(s))) flags.push("editing_software");
    const shotName = /screen ?shot|screenshot|scrn|screen_?cap/i.test(file.name);
    const shotSoftware = sources.some((s) => /screenshot|screen ?capture|snipping/i.test(s));
    if (shotName || shotSoftware || (file.type === "image/png" && !meta.make && !meta.model && !scanned)) flags.push("screenshot");
  }
  return flags;
}

/** Runs every upload check on the original file (before any shrinking, which drops what it says about itself). */
export async function checkUpload(file: File): Promise<UploadCheck> {
  const result: UploadCheck = { sha256: null, imageHash: null, flags: [], issues: [] };
  try { result.sha256 = await sha256Hex(file); } catch { /* no fingerprint */ }
  try { result.flags.push(...metaFlags(file, await readMeta(file))); } catch { /* unreadable */ }
  if (file.type.startsWith("image/")) {
    try {
      const bmp = await createImageBitmap(file);
      const g = toGray(bmp);
      const blur = blurScore(g);
      const sample: number[] = [];
      let sum = 0, bright = 0;
      const step = Math.max(1, Math.floor(g.data.length / 50000));
      for (let i = 0; i < g.data.length; i += step) { const v = g.data[i]; sample.push(v); sum += v; if (v >= 250) bright++; }
      const brightness = sum / sample.length, paper = percentile(sample, 0.5), darkest = percentile(sample, 0.02), saturated = bright / sample.length;
      const shortSide = Math.min(bmp.width, bmp.height);
      if (blur > 0.2) result.issues.push("blurry");
      if (brightness < 70) result.issues.push("too_dark");
      if ((saturated >= 0.02 && saturated <= 0.4 && paper < 215) || darkest > 140) result.issues.push("glare");
      if (shortSide < 700) result.issues.push("low_resolution");
      result.imageHash = imageHash(g);
      result.metrics = { blur: Math.round(blur * 1000) / 1000, brightness: Math.round(brightness), saturated: Math.round(saturated * 1000) / 1000, width: bmp.width, height: bmp.height };
      bmp.close();
    } catch { /* not decodable here: no quality checks */ }
  }
  result.flags.push(...result.issues);
  return result;
}

/** The fields saved on the document row. */
export const checkColumns = (c: UploadCheck | null | undefined) => (c ? {
  file_sha256: c.sha256, image_hash: c.imageHash, check_flags: [...new Set(c.flags)].slice(0, 20),
  upload_check: { v: 1, ...(c.metrics ?? {}) },
} : {});
