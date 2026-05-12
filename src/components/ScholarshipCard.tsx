"use client";

import { Calendar, GraduationCap, ChevronRight, Info, Clock, CheckCircle2 } from "lucide-react";
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

interface ScholarshipCardProps {
  name: string;
  description: string;
  eligibility: string;
  deadline: string;
  onApply: () => void;
}

const ScholarshipCard = ({ name, description, eligibility, deadline, onApply }: ScholarshipCardProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="hover-lift group overflow-hidden border-border/50">
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
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{description}</p>
          <div className="flex items-start gap-2 text-sm">
            <GraduationCap className="h-4 w-4 mt-0.5 text-primary shrink-0" />
            <span className="text-muted-foreground line-clamp-2">{eligibility}</span>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(true)}
              className="w-full"
            >
              <Info className="mr-2 h-4 w-4" />
              View Full Details
            </Button>
            <Button onClick={onApply} className="w-full bg-gradient-primary shadow-primary group-hover:shadow-lg transition-shadow">
              Apply Now
              <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <div className="h-1 bg-gradient-primary rounded-t-lg -mx-6 -mt-6 mb-2" />
          <DialogHeader>
            <DialogTitle className="text-xl font-display pr-6">{name}</DialogTitle>
            <DialogDescription asChild>
              <div className="pt-1">
                <Badge variant="secondary" className="inline-flex">
                  <Calendar className="mr-1 h-3 w-3" />
                  Deadline: {deadline}
                </Badge>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Info className="h-4 w-4 text-primary" />
                About this Scholarship
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-6">{description}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Eligibility Requirements
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-6">{eligibility}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Application Deadline
              </div>
              <p className="text-sm text-muted-foreground pl-6">{deadline}</p>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              <GraduationCap className="mb-2 h-5 w-5 text-primary" />
              Ready to apply? Click <span className="font-semibold text-foreground">Apply Now</span> below to start your application. Make sure you meet all eligibility requirements before proceeding.
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="sm:flex-1">Close</Button>
            </DialogClose>
            <Button
              onClick={() => { setOpen(false); onApply(); }}
              className="sm:flex-1 bg-gradient-primary shadow-primary"
            >
              Apply Now
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ScholarshipCard;
