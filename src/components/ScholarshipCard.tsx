"use client";

import { Calendar, GraduationCap, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ScholarshipCardProps {
  name: string;
  description: string;
  eligibility: string;
  deadline: string;
  onApply: () => void;
}

const ScholarshipCard = ({ name, description, eligibility, deadline, onApply }: ScholarshipCardProps) => {
  return (
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
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        <div className="flex items-start gap-2 text-sm">
          <GraduationCap className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <span className="text-muted-foreground">{eligibility}</span>
        </div>
        <Button onClick={onApply} className="w-full bg-gradient-primary shadow-primary group-hover:shadow-lg transition-shadow">
          Apply Now
          <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </CardContent>
    </Card>
  );
};

export default ScholarshipCard;
