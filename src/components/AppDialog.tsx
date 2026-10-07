"use client";

// One layout for every dialog in the app (admin and student): a bordered header (title + optional description), a padded body,
// and a footer that stays in view while the body scrolls. Plus the pieces dialogs repeat: a labelled
// field, a label/value grid for details, a titled section, and the "write a reason" confirmation.
import type { FormEventHandler, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "sm:max-w-md",    // confirmations and one-field reasons
  md: "sm:max-w-lg",    // short forms
  lg: "sm:max-w-2xl",   // details and longer forms
  xl: "sm:max-w-3xl",   // two-column forms
  "2xl": "sm:max-w-5xl", // report previews
} as const;

type AppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof SIZES;
  /** Buttons, right-aligned on wider screens. The footer stays visible while the body scrolls. */
  footer?: ReactNode;
  /** Makes the body and footer one form (the footer's submit button submits it). */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Remounts the form, e.g. per record being edited. */
  formKey?: string;
  /** Extra classes for the dialog panel itself (e.g. the student dashboard's rounder corners). */
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
};

export function AppDialog({ open, onOpenChange, title, description, size = "md", footer, onSubmit, formKey, className, bodyClassName, children }: AppDialogProps) {
  const body = <div className={cn("space-y-5 px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>;
  const foot = footer && (
    // Phones: buttons share rows (two to a row) instead of stacking into a tall column.
    <DialogFooter className="sticky bottom-0 z-10 flex-row flex-wrap border-t bg-background px-5 py-3 sm:px-6 sm:py-4 [&>button]:min-w-[calc(50%-0.25rem)] [&>button]:flex-1 sm:[&>button]:min-w-0 sm:[&>button]:flex-none">{footer}</DialogFooter>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-none gap-0 p-0 sm:p-0", SIZES[size], className)}>
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="font-display text-lg leading-snug">{title}</DialogTitle>
          {/* A div, so descriptions can hold badges and other block elements. */}
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {onSubmit ? <form key={formKey} onSubmit={onSubmit}>{body}{foot}</form> : <>{body}{foot}</>}
      </DialogContent>
    </Dialog>
  );
}

/** A label, the control, and an optional hint under it. */
export function DialogField({ label, htmlFor, hint, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A titled block inside a dialog body, with an optional action (e.g. a small button) on the right. */
export function DialogSection({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label / value pairs in two columns (one on phones). */
export function DetailGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2", className)}>{children}</dl>;
}

export function Detail({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{children ?? "—"}</dd>
    </div>
  );
}

type ReasonDialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  label?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  /** A reason is required unless this is false. */
  required?: boolean;
  confirmLabel: ReactNode;
  confirmVariant?: "destructive" | "default" | "outline";
  cancelLabel?: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
};

/** "Write why, then confirm" — disapprovals, revocations, declines and similar. */
export function ReasonDialog({
  open, onClose, title, description, label = "Reason", hint, placeholder, value, onChange, rows = 3, maxLength,
  required = true, confirmLabel, confirmVariant = "destructive", cancelLabel = "Cancel", busy, onConfirm,
}: ReasonDialogProps) {
  return (
    <AppDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} size="sm" title={title} description={description}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
        <Button variant={confirmVariant} disabled={busy || (required && !value.trim())} onClick={onConfirm}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{confirmLabel}
        </Button>
      </>}>
      <DialogField label={label} htmlFor="reason-dialog-text" hint={hint}>
        <Textarea id="reason-dialog-text" rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus />
      </DialogField>
    </AppDialog>
  );
}

/** One option of a small "pick one" group (payment method, period). Use inside a role="radiogroup". */
export function ChoiceButton({ selected, disabled, onClick, children, className }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={onClick}
      className={cn(
        "flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary bg-primary/5 text-primary" : "border-border enabled:hover:border-primary/40 enabled:cursor-pointer",
        className,
      )}>
      {children}
    </button>
  );
}

/** A highlighted note inside a dialog: a warning, or neutral information. */
export function DialogNote({ tone = "info", icon, children }: { tone?: "info" | "warning"; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
      tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "bg-muted/40 text-muted-foreground",
    )}>
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
