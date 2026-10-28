"use client";

// The fields of the add / edit scholarship dialog. The admin page owns the form (and reads it with
// FormData on submit), the year-level / barangay selections and the active switch; this lays them out.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "@/components/icons";
import type { Tables } from "@/integrations/supabase/types";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { YEAR_LEVELS } from "@/lib/scholarships";
import { BARANGAYS, HOME_MUNICIPALITY } from "@/lib/barangays";
import { RELEASE_SCHEDULES, asMonths, asSchedule, yearlyAward } from "@/lib/release-schedule";
import { pesoFixed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OFFICE_FULL_NAME, STAFF_OFFICES, isOffice } from "@/lib/permissions";

type Props = {
  cur: Tables<"scholarships"> | null;
  yearLevels: string[];
  setYearLevels: (f: (prev: string[]) => string[]) => void;
  barangays: string[];
  setBarangays: (v: string[] | ((prev: string[]) => string[])) => void;
  barangaySearch: string;
  setBarangaySearch: (v: string) => void;
  active: boolean;
  setActive: (v: boolean) => void;
  /** e.g. "₱40,000.00 of ₱100,000.00 committed in 2026-2027", for a program with a budget. */
  committedNote?: string | null;
  /**
   * Which office the program belongs to. "choose": the signer works across offices and picks one;
   * an office: the signer belongs to it, so the program does too; undefined: offices aren't set up.
   */
  office?: "choose" | string;
  /** Existing programs; a new program's name suggests the names of its own office's programs. */
  programs?: Pick<Tables<"scholarships">, "name" | "office">[];
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const LONG_TEXT_MAX = 2000; // scholarshipSchema's limit

/** A paragraph box that grows with its text (up to a point, then scrolls) and counts characters. */
function LongTextField({ id, name, label, hint, placeholder, defaultValue }: {
  id: string; name: string; label: string; hint: string; placeholder: string; defaultValue: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [length, setLength] = useState(defaultValue.length);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, []);
  const near = length > LONG_TEXT_MAX * 0.9;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea ref={ref} id={id} name={name} defaultValue={defaultValue} placeholder={placeholder} maxLength={LONG_TEXT_MAX}
        aria-describedby={`${id}-hint`}
        className="min-h-[7.5rem] max-h-80 resize-y leading-relaxed"
        onInput={(e) => { setLength(e.currentTarget.value.length); fit(); }} />
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <p id={`${id}-hint`}>{hint}</p>
        <span className={cn("shrink-0 tabular-nums", near && "text-amber-600")} aria-live="polite">
          {length.toLocaleString()} / {LONG_TEXT_MAX.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function ScholarshipFormFields({
  cur, yearLevels, setYearLevels, barangays, setBarangays, barangaySearch, setBarangaySearch, active, setActive, committedNote, office, programs = [],
}: Props) {
  const [programOffice, setProgramOffice] = useState<string>(cur?.office ?? "");
  // The office the new program will belong to: the signer's own, or the one picked below ("" is the Mayor Office).
  const nameOffice = isOffice(office) ? office : programOffice;
  const nameSuggestions = cur ? [] : [...new Set(programs.filter((p) => (p.office ?? "") === nameOffice).map((p) => p.name.trim()).filter(Boolean))]
    .sort((x, y) => x.localeCompare(y));
  // The form remounts per program (it's keyed by id), so this starts from the program's schedule.
  const [schedule, setSchedule] = useState(asSchedule(cur?.release_schedule));
  const [months, setMonths] = useState(String(asMonths(cur?.release_months)));
  // Followed only to show what each release (or a semester program's year) comes to.
  const [award, setAward] = useState(String(cur?.amount ?? 0));
  // New programs aren't paid per semester; one that already is keeps the choice so editing doesn't change it.
  const schedules = RELEASE_SCHEDULES.filter((r) => r.value !== "semester" || cur?.release_schedule === "semester");
  const shownBarangays = BARANGAYS.filter((b) => b.toLowerCase().includes(barangaySearch.trim().toLowerCase()));

  return (
    <div className="space-y-7">
      <Section title="Program">
        <div className={cn("grid gap-4", office && "sm:grid-cols-[minmax(0,1fr)_16rem]")}>
          <Field label="Name" htmlFor="sch-name">
            <Input id="sch-name" name="name" required defaultValue={cur?.name ?? ""} placeholder="e.g. Academic Excellence Scholarship"
              list={nameSuggestions.length ? "sch-name-suggestions" : undefined} autoComplete="off" />
            {nameSuggestions.length > 0 && (
              <datalist id="sch-name-suggestions">{nameSuggestions.map((n) => <option key={n} value={n} />)}</datalist>
            )}
          </Field>
          {office === "choose" && (
            <Field label="Office" hint="Its staff handle the program's applicants and payments">
              <input type="hidden" name="office" value={programOffice} />
              <Select value={programOffice || "none"} onValueChange={(v) => setProgramOffice(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Mayor Office</SelectItem>
                  {STAFF_OFFICES.map((o) => <SelectItem key={o} value={o}>{OFFICE_FULL_NAME[o]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {isOffice(office) && (
            <Field label="Office">
              <p className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">{OFFICE_FULL_NAME[office]}</p>
            </Field>
          )}
        </div>
        <LongTextField id="sch-description" name="description" label="Description" defaultValue={cur?.description ?? ""}
          placeholder="What the program offers, who funds it and what scholars get."
          hint="Shown on the program card and its details. Leave a blank line between paragraphs." />
        <LongTextField id="sch-eligibility" name="eligibility" label="Who can apply" defaultValue={cur?.eligibility ?? ""}
          placeholder={"e.g.\nEnrolled full-time in a state university or college\nFamily income of ₱250,000 or less a year\nNo other government scholarship"}
          hint="Put each requirement on its own line: students see them as a bulleted list. Grade, year level and barangay rules below are added automatically." />
      </Section>

      <Section title="Award and capacity" hint="Slots and budget refill when a new academic year starts.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Award per scholar (₱)" htmlFor="sch-amount" hint={schedule === "one_time" ? "Paid once" : schedule === "semester" ? "Per semester, paid in each of the two" : schedule === "monthly" ? "Per month, paid every month" : "The yearly total"}>
            <MoneyInput id="sch-amount" name="amount" min={0} defaultValue={cur?.amount ?? 0} onValueChange={setAward} />
          </Field>
          <Field label="Budget (₱)" htmlFor="sch-budget" hint="Per academic year · 0 = no cap">
            <MoneyInput id="sch-budget" name="total_budget" min={0} defaultValue={cur?.total_budget ?? 0} />
          </Field>
          <Field label="Slots" htmlFor="sch-slots" hint="Per academic year · 0 = unlimited">
            <Input id="sch-slots" name="slots" type="number" min={0} step={1} defaultValue={cur?.slots ?? ""} placeholder="50" />
          </Field>
        </div>
        {committedNote && <p className="-mt-1 text-xs text-muted-foreground">{committedNote}</p>}
        <div className="space-y-1.5">
          <Label id="sch-schedule-label">Release schedule</Label>
          <input type="hidden" name="release_schedule" value={schedule} />
          <div role="radiogroup" aria-labelledby="sch-schedule-label" className={cn("grid gap-3", schedules.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            {schedules.map((r) => {
              const on = schedule === r.value;
              return (
                <button key={r.value} type="button" role="radio" aria-checked={on} onClick={() => setSchedule(r.value)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                  )}>
                  <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border", on ? "border-primary bg-primary" : "border-muted-foreground/40")}>
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <span>
                    <span className={cn("block text-sm font-medium", on && "text-primary")}>{r.label}</span>
                    <span className="block text-xs text-muted-foreground">{r.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <input type="hidden" name="release_months" value={months} />
          {schedule === "semester" && Number(award) > 0 && (
            <p className="pt-1 text-xs text-muted-foreground tabular-nums">
              {pesoFixed(Number(award))} in the 1st Semester and {pesoFixed(Number(award))} in the 2nd: {pesoFixed(yearlyAward(Number(award), "semester"))} a year per scholar
            </p>
          )}
          {schedule === "monthly" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <Label htmlFor="sch-months" className="font-normal">Released over</Label>
              <Select value={months} onValueChange={setMonths}>
                <SelectTrigger id="sch-months" className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => <SelectItem key={m} value={m}>{m} {m === "1" ? "month" : "months"}</SelectItem>)}
                </SelectContent>
              </Select>
              {Number(award) > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {pesoFixed(Number(award))} a month (Month 1 to Month {months}): {pesoFixed(yearlyAward(Number(award), "monthly", Number(months)))} a year per scholar
                </span>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Application window">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens" htmlFor="sch-open">
            <Input id="sch-open" name="open_date" type="date" defaultValue={cur?.open_date ?? ""} />
          </Field>
          <Field label="Deadline" htmlFor="sch-deadline">
            <Input id="sch-deadline" name="deadline" type="date" defaultValue={cur?.deadline ?? ""} />
          </Field>
          <div className="space-y-1.5">
            <Label htmlFor="sch-active">Status</Label>
            <label htmlFor="sch-active" className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-md border border-input px-3">
              <span className="text-sm">{active ? "Accepting applications" : "Not accepting"}</span>
              <Switch id="sch-active" checked={active} onCheckedChange={setActive} />
            </label>
          </div>
        </div>
      </Section>

      <Section title="Eligibility rules" hint={`Checked when a student applies. Every program is for ${HOME_MUNICIPALITY} residents.`}>
        <Field label="Minimum average grade" htmlFor="sch-min-grade" hint="Leave blank to use the global minimum" className="sm:max-w-[calc((100%-2rem)/3)]">
          <Input id="sch-min-grade" name="min_grade" type="number" min={0} max={100} step="0.01" defaultValue={cur?.min_grade ?? ""} placeholder="e.g. 85" />
        </Field>

        <div className="space-y-1.5">
          <Label>Year levels <span className="font-normal text-muted-foreground">· none selected = any</span></Label>
          <div className="flex flex-wrap gap-2">
            {YEAR_LEVELS.map((y) => {
              const on = yearLevels.includes(y);
              return (
                <button key={y} type="button" aria-pressed={on}
                  onClick={() => setYearLevels((prev) => (on ? prev.filter((x) => x !== y) : [...prev, y]))}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40",
                  )}>
                  {on && <Check className="h-3.5 w-3.5" />}{y}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="sch-barangay-search">
              Barangays <span className="font-normal text-muted-foreground">· none selected = all of {HOME_MUNICIPALITY}</span>
            </Label>
            {barangays.length > 0 && (
              <button type="button" className="shrink-0 text-xs font-medium text-primary hover:underline cursor-pointer" onClick={() => setBarangays([])}>
                Clear {barangays.length} selected
              </button>
            )}
          </div>
          <div className="rounded-md border">
            <div className="border-b p-2">
              <Input id="sch-barangay-search" className="h-9" value={barangaySearch} onChange={(e) => setBarangaySearch(e.target.value)} placeholder="Search barangays" />
            </div>
            {/* relative: Radix positions each checkbox's hidden input against the nearest positioned box. */}
            <div className="relative grid max-h-52 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto p-3 sm:grid-cols-3">
              {shownBarangays.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No barangay matches “{barangaySearch.trim()}”.</p>}
              {shownBarangays.map((b) => (
                <label key={b} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox className="rounded-[4px]" checked={barangays.includes(b)}
                    onCheckedChange={(v) => setBarangays((prev) => (v ? [...prev, b] : prev.filter((x) => x !== b)))} />
                  {b}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
