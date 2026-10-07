// How a program pays its award: once a year, or half in each of the 1st and 2nd semesters (Summer is
// never paid). The award is always the yearly total. The database enforces the same rules (migration 056):
// one live payment per term, and an application's payments can't add up to more than its award.

import { peso } from "@/lib/format";

export type ReleaseSchedule = "yearly" | "semester";
export type PaymentTerm = "Yearly" | "1st Semester" | "2nd Semester";

export const RELEASE_SCHEDULES: { value: ReleaseSchedule; label: string; hint: string }[] = [
  { value: "yearly", label: "Once a year", hint: "The whole award is released in one payment." },
  { value: "semester", label: "Per semester", hint: "Half the award is released in the 1st semester and half in the 2nd." },
];

export const asSchedule = (v: string | null | undefined): ReleaseSchedule => (v === "semester" ? "semester" : "yearly");

export const termsFor = (schedule: string | null | undefined): PaymentTerm[] =>
  asSchedule(schedule) === "semester" ? ["1st Semester", "2nd Semester"] : ["Yearly"];

/** The amount released per term: half the yearly award per semester, or all of it once a year. */
export const termAmount = (award: number, schedule: string | null | undefined) =>
  asSchedule(schedule) === "semester" ? Math.round((award / 2) * 100) / 100 : award;

/** e.g. "1st Semester 2026-2027" or "A.Y. 2026-2027"; payments from before terms existed show just the year. */
export function termLabel(term: string | null | undefined, academicYear: string | null | undefined): string {
  if (term && term !== "Yearly") return [term, academicYear].filter(Boolean).join(" ");
  return academicYear ? `A.Y. ${academicYear}` : term === "Yearly" ? "Yearly" : "";
}

/** For students: "₱10,000 a year · ₱5,000 per semester" or "₱10,000 a year, released once". */
export const awardText = (amount: number | null | undefined, schedule: string | null | undefined) =>
  asSchedule(schedule) === "semester"
    ? `${peso(amount)} a year · ${peso(termAmount(Number(amount ?? 0), "semester"))} per semester`
    : `${peso(amount)} a year, released once`;

/** Terms of an award that no live (not cancelled) payment covers yet. */
export function openTerms(
  schedule: string | null | undefined,
  award: number,
  payments: { term: string | null; amount: number; status: string }[],
): PaymentTerm[] {
  const live = payments.filter((p) => p.status !== "Cancelled");
  if (award > 0 && live.reduce((t, p) => t + Number(p.amount), 0) >= award) return [];
  // Once a year: any payment covers it, including ones made before payments had a term.
  if (asSchedule(schedule) === "yearly") return live.length > 0 ? [] : ["Yearly"];
  const used = new Set(live.map((p) => p.term));
  return termsFor(schedule).filter((t) => !used.has(t));
}

/**
 * Before a 2nd-semester payment: the scholar should have a verified 1st-semester grade for the same
 * academic year that meets the minimum. Returns why not, or null. A warning only: the office decides.
 */
export function secondSemesterGradeWarning(
  profile: { average_grade: number | null; grade_term: string | null; grade_verified_at: string | null } | null | undefined,
  academicYear: string | null | undefined,
  minGrade: number,
): string | null {
  if (!profile?.grade_verified_at) return "No verified grade on file";
  const term = (profile.grade_term ?? "").toLowerCase();
  if (!term.includes("1st") || (academicYear && !term.includes(academicYear))) {
    return `Verified grade is for ${profile.grade_term || "another term"}, not 1st Semester ${academicYear ?? ""}`.trim();
  }
  if (minGrade > 0 && (profile.average_grade == null || profile.average_grade < minGrade)) {
    return `Grade ${profile.average_grade ?? "—"} is below the required ${minGrade}`;
  }
  return null;
}
