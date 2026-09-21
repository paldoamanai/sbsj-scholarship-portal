// Small layout pieces shared by the student dashboard and its extracted sections.

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-5 w-1 rounded-full bg-primary" />
      <h2 className="font-display font-semibold text-foreground text-base">{children}</h2>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl border border-border shadow-sm ${className}`}>
      {children}
    </div>
  );
}
