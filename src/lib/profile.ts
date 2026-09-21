import type { Tables } from "@/integrations/supabase/types";
import { isSHS } from "@/lib/academics";

type P = Partial<Tables<"profiles">> | null | undefined;

const has = (v: unknown) => (typeof v === "number" ? true : typeof v === "string" ? v.trim() !== "" : v != null);

/** What a complete student profile needs. Guardian details are asked for Grade 11–12 students. */
export function profileChecklist(p: P): { key: string; label: string; done: boolean }[] {
  const items = [
    { key: "first_name", label: "First name", done: has(p?.first_name) },
    { key: "last_name", label: "Last name", done: has(p?.last_name) },
    { key: "dob", label: "Date of birth", done: has(p?.dob) },
    { key: "sex", label: "Sex", done: has(p?.sex) },
    { key: "phone", label: "Mobile number", done: has(p?.phone) },
    { key: "barangay", label: "Barangay", done: has(p?.barangay) },
    { key: "municipality", label: "Municipality", done: has(p?.municipality) },
    { key: "year_level", label: "Year level", done: has(p?.year_level) },
    { key: "school_name", label: "School", done: has(p?.school_name) },
    { key: "course", label: "Course / strand", done: has(p?.course) },
    { key: "average_grade", label: "Average grade", done: has(p?.average_grade) },
  ];
  if (isSHS(p?.year_level)) {
    items.push(
      { key: "guardian_name", label: "Guardian name", done: has(p?.guardian_name) },
      { key: "guardian_phone", label: "Guardian mobile number", done: has(p?.guardian_phone) },
    );
  }
  return items;
}

export function profileCompleteness(p: P) {
  const items = profileChecklist(p);
  const missing = items.filter((i) => !i.done);
  return { percent: Math.round(((items.length - missing.length) / items.length) * 100), missing };
}
