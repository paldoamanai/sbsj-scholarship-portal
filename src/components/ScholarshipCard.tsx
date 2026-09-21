"use client";

import { Calendar, GraduationCap, ChevronRight, Info, Clock, CheckCircle2, Banknote, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useState } from "react";
import { availabilityInfo, deadlineLabel, peso, requirementLines, slotsLabel, type PublicScholarship } from "@/lib/scholarships";

interface ScholarshipCardProps {
  program: PublicScholarship;
  /** Global minimum grade from settings, merged into the displayed requirements. */
  globalMinGrade?: number;
  onApply: () => void;
}

const ScholarshipCard = ({ program, globalMinGrade = 0, onApply }: ScholarshipCardProps) => {
  const [open, setOpen] = useState(false);
  const { name, description, eligibility } = program;
  const deadline = deadlineLabel(program.deadline);
  const { canApply, label } = availabilityInfo(program);
  const requirements = requirementLines(program, globalMinGrade);
  const hasAmount = Number(program.amount) > 0;

  return (
    <>
      <Card className={`hover-lift group overflow-hidden border-border/50 ${canApply ? "" : "opacity-90"}`}>
        <div className="h-1 bg-gradient-primary" />
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="h-1 bg-gradient-primary rounded-t-lg -mx-6 -mt-6 mb-2" />
          <DialogHeader>
            <DialogTitle className="text-xl font-display pr-6">{name}</DialogTitle>
            <DialogDescription asChild>
              <div className="pt-1 flex flex-wrap gap-2">
                <Badge variant="secondary" className="inline-flex">
                  <Calendar className="mr-1 h-3 w-3" />
                  Deadline: {deadline}
                </Badge>
                {hasAmount && <Badge variant="secondary" className="inline-flex"><Banknote className="mr-1 h-3 w-3" />{peso(program.amount)} per scholar</Badge>}
                <Badge variant="secondary" className="inline-flex"><Users className="mr-1 h-3 w-3" />{slotsLabel(program)}</Badge>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {description && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Info className="h-4 w-4 text-primary" />
                  About this Scholarship
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed pl-6">{description}</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Eligibility Requirements
              </div>
              {requirements.length > 0 && (
                <ul className="list-disc pl-11 pr-2 text-sm text-muted-foreground space-y-0.5">
                  {requirements.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              <p className="text-sm text-muted-foreground leading-relaxed pl-6">{eligibility ?? (requirements.length ? "" : "Open to all qualified applicants")}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Application Period
              </div>
              <p className="text-sm text-muted-foreground pl-6">
                {program.open_date ? `Opens ${new Date(`${program.open_date}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}. ` : ""}
                {program.deadline ? `Closes ${new Date(`${program.deadline}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}.` : "No closing date."}
              </p>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              <GraduationCap className="mb-2 h-5 w-5 text-primary" />
              {canApply
                ? <>Ready to apply? Click <span className="font-semibold text-foreground">Apply Now</span> below to start your application. Make sure you meet all eligibility requirements before proceeding.</>
                : <span className="font-semibold text-foreground">{label}.</span>}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="sm:flex-1">Close</Button>
            </DialogClose>
            <Button
              disabled={!canApply}
              onClick={() => { setOpen(false); onApply(); }}
              className="sm:flex-1 bg-gradient-primary shadow-primary"
            >
              {label}
              {canApply && <ChevronRight className="ml-1 h-4 w-4" />}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ScholarshipCard;
