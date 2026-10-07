"use client";

// The fields of the add / edit scholarship dialog. The admin page owns the form (and reads it with
// FormData on submit), the year-level / barangay selections and the active switch; this lays them out.
import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { YEAR_LEVELS } from "@/lib/scholarships";
import { BARANGAYS, HOME_MUNICIPALITY } from "@/lib/barangays";
import { RELEASE_SCHEDULES, asSchedule } from "@/lib/release-schedule";
import { cn } from "@/lib/utils";

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

export function ScholarshipFormFields({
  cur, yearLevels, setYearLevels, barangays, setBarangays, barangaySearch, setBarangaySearch, active, setActive, committedNote,
}: Props) {
  // The form remounts per program (it's keyed by id), so this starts from the program's schedule.
  const [schedule, setSchedule] = useState(asSchedule(cur?.release_schedule));
  const shownBarangays = BARANGAYS.filter((b) => b.toLowerCase().includes(barangaySearch.trim().toLowerCase()));

  return (
    <div className="space-y-7">
      <Section title="Program">
        <Field label="Name" htmlFor="sch-name">
          <Input id="sch-name" name="name" required defaultValue={cur?.name ?? ""} placeholder="e.g. Academic Excellence Scholarship" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Description" htmlFor="sch-description">
            <Textarea id="sch-description" name="description" rows={3} defaultValue={cur?.description ?? ""} placeholder="What the program offers" />
          </Field>
          <Field label="Who can apply" htmlFor="sch-eligibility">
            <Textarea id="sch-eligibility" name="eligibility" rows={3} defaultValue={cur?.eligibility ?? ""} placeholder="Shown to students on the program card" />
          </Field>
        </div>
      </Section>

      <Section title="Award and capacity" hint="Slots and budget refill when a new academic year starts.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Award per scholar (₱)" htmlFor="sch-amount" hint="The yearly total">
            <Input id="sch-amount" name="amount" type="number" min={0} step="0.01" defaultValue={cur?.amount ?? 0} />
          </Field>
          <Field label="Budget (₱)" htmlFor="sch-budget" hint="Per academic year · 0 = no cap">
            <Input id="sch-budget" name="total_budget" type="number" min={0} step="0.01" defaultValue={cur?.total_budget ?? 0} />
          </Field>
          <Field label="Slots" htmlFor="sch-slots" hint="Per academic year · 0 = unlimited">
            <Input id="sch-slots" name="slots" type="number" min={0} step={1} defaultValue={cur?.slots ?? ""} placeholder="50" />
          </Field>
        </div>
        {committedNote && <p className="-mt-1 text-xs text-muted-foreground">{committedNote}</p>}
        <div className="space-y-1.5">
          <Label id="sch-schedule-label">Release schedule</Label>
          <input type="hidden" name="release_schedule" value={schedule} />
          <div role="radiogroup" aria-labelledby="sch-schedule-label" className="grid gap-3 sm:grid-cols-2">
            {RELEASE_SCHEDULES.map((r) => {
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
