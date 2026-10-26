import { LETTER_OF_INTENT } from "@/lib/documents";
import { OFFICE_LABEL, isOffice, type StaffOffice } from "@/lib/permissions";

/**
 * Documents an office asks for instead of Settings → Required Documents (migration 070, which keeps
 * the same lists in office_required_documents()). The letter of intent is filed with each
 * application (063), so it isn't one of the shared documents; its note is kept here with the rest.
 */
type OfficeRequirements = {
  documents: string[];
  /** Every document as a photo (JPG or PNG). */
  photosOnly: boolean;
  /** What to bring to the office as well, by document. */
  notes: Record<string, string>;
};

const ORIGINAL = "Also submit the original copy to the office.";

export const OFFICE_REQUIREMENTS: Partial<Record<StaffOffice, OfficeRequirements>> = {
  barangay_affairs: {
    documents: ["Student ID", "Barangay Indigency", "Certificate of Registration", "Grades"],
    photosOnly: true,
    notes: {
      [LETTER_OF_INTENT]: ORIGINAL,
      "Student ID": "Also submit a photocopy (xerox) to the office.",
      "Barangay Indigency": ORIGINAL,
      "Certificate of Registration": ORIGINAL,
      Grades: ORIGINAL,
    },
  },
};

const own = (office: string | null | undefined) => (isOffice(office) ? OFFICE_REQUIREMENTS[office] : undefined);

/** The shared documents a program asks for: its office's own list, or the Settings list. */
export const programDocuments = (office: string | null | undefined, settingsList: string[]) =>
  own(office)?.documents ?? settingsList;

export const photosOnly = (office: string | null | undefined) => own(office)?.photosOnly ?? false;

/** What the office wants on paper as well, if anything. */
export const documentNote = (office: string | null | undefined, docType: string) => own(office)?.notes[docType];

/** Offices with their own list, for "Barangay Affairs programs: …" lines. */
export const officesWithOwnDocuments = () =>
  (Object.keys(OFFICE_REQUIREMENTS) as StaffOffice[]).map((office) => ({ office, label: OFFICE_LABEL[office], ...OFFICE_REQUIREMENTS[office]! }));

/** "Barangay Affairs programs ask instead for photos (JPG or PNG) of: …. Also submit the original copy to the office: …." */
export const officeDocumentsSummary = (o: ReturnType<typeof officesWithOwnDocuments>[number]) => {
  const byNote = new Map<string, string[]>();
  for (const [doc, note] of Object.entries(o.notes)) byNote.set(note, [...(byNote.get(note) ?? []), doc]);
  const paper = [...byNote].map(([note, docs]) => `${note.replace(/\.$/, "")}: ${docs.join(", ")}.`).join(" ");
  return `${o.label} programs ask instead for${o.photosOnly ? " photos (JPG or PNG) of" : ""}: ${[LETTER_OF_INTENT, ...o.documents].join(", ")}.${paper ? ` ${paper}` : ""}`;
};
