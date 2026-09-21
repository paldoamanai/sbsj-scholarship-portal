import type { Database } from "@/integrations/supabase/types";
import { daysUntil, formatDate } from "@/lib/format";
export { peso } from "@/lib/format";

export type PublicScholarship = Database["public"]["Functions"]["scholarships_public"]["Returns"][number];

export const YEAR_LEVELS = ["Grade 11", "Grade 12", "1st Year", "2nd Year", "3rd Year", "4th Year"] as const;


/** Short label for the deadline badge. */
export function deadlineLabel(deadline: string | null): string {
  if (!deadline) return "Open";
  const days = daysUntil(deadline);
  if (days < 0) return "Closed";
  if (days === 0) return "Due today";
  if (days <= 7) return `${days}d left`;
  return formatDate(deadline);
}

/** What the apply button should say / do for a program. */
export function availabilityInfo(s: Pick<PublicScholarship, "availability" | "open_date">): { canApply: boolean; label: string } {
  switch (s.availability) {
    case "upcoming": return { canApply: false, label: s.open_date ? `Opens ${formatDate(s.open_date)}` : "Not open yet" };
    case "closed":   return { canApply: false, label: "Applications closed" };
    case "full":     return { canApply: false, label: "All slots filled" };
    default:         return { canApply: true, label: "Apply Now" };
  }
}

export function slotsLabel(s: Pick<PublicScholarship, "slots" | "slots_left">): string {
  return s.slots > 0 ? `${s.slots_left ?? 0} of ${s.slots} slots left` : "Unlimited slots";
}

/** The program's structured requirements, as readable lines (the free-text eligibility is separate). */
export function requirementLines(
  s: Pick<PublicScholarship, "min_grade" | "year_levels" | "municipality">,
  globalMinGrade = 0
): string[] {
  const lines: string[] = [];
  const grade = Math.max(Number(s.min_grade ?? 0), globalMinGrade);
  if (grade > 0) lines.push(`Average grade of at least ${grade}`);
  if (s.year_levels && s.year_levels.length > 0) lines.push(`Year level: ${s.year_levels.join(", ")}`);
  if (s.municipality?.trim()) lines.push(`Resident of ${s.municipality.trim()}`);
  return lines;
}

/** Where "Apply" should send someone. */
export const applyHref = (programId: string, signedIn: boolean) =>
  signedIn ? `/student-dashboard?section=application&apply=${encodeURIComponent(programId)}` : `/register?program=${encodeURIComponent(programId)}`;
