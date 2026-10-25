// How a program pays its award: once ever (a one-time grant that can't be renewed), once a year, half in each of the 1st and 2nd semesters (Summer is never
// paid), or in equal monthly releases over the program's number of months (Month 1 to Month N, 10 by
// default). The award is the yearly total, or for a one-time grant the whole amount. A one-time payment is
// recorded under the "Yearly" term. The database enforces the same rules (migrations 056, 064 and 069): one
// live payment per term, an application's payments can't add up to more than its award, and a student
// approved for a one-time program once can't apply to it again.

import { peso } from "@/lib/format";

export type ReleaseSchedule = "one_time" | "yearly" | "semester" | "monthly";
export type PaymentTerm = "Yearly" | "1st Semester" | "2nd Semester" | `Month ${number}`;

export const RELEASE_SCHEDULES: { value: ReleaseSchedule; label: string; hint: string }[] = [
  { value: "one_time", label: "One-time", hint: "The whole award is released once. Scholars can't renew it in later years." },
  { value: "yearly", label: "Once a year", hint: "The whole award is released in one payment." },
  { value: "semester", label: "Per semester", hint: "Half the award is released in the 1st semester and half in the 2nd." },
  { value: "monthly", label: "Monthly", hint: "The award is split into equal monthly releases." },
];

/** Months a monthly program pays over, when it doesn't say (a school year is about ten months). */
export const DEFAULT_RELEASE_MONTHS = 10;

export const asSchedule = (v: string | null | undefined): ReleaseSchedule =>
  v === "one_time" || v === "semester" || v === "monthly" ? v : "yearly";
/** A one-time grant: paid once, and a scholar approved for it can't apply to it again. */
export const isOneTime = (v: string | null | undefined) => v === "one_time";
/** A program's number of monthly releases: 1 to 12. */
export const asMonths = (v: number | null | undefined) =>
  Number.isInteger(v) && v! >= 1 && v! <= 12 ? v! : DEFAULT_RELEASE_MONTHS;
export const isMonthTerm = (t: string | null | undefined): t is `Month ${number}` => /^Month (?:[1-9]|1[0-2])$/.test(t ?? "");

export const termsFor = (schedule: string | null | undefined, months?: number | null): PaymentTerm[] => {
  const s = asSchedule(schedule);
  if (s === "semester") return ["1st Semester", "2nd Semester"];
  if (s === "monthly") return Array.from({ length: asMonths(months) }, (_, i) => `Month ${i + 1}` as const);
  return ["Yearly"];
};

/** The amount released per term: the award split over the program's terms (to the centavo). */
export const termAmount = (award: number, schedule: string | null | undefined, months?: number | null) => {
  const n = termsFor(schedule, months).length;
  return n > 1 ? Math.round((award / n) * 100) / 100 : award;
};

/** e.g. "1st Semester 2026-2027", "Month 3, A.Y. 2026-2027" or "A.Y. 2026-2027"; payments from before terms existed show just the year. */
export function termLabel(term: string | null | undefined, academicYear: string | null | undefined): string {
  if (isMonthTerm(term)) return academicYear ? `${term}, A.Y. ${academicYear}` : term;
  if (term && term !== "Yearly") return [term, academicYear].filter(Boolean).join(" ");
  return academicYear ? `A.Y. ${academicYear}` : term === "Yearly" ? "Yearly" : "";
}

/** For students: "₱10,000.00 a year · ₱5,000.00 per semester", "… · ₱1,000.00 a month for 10 months" or "… released once". */
export const awardText = (amount: number | null | undefined, schedule: string | null | undefined, months?: number | null) => {
  const s = asSchedule(schedule);
  const each = peso(termAmount(Number(amount ?? 0), s, months));
  if (s === "semester") return `${peso(amount)} a year · ${each} per semester`;
  if (s === "monthly") return `${peso(amount)} a year · ${each} a month for ${asMonths(months)} months`;
  if (s === "one_time") return `${peso(amount)}, one-time grant`;
  return `${peso(amount)} a year, released once`;
};

/** Terms of an award that no live (not cancelled) payment covers yet. */
export function openTerms(
  schedule: string | null | undefined,
  award: number,
  payments: { term: string | null; amount: number; status: string }[],
  months?: number | null,
): PaymentTerm[] {
  const live = payments.filter((p) => p.status !== "Cancelled");
  if (award > 0 && live.reduce((t, p) => t + Number(p.amount), 0) >= award) return [];
  // Once a year or one-time: any payment covers it, including ones made before payments had a term.
  if (asSchedule(schedule) === "yearly" || asSchedule(schedule) === "one_time") return live.length > 0 ? [] : ["Yearly"];
  const used = new Set(live.map((p) => p.term));
  return termsFor(schedule, months).filter((t) => !used.has(t));
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
