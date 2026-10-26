import { LETTER_OF_INTENT, MOA } from "@/lib/documents";
import { OFFICE_LABEL, isOffice, type StaffOffice } from "@/lib/permissions";

/**
 * What an office asks for instead of Settings → Required Documents (migrations 070 and 071, which
 * keep the same rules in office_required_documents() and the office_* functions). The letter of
 * intent and the MOA have their own fields and checks (063, 071), so they aren't in these lists; their
 * notes are kept here with the rest.
 */
type OfficeRequirements = {
  /** Needed to apply. */
  documents: string[];
  /** Can follow after applying; needed (verified) before approval. */
  followUps: string[];
  /** Every document as a photo (JPG or PNG). */
  photosOnly: boolean;
  /** A letter of intent with each application. */
  asksLetter: boolean;
  /** The office visits the student's home before approving. */
  homeVisit: boolean;
  /** A signed MOA, verified before the first payout. */
  requiresMoa: boolean;
  /** What to bring to the office as well, by document. */
  notes: Record<string, string>;
};

const ORIGINAL = "Also submit the original copy to the office.";

export const OFFICE_REQUIREMENTS: Partial<Record<StaffOffice, OfficeRequirements>> = {
  barangay_affairs: {
    documents: ["Student ID", "Barangay Indigency", "Certificate of Registration", "Grades"],
    followUps: [],
    photosOnly: true,
    asksLetter: true,
    homeVisit: false,
    requiresMoa: false,
    notes: {
      [LETTER_OF_INTENT]: ORIGINAL,
      "Student ID": "Also submit a photocopy (xerox) to the office.",
      "Barangay Indigency": ORIGINAL,
      "Certificate of Registration": ORIGINAL,
      Grades: ORIGINAL,
    },
  },
  mswdo: {
    documents: ["School ID", "Certificate of Registration", "Barangay Indigency"],
    followUps: ["Latest Grades", "Simple Bio Data", "House Photo"],
    photosOnly: true,
    asksLetter: false,
    homeVisit: true,
    requiresMoa: true,
    notes: {
      "Simple Bio Data": ORIGINAL,
      "Barangay Indigency": ORIGINAL,
    },
  },
};

/** The follow-up photo that also needs the house pinned on a map. */
export const HOUSE_PHOTO = "House Photo";

const own = (office: string | null | undefined) => (isOffice(office) ? OFFICE_REQUIREMENTS[office] : undefined);

/** The documents a program asks for to apply: its office's own list, or the Settings list. */
export const programDocuments = (office: string | null | undefined, settingsList: string[]) =>
  own(office)?.documents ?? settingsList;

/** Documents that can follow after applying (needed before approval). */
export const followUpDocuments = (office: string | null | undefined) => own(office)?.followUps ?? [];

/** Everything approval needs: the documents to apply plus the follow-ups. */
export const approvalDocuments = (office: string | null | undefined, settingsList: string[]) =>
  [...programDocuments(office, settingsList), ...followUpDocuments(office)];

export const photosOnly = (office: string | null | undefined) => own(office)?.photosOnly ?? false;
export const asksLetter = (office: string | null | undefined) => own(office)?.asksLetter ?? true;
export const needsHomeVisit = (office: string | null | undefined) => own(office)?.homeVisit ?? false;
export const needsMoa = (office: string | null | undefined) => own(office)?.requiresMoa ?? false;
export const needsHousePin = (office: string | null | undefined) => followUpDocuments(office).includes(HOUSE_PHOTO);

/** What the office wants on paper as well, if anything. */
export const documentNote = (office: string | null | undefined, docType: string) => own(office)?.notes[docType];

/** Offices with their own list, for "Barangay Affairs programs: …" lines. */
export const officesWithOwnDocuments = () =>
  (Object.keys(OFFICE_REQUIREMENTS) as StaffOffice[]).map((office) => ({ office, label: OFFICE_LABEL[office], ...OFFICE_REQUIREMENTS[office]! }));

/** "MSWDO programs ask instead for photos (JPG or PNG) of: …. After applying: …. Also submit the original copy to the office: …." */
export const officeDocumentsSummary = (o: ReturnType<typeof officesWithOwnDocuments>[number]) => {
  const byNote = new Map<string, string[]>();
  for (const [doc, note] of Object.entries(o.notes)) byNote.set(note, [...(byNote.get(note) ?? []), doc]);
  const paper = [...byNote].map(([note, docs]) => `${note.replace(/\.$/, "")}: ${docs.join(", ")}.`).join(" ");
  const later = [
    ...(o.followUps.length ? [`after applying, ${o.followUps.join(", ")}${o.followUps.includes(HOUSE_PHOTO) ? " (with your house pinned on a map)" : ""}`] : []),
    ...(o.homeVisit ? ["a home visit the office schedules"] : []),
    ...(o.requiresMoa ? [`a signed ${MOA} before your first payout`] : []),
  ];
  return `${o.label} programs ask instead for${o.photosOnly ? " photos (JPG or PNG) of" : ""}: ${[...(o.asksLetter ? [LETTER_OF_INTENT] : []), ...o.documents].join(", ")}`
    + `${later.length ? `; then ${later.join("; ")}` : ""}.${paper ? ` ${paper}` : ""}`;
};
