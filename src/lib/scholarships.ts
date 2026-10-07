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
  signedIn ? `/student-dashboard?section=application&apply=${encodeURIComponent(programId)}` : "/register";

export type RequirementCheck = { key: string; label: string; ok: boolean; detail: string };

/**
 * Whether a student meets one program's requirements, one line per rule. Each program (office) sets
 * its own grade, year level and residency rules on top of the global minimum grade; a renewal of the
 * same program is held to the renewal minimum instead. The database runs the same checks on approval.
 */
export function programChecks(
  s: Pick<PublicScholarship, "min_grade" | "year_levels" | "municipality">,
  profile: { average_grade: number | null; year_level: string | null; municipality: string | null } | null | undefined,
  rules: { globalMinGrade: number; renewalMinGrade: number; renewalEnabled: boolean; isRenewal: boolean }
): RequirementCheck[] {
  const checks: RequirementCheck[] = [];
  const renewal = rules.isRenewal && rules.renewalEnabled;
  const programGrade = Number(s.min_grade ?? 0);
  const grade = renewal ? rules.renewalMinGrade : Math.max(programGrade, rules.globalMinGrade);
  if (grade > 0) {
    const mine = profile?.average_grade ?? null;
    checks.push({
      key: "grade", label: `Average grade of at least ${grade}${renewal ? " (renewal)" : ""}`,
      ok: mine != null && mine >= grade,
      detail: mine == null ? "No average grade on the profile" : `Grade on file: ${mine}`,
    });
  }
  if (s.year_levels && s.year_levels.length > 0) {
    const mine = profile?.year_level ?? null;
    checks.push({
      key: "year", label: `Year level: ${s.year_levels.join(", ")}`,
      ok: !!mine && s.year_levels.includes(mine),
      detail: mine ? `Year level on file: ${mine}` : "No year level on the profile",
    });
  }
  const town = s.municipality?.trim();
  if (town) {
    const mine = profile?.municipality?.trim() ?? "";
    checks.push({
      key: "residency", label: `Resident of ${town}`,
      ok: mine.toLowerCase() === town.toLowerCase(),
      detail: mine ? `Municipality on file: ${mine}` : "No municipality on the profile",
    });
  }
  return checks;
}
