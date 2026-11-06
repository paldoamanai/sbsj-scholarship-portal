// What a file says about where it came from: camera, editing software, AI labels (Content Credentials /
// IPTC "trainedAlgorithmicMedia"), AI generator settings in PNG text, and for PDFs who made it and whether
// it was changed afterwards. Read from the original file, before a big photo is shrunk (which drops all of it).
// Missing information proves nothing: many apps strip it.

export type FileMeta = {
  kind: "jpeg" | "png" | "pdf" | "other";
  width?: number;
  height?: number;
  make?: string;
  model?: string;
  software?: string;
  taken?: string;
  c2pa?: boolean;
  aiLabel?: string;          // what said it was AI
  aiPrompt?: boolean;
  scanned?: boolean;         // made by a scanner or scanning app
  pdf?: { producer?: string; creator?: string; created?: string; modified?: string; saves: number; linearized: boolean; signed: boolean };
  flags: string[];
};

const EDITORS = /photoshop|lightroom|\bgimp\b|canva|picsart|snapseed|pixlr|photopea|fotor|meitu|facetune|polarr|\bvsco\b|inshot|ibis ?paint|affinity|coreldraw|corel photo|paint\.net|illustrator|inkscape|remini|picwish|photoroom|lensa|airbrush|youcam|befunky|photodirector|picmonkey/i;
const DESIGNED_PDF = /canva|microsoft.{0,12}word|\bword\b|powerpoint|excel|google docs|google slides|libreoffice|openoffice|\bwps\b|\bpages\b|keynote|illustrator|photoshop|inkscape|affinity|coreldraw|publisher/i;
const PDF_EDITORS = /pdfescape|sejda|smallpdf|ilovepdf|pdf-xchange|phantompdf|pdffiller|dochub|pdfsimpli|formswift|lightpdf|pdf2go|pdfcandy|soda pdf|pdfelement|wondershare|pdf editor|edit ?pdf/i;
const SCANNERS = /scan|epson|canon|\bhp\b|hewlett|brother|xerox|ricoh|kyocera|konica|sharp|camscanner|adobe scan|microsoft lens|office lens|tap ?scanner|clear ?scan|naps2|vflat|notebloc|tiny ?scanner|fujitsu|paperstream/i;
const AI_TOOLS = /dall[·.\- ]?e|openai|chatgpt|firefly|midjourney|stable ?diffusion|imagen|gemini|bing image creator|microsoft designer|ideogram|leonardo\.ai|flux|novelai|invokeai|comfyui|automatic1111|dreamstudio|nightcafe|playground ?ai|grok|aurora/i;
const AI_SOURCE = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/;

/** Sizes AI generators produce (either way round). */
const AI_SIZES = new Set(["512x512", "768x768", "1024x1024", "2048x2048", "1024x1536", "1024x1792", "896x1152", "832x1216",
  "768x1344", "640x1536", "1152x896", "1216x832", "1344x768", "1536x640", "1536x1024", "1792x1024"]);

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};
const clean = (s: string | undefined) => s?.replace(/\0+$/g, "").replace(/[^\x20-\x7e]/g, "").trim() || undefined;

/** Reads the EXIF (TIFF) block: camera, software, date. */
function readTiff(view: DataView, tiff: number, out: FileMeta) {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const str = (e: number) => {
    const count = u32(e + 4);
    const at = count <= 4 ? e + 8 : tiff + u32(e + 8);
    let s = "";
    for (let i = 0; i < count && at + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(at + i));
    return clean(s);
  };
  const readIfd = (ifd: number, onTag: (tag: number, e: number) => void) => {
    if (ifd <= 0 || ifd + 2 > view.byteLength) return;
    for (let i = 0, n = u16(ifd); i < n && ifd + 2 + i * 12 + 12 <= view.byteLength; i++) {
      const e = ifd + 2 + i * 12;
      onTag(u16(e), e);
    }
  };
  let exifIfd = 0;
  readIfd(tiff + u32(tiff + 4), (tag, e) => {
    if (tag === 0x010f) out.make = str(e);
    else if (tag === 0x0110) out.model = str(e);
    else if (tag === 0x0131) out.software = str(e);
    else if (tag === 0x0132) out.taken ??= str(e);
    else if (tag === 0x8769) exifIfd = tiff + u32(e + 8);
  });
  readIfd(exifIfd, (tag, e) => { if (tag === 0x9003) out.taken = str(e); });
}

function readJpeg(bytes: Uint8Array, out: FileMeta) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 2;
  const texts: string[] = [];
  while (off + 4 <= bytes.length) {
    const marker = view.getUint16(off);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of image data
    const size = view.getUint16(off + 2);
    const start = off + 4, end = Math.min(bytes.length, off + 2 + size);
    if (marker === 0xffe1 && view.getUint32(start) === 0x45786966) {
      try { readTiff(view, start + 6, out); } catch { /* unreadable EXIF */ }
    } else if (marker === 0xffe1 || marker === 0xffeb || marker === 0xffed || marker === 0xfffe) {
      // XMP (APP1), JUMBF / Content Credentials (APP11), Photoshop/IPTC (APP13), comments
      const t = latin1(bytes.subarray(start, end));
      if (marker === 0xffeb && /jumb|c2pa/i.test(t)) out.c2pa = true;
      texts.push(t);
    } else if (marker >= 0xffc0 && marker <= 0xffc3) {
      out.height = view.getUint16(start + 1);
      out.width = view.getUint16(start + 3);
    }
    off += 2 + size;
  }
  return texts.join("\n");
}

async function inflate(data: Uint8Array): Promise<string> {
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    return latin1(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch {
    return "";
  }
}

async function readPng(bytes: Uint8Array, out: FileMeta) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texts: string[] = [];
  const keys: string[] = [];
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const data = bytes.subarray(off + 8, Math.min(bytes.length, off + 8 + len));
    if (type === "IHDR") { out.width = view.getUint32(off + 8); out.height = view.getUint32(off + 12); }
    else if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const nul = data.indexOf(0);
      const key = latin1(data.subarray(0, nul));
      keys.push(key);
      if (type === "zTXt") texts.push(`${key}: ${await inflate(data.subarray(nul + 2))}`);
      else if (type === "iTXt" && data[nul + 1] === 1) texts.push(`${key}: ${await inflate(data.subarray(data.indexOf(0, data.indexOf(0, nul + 3) + 1) + 1))}`);
      else texts.push(`${key}: ${latin1(data.subarray(nul + 1))}`);
      if (/^software$/i.test(key)) out.software = clean(latin1(data.subarray(nul + 1)));
    } else if (type === "eXIf") {
      try { readTiff(new DataView(data.buffer, data.byteOffset, data.byteLength), 0, out); } catch { /* unreadable */ }
    } else if (type === "caBX") out.c2pa = true;
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (keys.some((k) => /^(parameters|prompt|workflow|dream|sd-metadata|invokeai_metadata|generation_data|negative_prompt)$/i.test(k))) out.aiPrompt = true;
  return texts.join("\n");
}

async function readPdf(bytes: Uint8Array, out: FileMeta) {
  const text = latin1(bytes);
  const head = text.slice(0, 2048);
  const saves = (text.match(/%%EOF/g) ?? []).length;
  out.pdf = {
    saves,
    linearized: /\/Linearized/.test(head),
    signed: /\/ByteRange\s*\[/.test(text) || /\/Type\s*\/Sig\b/.test(text),
  };
  try {
    const { openPdf } = await import("./pdf");
    const { pdf, close } = await openPdf(bytes);
    const { info, metadata } = (await pdf.getMetadata()) as { info: Record<string, unknown>; metadata: { get(k: string): string | null } | null };
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    out.pdf.producer = s(info.Producer) ?? s(metadata?.get("pdf:producer"));
    out.pdf.creator = s(info.Creator) ?? s(metadata?.get("xmp:creatortool"));
    out.pdf.created = s(info.CreationDate);
    out.pdf.modified = s(info.ModDate);
    await close();
  } catch { /* unreadable or encrypted PDF */ }
  // XMP may sit in plain text too (labels, editors).
  return text.length > 4_000_000 ? text.slice(0, 2_000_000) + text.slice(-2_000_000) : text;
}

/** "D:20250105093000+08'00'" → milliseconds, or NaN. */
export function pdfDate(d: string | undefined): number {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(d ?? "");
  if (!m) return NaN;
  return Date.UTC(+m[1], +(m[2] ?? 1) - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/** Everything the file says about itself, and the flags that follow. */
export async function readFileMeta(file: Blob, imageSize?: { width: number; height: number }): Promise<FileMeta> {
  const type = file.type;
  const out: FileMeta = { kind: type === "image/jpeg" ? "jpeg" : type === "image/png" ? "png" : type === "application/pdf" ? "pdf" : "other", flags: [] };
  let text = "";
  try {
    if (out.kind === "pdf") text = await readPdf(new Uint8Array(await file.arrayBuffer()), out);
    else {
      // Metadata sits at the start of an image file; Content Credentials can be larger, so read up to 2 MB.
      const bytes = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
      if (out.kind === "jpeg") text = readJpeg(bytes, out);
      else if (out.kind === "png") text = await readPng(bytes, out);
    }
  } catch { /* unreadable: no flags from it */ }
  if (imageSize) { out.width ??= imageSize.width; out.height ??= imageSize.height; }

  if (AI_SOURCE.test(text)) out.aiLabel = "IPTC digital source: AI-generated";
  else if (out.c2pa && AI_TOOLS.test(text)) out.aiLabel = `Content Credentials: ${(AI_TOOLS.exec(text)?.[0] ?? "AI tool").trim()}`;
  else if (out.software && AI_TOOLS.test(out.software)) out.aiLabel = `Software: ${out.software}`;
  if (!out.aiPrompt && /Negative prompt:|Steps: \d+, Sampler:|"sampler_name"|"ckpt_name"/.test(text)) out.aiPrompt = true;

  const sources = [out.software, out.pdf?.producer, out.pdf?.creator, (/<xmp:CreatorTool>([^<]{1,120})</i.exec(text) ?? [])[1]]
    .filter((v): v is string => !!v);
  out.scanned = sources.some((s) => SCANNERS.test(s));

  const f = out.flags;
  if (out.aiLabel) f.push("ai_label");
  if (out.aiPrompt) f.push("ai_prompt");
  if (out.kind !== "pdf" && sources.some((s) => EDITORS.test(s))) f.push("editing_software");
  if (out.kind === "pdf" && out.pdf) {
    if (!out.scanned && sources.some((s) => DESIGNED_PDF.test(s))) f.push("pdf_designed");
    if (sources.some((s) => EDITORS.test(s) && !DESIGNED_PDF.test(s))) f.push("editing_software");
    const changedLater = pdfDate(out.pdf.modified) - pdfDate(out.pdf.created) > 2 * 60 * 1000;
    const extraSaves = out.pdf.saves > (out.pdf.linearized ? 2 : 1) && !out.pdf.signed;
    if (changedLater || extraSaves || sources.some((s) => PDF_EDITORS.test(s))) f.push("pdf_edited");
  }
  if (out.kind === "jpeg" && !out.make && !out.model && !out.scanned) f.push("no_camera_data");
  if (out.kind === "png" && !out.scanned) f.push("png_not_camera");
  if (out.kind !== "pdf" && out.width && out.height && AI_SIZES.has(`${out.width}x${out.height}`)) f.push("ai_size");
  if (out.kind !== "pdf" && out.width && out.height && AI_SIZES.has(`${out.height}x${out.width}`) && !f.includes("ai_size")) f.push("ai_size");
  return out;
}
