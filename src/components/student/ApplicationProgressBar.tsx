"use client";

import { CheckCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = ["Application", "Approval", "Disbursement"];

interface ApplicationProgressBarProps {
  currentStep: number; // 0-based: 0=Application, 1=Approval, 2=Disbursement
}

const ApplicationProgressBar = ({ currentStep }: ApplicationProgressBarProps) => {
  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-between relative">
        {/* Connecting line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted mx-8" />
        <div
          className="absolute top-5 left-0 h-0.5 bg-primary mx-8 transition-all duration-500"
          style={{ width: `calc(${(currentStep / (steps.length - 1)) * 100}% - 4rem)` }}
        />

        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={step} className="flex flex-col items-center z-10 relative">
              <div
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center border-2 transition-all",
                  isCompleted
                    ? "bg-primary border-primary text-primary-foreground"
                    : isCurrent
                    ? "bg-background border-primary text-primary ring-4 ring-primary/20"
                    : "bg-muted border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <Circle className="h-5 w-5" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs mt-2 font-medium",
                  isCompleted || isCurrent ? "text-primary" : "text-muted-foreground"
                )}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ApplicationProgressBar;
