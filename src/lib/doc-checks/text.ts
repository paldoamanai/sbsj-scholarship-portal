// Reading the text on a document (Tesseract.js in the reviewer's browser, or the PDF's own text) and
// checking it against the student's profile, the signatories on file and the school year.
// Text recognition makes mistakes, especially on phone photos and handwriting, so a check that can't
// find something says "not found" rather than "wrong" unless the text was read clearly.

import { BARANGAYS } from "@/lib/barangays";

export type OcrWord = { text: string; confidence: number };
export type OcrResult = { text: string; words: OcrWord[]; confidence: number };

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let worker: Promise<TesseractWorker> | null = null;

/** One English recognizer per page load, created on first use (its language data comes from a CDN). */
export async function ocr(image: HTMLCanvasElement | Blob): Promise<OcrResult> {
  worker ??= import("tesseract.js").then((t) => t.createWorker("eng"));
  const w = await worker;
  const { data } = await w.recognize(image, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) {
    words.push({ text: wd.text, confidence: wd.confidence });
  }
  return { text: data.text ?? "", words, confidence: data.confidence ?? 0 };
}

// ── Helpers ──
export const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, " ").trim();

export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Whether a word (allowing a misread letter or two in longer words) appears in the text's words. */
function hasWord(words: string[], target: string) {
  const t = norm(target);
  if (!t) return true;
  const allowed = t.length >= 8 ? 2 : t.length >= 5 ? 1 : 0;
  return words.some((w) => w === t || (allowed > 0 && editDistance(w, t, allowed) <= allowed));
}

/** Whether every word of a phrase appears (as words, in any order). */
const hasAll = (words: string[], phrase: string) => norm(phrase).split(" ").filter(Boolean).every((p) => hasWord(words, p));

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthOf = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().replace(/\.$/, "").slice(0, 3)));

export type FoundDate = { date: Date; issued: boolean; raw: string };

/** Dates in the text, in the forms Philippine documents use. `issued` marks "this 5th day of ..." and "Date issued". */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const add = (y: number, m: number, d: number, raw: string, issued = false) => {
    if (y < 1900 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return;
    const date = new Date(Date.UTC(y, m, d));
    if (date.getUTCMonth() !== m) return;
    out.push({ date, issued, raw });
  };
  const t = text.replace(/\s+/g, " ");
  const issuedNear = (i: number) => /issued|given|done|dated|date of issue/i.test(t.slice(Math.max(0, i - 40), i));
  let m: RegExpExecArray | null;
  const dayOf = /(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]{3,9})\.?,?\s*(?:in\s+the\s+year\s+)?(\d{4})/gi;
  while ((m = dayOf.exec(t))) add(+m[3], monthOf(m[2]), +m[1], m[0], true);
  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;
  while ((m = named.exec(t))) if (monthOf(m[1]) >= 0) add(+m[3], monthOf(m[1]), +m[2], m[0], issuedNear(m.index));
  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g;
  while ((m = dayFirst.exec(t))) if (monthOf(m[2]) >= 0 && !/day\s+of/i.test(m[0])) add(+m[3], monthOf(m[2]), +m[1], m[0], issuedNear(m.index));
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g; // month first, as Philippine forms write it
  while ((m = numeric.exec(t))) add(+m[3], +m[1] - 1, +m[2], m[0], issuedNear(m.index));
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(t))) add(+m[1], +m[2] - 1, +m[3], m[0], issuedNear(m.index));
  return out;
}

const sameDay = (a: Date, b: Date) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();

/** "2025-2026", "S.Y. 2025 - 2026", "AY 2025–26" → "2025-2026". */
export function findSchoolYears(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(20\d{2})\s*[-–—/]\s*(20\d{2}|\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = +m[1];
    const b = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    if (b === a + 1) out.add(`${a}-${b}`);
  }
  return [...out];
}

/** A control / registry / O.R. number printed on the document, if there is one. */
export function findControlNumber(text: string): string | null {
  const re = /(?:control|registry|reg\.?|series|cert(?:ificate)?|o\.?\s?r\.?|ctc|serial)\s*(?:no\.?|number|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/]{2,24})/i;
  const m = re.exec(text.replace(/\s+/g, " "));
  if (!m) return null;
  const v = m[1].toUpperCase().replace(/[^A-Z0-9\-/]/g, "");
  return /\d/.test(v) && v.length >= 3 ? v : null;
}

// Official words, and real words close to them that must not count as misspellings.
const OFFICIAL = ["republic", "philippines", "province", "occidental", "mindoro", "municipality", "barangay", "certificate",
  "certification", "indigency", "registration", "punong", "statistics", "authority", "registrar", "municipal", "secretary"];
const NEAR_REAL = new Set(["certified", "certify", "certifies", "certificates", "certifications", "registered", "register",
  "registers", "registrars", "registrations", "philippine", "provinces", "provincial", "municipalities", "barangays",
  "statistical", "statistic", "authorities", "authorized", "republics", "municipally", "secretariat", "secretaries", "occidentale",
  "indigent", "indigents"]);

export type ProfileForText = {
  first_name?: string | null; middle_name?: string | null; last_name?: string | null; dob?: string | null;
  barangay?: string | null; school_name?: string | null; average_grade?: number | null;
};
export type Signatory = { name: string; position?: string | null; active: boolean; document_type?: string | null; place?: string | null };

export type TextFindings = {
  chars: number;
  confidence: number;
  name?: "found" | "partial" | "not_found";
  birthdate?: "match" | "mismatch" | "not_found";
  barangay?: { found: string[]; match: boolean | null };
  school?: "match" | "mismatch" | "not_found";
  grade?: { value: number; scale: "college" | "percent" | "unknown" } | null;
  issued?: string | null;
  schoolYears?: string[];
  misspelled?: string[];
  signatory?: { status: "on_file" | "former" | "not_on_file"; name?: string } | null;
  controlNo?: string | null;
  flags: string[];
};

const NO_NAME = ["House Photo", "Letter of Intent", "MOA Agreement Letter", "Simple Bio Data"];
const SCHOOL_DOCS = ["Certificate of Registration", "Grades", "Latest Grades", "Student ID", "School ID"];
const GRADE_DOCS = ["Grades", "Latest Grades"];
const BIRTH_DOCS = ["Birth Certificate", "PSA Birth Certificate", "Valid ID"];
const ISSUED_DOCS = ["Barangay Indigency", "Barangay Clearance", "Certificate of Residency"];
const GENERIC_SCHOOL = new Set(["of", "the", "and", "de", "del", "college", "university", "school", "institute", "national", "high",
  "state", "academy", "inc", "foundation", "center", "centre", "colleges", "senior", "integrated", "memorial", "occidental", "mindoro", "san", "jose"]);

/**
 * Checks the text against what the document should say.
 * `uploadedAt` is when it was uploaded; `academicYear` the school year applied for.
 */
export function checkText(input: {
  text: string; words: OcrWord[]; confidence: number; docType: string; profile: ProfileForText;
  signatories: Signatory[]; uploadedAt: Date; academicYear: string | null;
}): TextFindings {
  const { text, docType, profile } = input;
  const words = norm(text).split(" ").filter(Boolean);
  const f: TextFindings = { chars: text.replace(/\s/g, "").length, confidence: Math.round(input.confidence), flags: [] };
  const readable = f.chars >= 80;
  const clear = readable && input.confidence >= 75 && words.length >= 30;
  if (!readable) return f;

  // Name
  if (!NO_NAME.includes(docType) && (profile.first_name || profile.last_name)) {
    const last = profile.last_name ? hasAll(words, profile.last_name) : false;
    const first = profile.first_name ? hasAll(words, profile.first_name.split(" ")[0]) : false;
    f.name = last && first ? "found" : last || first ? "partial" : "not_found";
    if (f.name === "not_found") f.flags.push(clear ? "name_mismatch" : "name_not_found");
  }

  const dates = findDates(text);
  // Birthdate
  if (BIRTH_DOCS.includes(docType) && profile.dob) {
    const dob = new Date(`${profile.dob}T00:00:00Z`);
    if (!dates.length) f.birthdate = "not_found";
    else {
      f.birthdate = dates.some((d) => sameDay(d.date, dob)) ? "match" : "mismatch";
      if (f.birthdate === "mismatch") f.flags.push("birthdate_mismatch");
    }
  }

  // Barangay
  if (/barangay|indigency|residency|clearance/i.test(docType) && profile.barangay) {
    const t = ` ${norm(text)} `;
    const found = BARANGAYS.filter((b) => t.includes(` ${norm(b)} `));
    const mine = found.some((b) => norm(b) === norm(profile.barangay!));
    f.barangay = { found, match: found.length ? mine : null };
    if (found.length && !mine) f.flags.push("barangay_mismatch");
  }

  // School
  if (SCHOOL_DOCS.includes(docType) && profile.school_name) {
    const all = norm(profile.school_name).split(" ").filter((w) => w.length >= 3);
    const distinct = all.filter((w) => !GENERIC_SCHOOL.has(w));
    const tokens = distinct.length ? distinct : all;
    const hits = tokens.filter((tk) => hasWord(words, tk)).length;
    f.school = !tokens.length ? undefined : hits / tokens.length >= 0.5 ? "match" : clear ? "mismatch" : "not_found";
    if (f.school === "mismatch") f.flags.push("school_mismatch");
  }

  // Grade average
  if (GRADE_DOCS.includes(docType)) {
    const m = /(general\s+(?:weighted\s+)?average|gen\.?\s*ave(?:rage)?\.?|\bgwa\b|\bgpa\b|final\s+average|average)\s*[:=\-]?\s*(\d{1,3}(?:\.\d{1,4})?)/i.exec(text.replace(/\s+/g, " "));
    if (m) {
      const value = Number(m[2]);
      const scale = value >= 1 && value <= 5 ? "college" : value >= 60 && value <= 100 ? "percent" : "unknown";
      f.grade = { value, scale };
      if (scale === "unknown") f.flags.push("grade_out_of_scale");
      else if (scale === "percent" && profile.average_grade != null && profile.average_grade >= 60 && Math.abs(value - profile.average_grade) > 1) {
        f.flags.push("grade_mismatch");
      }
    } else f.grade = null;
  }

  // Issue date: not in the future, not older than six months
  if (ISSUED_DOCS.includes(docType)) {
    const issued = dates.filter((d) => d.issued).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    f.issued = issued ? issued.date.toISOString().slice(0, 10) : null;
    if (issued) {
      const day = 24 * 3600 * 1000;
      if (issued.date.getTime() > input.uploadedAt.getTime() + 2 * day) f.flags.push("future_date");
      else if (input.uploadedAt.getTime() - issued.date.getTime() > 183 * day) f.flags.push("old_document");
    }
  }

  // School year
  if (input.academicYear && (docType === "Certificate of Registration" || GRADE_DOCS.includes(docType))) {
    const years = findSchoolYears(text);
    f.schoolYears = years;
    const start = Number(input.academicYear.slice(0, 4));
    const ok = docType === "Certificate of Registration" ? [input.academicYear] : [input.academicYear, `${start - 1}-${start}`];
    if (years.length && !years.some((y) => ok.includes(y))) f.flags.push("wrong_school_year");
  }

  // Official words, clearly printed but misspelled
  const misspelled = new Set<string>();
  for (const w of input.words) {
    if (w.confidence < 92) continue;
    const t = norm(w.text);
    if (t.length < 6 || NEAR_REAL.has(t) || OFFICIAL.includes(t)) continue;
    if (t.endsWith("s") && OFFICIAL.includes(t.slice(0, -1))) continue;
    for (const o of OFFICIAL) {
      const max = o.length >= 9 ? 2 : 1;
      const d = editDistance(t, o, max);
      if (d >= 1 && d <= max) { misspelled.add(w.text); break; }
    }
  }
  if (misspelled.size) { f.misspelled = [...misspelled].slice(0, 8); f.flags.push("official_misspelling"); }

  // Signatories on file for this document (and the student's barangay or school)
  const place = (s: Signatory) => !s.place || [profile.barangay, profile.school_name].some((p) => p && norm(p) === norm(s.place!));
  const relevant = input.signatories.filter((s) => (!s.document_type || s.document_type === docType) && place(s));
  if (relevant.length) {
    const named = (s: Signatory) => {
      const parts = norm(s.name).split(" ").filter((p) => p.length >= 3);
      const last = parts[parts.length - 1];
      return !!last && hasWord(words, last) && parts.slice(0, -1).some((p) => hasWord(words, p));
    };
    const current = relevant.find((s) => s.active && named(s));
    const former = relevant.find((s) => !s.active && named(s));
    if (current) f.signatory = { status: "on_file", name: current.name };
    else if (former) { f.signatory = { status: "former", name: former.name }; f.flags.push("signatory_outdated"); }
    else if (relevant.some((s) => s.active)) { f.signatory = { status: "not_on_file" }; f.flags.push("signatory_unknown"); }
  }

  f.controlNo = findControlNumber(text);
  return f;
}
