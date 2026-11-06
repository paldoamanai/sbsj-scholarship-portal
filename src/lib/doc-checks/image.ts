// Image measurements done in the browser on a grayscale copy: sharpness, light, framing, a "looks alike"
// fingerprint and a coarse layout signature. Thresholds are starting points; the raw numbers are saved
// with each document so they can be tuned against real uploads.

export type Gray = { data: Float32Array; w: number; h: number };

/** Draws an image (or a rendered PDF page) to a grayscale buffer whose long side is at most `max` px. */
export function toGray(src: CanvasImageSource & { width: number; height: number }, max = 1000): Gray {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
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

/** Gradient magnitude per pixel (simple central differences). */
function gradient(g: Gray): Float32Array {
  const { data, w, h } = g;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i + 1] - data[i - 1];
      const gy = data[i + w] - data[i - w];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

export type Quality = {
  blur: number;          // 0 = sharp … 1 = very blurry (re-blur metric over the tiles with text, 25th percentile)
  brightness: number;    // mean, 0-255
  darkest: number;       // 2nd percentile brightness
  paper: number;         // median brightness
  saturated: number;     // share of pixels at 250+
  fill: number;          // share of the frame the content covers
  edgeSides: number;     // sides where text runs into the edge
  flags: string[];
};

/** Above this the text is visibly soft (about a 2 px blur on a 1000 px page). */
export const BLUR_THRESHOLD = 0.2;

/**
 * How blurry the text is, 0 (sharp) to 1, after Crété-Roffet et al. (2007): blur the image again and
 * see how much of the edge contrast survives. A sharp image loses a lot, an already blurry one little.
 * Only real edges count (a step of 15+ grey levels), so page contrast and camera noise matter little.
 */
function reblurScore(g: Gray): number {
  const { data, w, h } = g;
  const R = 4, n = 2 * R + 1, tiles = 8;
  const scores: number[] = [];
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x0 = Math.floor((tx * w) / tiles) + R + 1, x1 = Math.floor(((tx + 1) * w) / tiles) - R - 1;
      const y0 = Math.floor((ty * h) / tiles) + R + 1, y1 = Math.floor(((ty + 1) * h) / tiles) - R - 1;
      if (x1 <= x0 || y1 <= y0) continue;
      let sF = 0, sV = 0, edges = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const dFv = Math.abs(data[i] - data[i - w]);
          const dFh = Math.abs(data[i] - data[i - 1]);
          if (dFv <= 14 && dFh <= 14) continue;
          let bv = 0, bvp = 0, bh = 0, bhp = 0;
          for (let k = -R; k <= R; k++) { bv += data[i + k * w]; bvp += data[i - w + k * w]; bh += data[i + k]; bhp += data[i - 1 + k]; }
          if (dFv > 14) { sF += dFv; sV += Math.max(0, dFv - Math.abs(bv - bvp) / n); }
          if (dFh > 14) { sF += dFh; sV += Math.max(0, dFh - Math.abs(bh - bhp) / n); }
          edges++;
        }
      }
      if (edges >= (x1 - x0) * (y1 - y0) * 0.01 && sF > 0) scores.push((sF - sV) / sF);
    }
  }
  if (scores.length) return percentile(scores, 0.25);
  // No crisp edge anywhere: blurry if there is anything on the page at all.
  let s = 0, q = 0;
  for (let i = 0; i < data.length; i += 7) { s += data[i]; q += data[i] * data[i]; }
  const count = Math.ceil(data.length / 7);
  return Math.sqrt(Math.max(0, q / count - (s / count) ** 2)) > 20 ? 1 : 0;
}

export function measureQuality(g: Gray, opts: { photo: boolean; shortSide: number }): Quality {
  const { data, w, h } = g;
  const blur = reblurScore(g);

  const sample: number[] = [];
  let total = 0, saturatedCount = 0;
  const step = Math.max(1, Math.floor(data.length / 50000));
  for (let i = 0; i < data.length; i += step) {
    const v = data[i];
    sample.push(v); total += v;
    if (v >= 250) saturatedCount++;
  }
  const brightness = total / sample.length;
  const darkest = percentile(sample, 0.02);
  const paper = percentile(sample, 0.5);
  const saturated = saturatedCount / sample.length;

  // Framing: where the strong edges (text, lines, the paper's border) are.
  const grad = gradient(g);
  const xs: number[] = [], ys: number[] = [];
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    if (grad[y * w + x] > 40) { xs.push(x); ys.push(y); }
  }
  let fill = 1;
  if (xs.length > 200) {
    const bw = percentile(xs, 0.99) - percentile(xs, 0.01);
    const bh = percentile(ys, 0.99) - percentile(ys, 0.01);
    fill = Math.max(0, (bw * bh) / (w * h));
  }
  // Text running into the edge: the outer 2% strip is about as busy as the middle of the page.
  const density = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0, c = 0;
    for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y += 2) for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x += 2) {
      n++; if (grad[y * w + x] > 40) c++;
    }
    return n ? c / n : 0;
  };
  const mx = Math.max(2, Math.round(w * 0.02)), my = Math.max(2, Math.round(h * 0.02));
  const middle = density(Math.round(w * 0.2), Math.round(h * 0.2), Math.round(w * 0.8), Math.round(h * 0.8));
  const sides = [density(0, 0, w, my), density(0, h - my, w, h), density(0, 0, mx, h), density(w - mx, 0, w, h)];
  const edgeSides = middle > 0.02 ? sides.filter((d) => d > middle * 0.8).length : 0;

  const flags: string[] = [];
  if (blur > BLUR_THRESHOLD) flags.push("blurry");
  if (opts.photo && opts.shortSide < 1000) flags.push("low_resolution");
  if (brightness < 70) flags.push("too_dark");
  if ((saturated >= 0.02 && saturated <= 0.4 && paper < 215) || darkest > 140) flags.push("glare");
  if (opts.photo && fill < 0.35) flags.push("small_in_frame");
  if (opts.photo && edgeSides >= 2) flags.push("cut_off");
  return {
    blur: Math.round(blur * 1000) / 1000, brightness: Math.round(brightness), darkest: Math.round(darkest), paper: Math.round(paper),
    saturated: Math.round(saturated * 1000) / 1000, fill: Math.round(fill * 100) / 100, edgeSides, flags,
  };
}

/** Averages the image down to cols x rows cells. */
function cells(g: Gray, values: Float32Array, cols: number, rows: number): number[] {
  const out = new Array(cols * rows).fill(0);
  const count = new Array(cols * rows).fill(0);
  for (let y = 0; y < g.h; y++) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / g.h));
    for (let x = 0; x < g.w; x++) {
      const c = Math.min(cols - 1, Math.floor((x * cols) / g.w));
      out[r * cols + c] += values[y * g.w + x];
      count[r * cols + c]++;
    }
  }
  return out.map((v, i) => (count[i] ? v / count[i] : 0));
}

/**
 * A 256-bit "looks alike" fingerprint as 64 hex characters: the image averaged down to 32 x 32, its
 * lowest 16 x 16 cosine-transform frequencies, each above or below their median (a perceptual hash).
 * Re-saving, shrinking, recompressing or slightly blurring an image changes few bits; different documents
 * differ in about half.
 */
export function differenceHash(g: Gray): string {
  const N = 32, K = 16;
  const c = cells(g, g.data, N, N);
  const cos: number[][] = Array.from({ length: K }, (_, u) => Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));
  // Rows first, then columns (separable 2-D DCT-II), keeping only the low frequencies.
  const rows = Array.from({ length: N }, (_, y) => Array.from({ length: K }, (_, u) => {
    let s = 0;
    for (let x = 0; x < N; x++) s += c[y * N + x] * cos[u][x];
    return s;
  }));
  const coeffs: number[] = [];
  for (let v = 0; v < K; v++) for (let u = 0; u < K; u++) {
    let s = 0;
    for (let y = 0; y < N; y++) s += rows[y][u] * cos[v][y];
    coeffs.push(s);
  }
  const median = [...coeffs.slice(1)].sort((a, b) => a - b)[Math.floor((coeffs.length - 1) / 2)];
  let hex = "";
  for (let i = 0; i < coeffs.length; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (coeffs[i + b] > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export const hashDistance = (a: string, b: string) => {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
};

export type Layout = { grid: number[]; aspect: number };

/** Where the ink is: edge density on a 16 x 16 grid, plus the page's shape. */
export function layoutSignature(g: Gray): Layout {
  const grid = cells(g, gradient(g), 16, 16);
  const max = Math.max(...grid, 1e-6);
  return { grid: grid.map((v) => Math.round((v / max) * 1000) / 1000), aspect: Math.round((g.w / g.h) * 1000) / 1000 };
}

/** -1..1: how alike two layouts are (correlation of their grids), lowered when the page shapes differ. */
export function layoutSimilarity(a: Layout, b: Layout): number {
  const n = Math.min(a.grid.length, b.grid.length);
  if (!n) return 0;
  const ma = a.grid.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.grid.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a.grid[i] - ma, y = b.grid[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const corr = da && db ? num / Math.sqrt(da * db) : 0;
  const shape = Math.min(a.aspect, b.aspect) / Math.max(a.aspect, b.aspect);
  return Math.round(corr * (shape > 0.85 ? 1 : shape) * 100) / 100;
}

/** SHA-256 of a file, as hex. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A copy of an image source as a JPEG no larger than `max` px on its long side. */
export async function toJpeg(src: CanvasImageSource & { width: number; height: number }, max = 1600): Promise<Blob | null> {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(src.width * scale); canvas.height = Math.round(src.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
}
