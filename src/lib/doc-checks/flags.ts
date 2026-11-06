// What each document flag means, how serious it is, and how flags add up to a risk level.
// Flags only point reviewers at documents worth a closer look; none of them proves a document is fake.
// The database keeps the same "high" list in doc_high_flags() (migration 087): a document with one of
// those needs its original seen before it can be verified.

export type Severity = "high" | "medium" | "low";

export const FLAG_INFO: Record<string, { label: string; severity: Severity; detail: string }> = {
  // Duplicates (found by the database)
  same_file: { label: "Same file as another student", severity: "high", detail: "Another account uploaded this exact file." },
  similar_image: { label: "Looks like another student's", severity: "high", detail: "Nearly identical to another student's upload: a re-saved copy, or the same certificate with details changed." },
  reused_earlier_year: { label: "Reused from an earlier year", severity: "medium", detail: "The student uploaded the same document in an earlier school year." },
  duplicate_control_no: { label: "Control number used twice", severity: "high", detail: "Another student's document has the same control or registry number." },
  // Editing and AI (from the file)
  editing_software: { label: "Edited in an image editor", severity: "high", detail: "The file says it was saved by editing software (for example Photoshop, Canva or PicsArt)." },
  pdf_designed: { label: "PDF made, not scanned", severity: "medium", detail: "The PDF was made in Word, Canva, PowerPoint or similar, not by a scanner." },
  pdf_edited: { label: "PDF changed after it was made", severity: "medium", detail: "The PDF was saved again after it was created, or passed through a PDF editor." },
  no_camera_data: { label: "No camera data", severity: "low", detail: "A photo with no camera make or model. Many apps remove it, so this is weak on its own." },
  png_not_camera: { label: "PNG, not a camera photo", severity: "low", detail: "Phone cameras save JPG; a PNG is usually a screenshot, an export or a generated image." },
  ai_size: { label: "AI-typical image size", severity: "low", detail: "The image has a size AI generators use (for example 1024 × 1024)." },
  ai_label: { label: "AI label in the file", severity: "high", detail: "The file carries a label (Content Credentials or IPTC) saying it was made or edited by AI." },
  ai_prompt: { label: "AI generator settings in file", severity: "high", detail: "The file contains the prompt or settings of an AI image generator." },
  ai_detector_high: { label: "AI detector: likely AI", severity: "high", detail: "The AI detector scored this image as likely AI-generated." },
  ai_detector_medium: { label: "AI detector: possibly AI", severity: "medium", detail: "The AI detector scored this image as possibly AI-generated." },
  // Text on the document
  name_mismatch: { label: "Name doesn't match", severity: "high", detail: "The text was read clearly but the student's name isn't on it." },
  name_not_found: { label: "Name not found", severity: "medium", detail: "The student's name couldn't be found in the text. The text may just be hard to read." },
  birthdate_mismatch: { label: "Birthdate doesn't match", severity: "medium", detail: "Dates were found, but none is the birthdate on the student's profile." },
  barangay_mismatch: { label: "Different barangay", severity: "medium", detail: "The document names a different barangay from the student's profile." },
  school_mismatch: { label: "Different school", severity: "medium", detail: "The school on the document doesn't match the student's profile." },
  grade_mismatch: { label: "Grade doesn't match", severity: "medium", detail: "The average on the document differs from the one on the student's profile." },
  grade_out_of_scale: { label: "Grade out of scale", severity: "medium", detail: "The average isn't on a 1–5 or 60–100 scale." },
  future_date: { label: "Dated in the future", severity: "high", detail: "The issue date is after the day it was uploaded." },
  old_document: { label: "Old document", severity: "medium", detail: "Issued more than six months before it was uploaded." },
  wrong_school_year: { label: "Different school year", severity: "medium", detail: "The school year on the document isn't the one applied for." },
  official_misspelling: { label: "Misspelled official text", severity: "medium", detail: "Clearly printed official words are misspelled, a common sign of a made-up document." },
  signatory_unknown: { label: "Signatory not on file", severity: "medium", detail: "None of the signatories on file for this document is named on it." },
  signatory_outdated: { label: "Former signatory", severity: "high", detail: "The document names a signatory who no longer holds the post." },
  layout_differs: { label: "Layout differs from sample", severity: "medium", detail: "The layout doesn't match the genuine sample on file." },
  // Image quality
  blurry: { label: "Blurry", severity: "low", detail: "The text in the photo isn't sharp." },
  low_resolution: { label: "Low resolution", severity: "low", detail: "The image is small (under 1000 px on its short side)." },
  too_dark: { label: "Too dark", severity: "low", detail: "The photo is very dark." },
  glare: { label: "Glare or washed out", severity: "low", detail: "Part of the document is lost to glare, or the photo is washed out." },
  small_in_frame: { label: "Document small in photo", severity: "low", detail: "The document fills only a small part of the photo." },
  cut_off: { label: "May be cut off", severity: "low", detail: "Text runs to the edge of the photo; part of the document may be missing." },
  // Location
  photo_far_from_pin: { label: "Far from house pin", severity: "low", detail: "The house photo was taken away from where the student pinned their house." },
  photo_outside_town: { label: "Taken outside San Jose", severity: "medium", detail: "The house photo's location is outside the municipality." },
};

export const HIGH_FLAGS = Object.keys(FLAG_INFO).filter((k) => FLAG_INFO[k].severity === "high");

/** Flags about the photo itself: shown to the student at upload so they can retake it. */
export const QUALITY_FLAGS = ["blurry", "low_resolution", "too_dark", "glare", "small_in_frame", "cut_off"];

export const flagInfo = (code: string) =>
  FLAG_INFO[code] ?? { label: code.replace(/_/g, " "), severity: "low" as Severity, detail: "" };

export type Risk = "none" | "low" | "medium" | "high";
export const RISK_ORDER: Risk[] = ["none", "low", "medium", "high"];

/** One document: high with any serious flag or three medium ones, and so on down. */
export function documentRisk(flags: readonly string[] | null | undefined): Risk {
  const list = flags ?? [];
  const n = (s: Severity) => list.filter((f) => flagInfo(f).severity === s).length;
  if (n("high") > 0 || n("medium") >= 3) return "high";
  if (n("medium") > 0 || n("low") >= 3) return "medium";
  if (n("low") > 0) return "low";
  return "none";
}

/** An application: its riskiest document; barred students are always high. */
export function applicationRisk(docs: { flags?: readonly string[] | null }[], barred = false): Risk {
  if (barred) return "high";
  return docs.reduce<Risk>((worst, d) => {
    const r = documentRisk(d.flags);
    return RISK_ORDER.indexOf(r) > RISK_ORDER.indexOf(worst) ? r : worst;
  }, "none");
}

export const RISK_LABEL: Record<Risk, string> = { none: "No flags", low: "Low risk", medium: "Medium risk", high: "High risk" };
export const RISK_TONE: Record<Risk, string> = {
  none: "bg-emerald-50 text-emerald-700 border-emerald-200",
  low: "bg-sky-50 text-sky-700 border-sky-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  high: "bg-red-50 text-red-700 border-red-200",
};
export const SEVERITY_TONE: Record<Severity, string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-muted text-muted-foreground border-border",
};

/** Disapproval reasons reviewers pick from (they can still edit the text). */
export const DISAPPROVAL_REASONS = [
  "The photo is blurry. Please upload a sharper photo where all the text can be read.",
  "Part of the document is cut off. Please upload a photo that shows the whole document.",
  "The photo is too dark or has glare. Please retake it in good light.",
  "This is not the document we asked for. Please upload the correct one.",
  "The name or details don't match your profile. Please upload your own, current document.",
  "The document is out of date. Please upload one issued within the last six months.",
  "The document appears to have been edited. Please bring the original to the office.",
  "We couldn't confirm this document with the office that issued it. Please bring the original to the office.",
];
