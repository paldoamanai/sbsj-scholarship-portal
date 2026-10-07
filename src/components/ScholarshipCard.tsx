"use client";

import { Calendar, GraduationCap, ChevronRight, Info, Clock, CheckCircle2, Banknote, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppDialog, DialogSection } from "@/components/AppDialog";
import { useState } from "react";
import { availabilityInfo, deadlineLabel, peso, requirementLines, slotsLabel, type PublicScholarship } from "@/lib/scholarships";

interface ScholarshipCardProps {
  program: PublicScholarship;
  /** Global minimum grade from settings, merged into the displayed requirements. */
  globalMinGrade?: number;
  onApply: () => void;
  /** Hide the per-scholar award amount (the landing page doesn't show it). */
  hideAmount?: boolean;
}

const ScholarshipCard = ({ program, globalMinGrade = 0, onApply, hideAmount = false }: ScholarshipCardProps) => {
  const [open, setOpen] = useState(false);
  const { name, description, eligibility } = program;
  const deadline = deadlineLabel(program.deadline);
  const { canApply, label } = availabilityInfo(program);
  const requirements = requirementLines(program, globalMinGrade);
  const hasAmount = !hideAmount && Number(program.amount) > 0;

  return (
    <>
      <Card className={`hover-lift group overflow-hidden ${canApply ? "border-primary/40 ring-2 ring-primary/15 shadow-md" : "border-border/50 opacity-75"}`}>
        <div className={`${canApply ? "h-1.5" : "h-1"} bg-gradient-primary`} />
        <CardHeader className="pb-3">
          {canApply && (
            <span className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Open now
            </span>
          )}
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg font-display">{name}</CardTitle>
            <Badge variant="secondary" className="shrink-0">
              <Calendar className="mr-1 h-3 w-3" />
              {deadline}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{description ?? ""}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {hasAmount && (
              <Badge variant="outline" className="gap-1"><Banknote className="h-3 w-3 text-primary" />{peso(program.amount)} per scholar</Badge>
            )}
            <Badge variant="outline" className="gap-1"><Users className="h-3 w-3 text-primary" />{slotsLabel(program)}</Badge>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <GraduationCap className="h-4 w-4 mt-0.5 text-primary shrink-0" />
            <span className="text-muted-foreground line-clamp-2">{requirements[0] ?? eligibility ?? "Open to all qualified applicants"}</span>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => setOpen(true)} className="w-full">
              <Info className="mr-2 h-4 w-4" />
              View Full Details
            </Button>
            <Button onClick={onApply} disabled={!canApply} className="w-full bg-gradient-primary shadow-primary group-hover:shadow-lg transition-shadow">
              {label}
              {canApply && <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AppDialog open={open} onOpenChange={setOpen} size="lg" className="border-t-4 border-t-primary"
        title={<span className="text-xl">{name}</span>}
        description={
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="secondary" className="inline-flex"><Calendar className="mr-1 h-3 w-3" />Deadline: {deadline}</Badge>
            {hasAmount && <Badge variant="secondary" className="inline-flex"><Banknote className="mr-1 h-3 w-3" />{peso(program.amount)} per scholar</Badge>}
            <Badge variant="secondary" className="inline-flex"><Users className="mr-1 h-3 w-3" />{slotsLabel(program)}</Badge>
          </div>
        }
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button disabled={!canApply} onClick={() => { setOpen(false); onApply(); }} className="bg-gradient-primary shadow-primary">
            {label}
            {canApply && <ChevronRight className="ml-1 h-4 w-4" />}
          </Button>
        </>}>
        {description && (
          <DialogSection title={<span className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" />About this Scholarship</span>}>
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          </DialogSection>
        )}

        <DialogSection title={<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" />Eligibility Requirements</span>}>
          {requirements.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
              {requirements.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {(eligibility || !requirements.length) && (
            <p className="text-sm text-muted-foreground leading-relaxed">{eligibility ?? "Open to all qualified applicants"}</p>
          )}
        </DialogSection>

        <DialogSection title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Application Period</span>}>
          <p className="text-sm text-muted-foreground">
            {program.open_date ? `Opens ${new Date(`${program.open_date}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}. ` : ""}
            {program.deadline ? `Closes ${new Date(`${program.deadline}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}.` : "No closing date."}
          </p>
        </DialogSection>

        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
          <GraduationCap className="h-5 w-5 shrink-0 text-primary" />
          <p>
            {canApply
              ? <>Ready to apply? Click <span className="font-semibold text-foreground">{label}</span> below to start your application. Make sure you meet all eligibility requirements before proceeding.</>
              : <span className="font-semibold text-foreground">{label}.</span>}
          </p>
        </div>
      </AppDialog>
    </>
  );
};

export default ScholarshipCard;
