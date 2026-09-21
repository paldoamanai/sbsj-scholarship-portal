import { CheckCircle, ChevronRight, Clock, XCircle, type LucideIcon } from "lucide-react";

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


export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "—") return <span className="text-sm text-muted-foreground">—</span>;
  const map: Record<string, { icon: LucideIcon; cls: string }> = {
    Approved:   { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Pending:    { icon: Clock,        cls: "bg-amber-50 text-amber-700 border-amber-200" },
    Rejected:   { icon: XCircle,      cls: "bg-red-50 text-red-700 border-red-200" },
    Disbursed:  { icon: CheckCircle,  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    Processing: { icon: Clock,        cls: "bg-accent text-primary border-primary/20" },
    Waitlisted: { icon: Clock,        cls: "bg-muted text-muted-foreground border-border" },
    Withdrawn:  { icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" },
    Cancelled:  { icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[status];
  if (!m) return <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">{status}</span>;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      <Icon className="h-3 w-3" />{status}
    </span>
  );
}

/** A headline number. Pass `onClick` to make the whole card a link to the relevant tab. */
export function StatCard({ icon: Icon, label, value, sub, subTone = "neutral", accent = false, onClick }: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  subTone?: "neutral" | "positive" | "warning";
  accent?: boolean;
  onClick?: () => void;
}) {
  const subClass = accent
    ? "text-primary-foreground/80"
    : subTone === "positive" ? "text-success"
    : subTone === "warning" ? "text-warning"
    : "text-muted-foreground";
  const body = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center ${accent ? "bg-white/20" : "bg-accent"}`}>
            <Icon className={`h-4.5 w-4.5 ${accent ? "text-primary-foreground" : "text-accent-foreground"}`} />
          </div>
          <p className={`text-xs font-medium ${accent ? "text-primary-foreground/90" : "text-muted-foreground"}`}>{label}</p>
        </div>
        {onClick && <ChevronRight className={`h-4 w-4 shrink-0 ${accent ? "text-primary-foreground/70" : "text-muted-foreground"}`} />}
      </div>
      <p className={`text-2xl font-bold font-display ${accent ? "text-primary-foreground" : "text-foreground"}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 font-medium ${subClass}`}>{sub}</p>}
    </>
  );
  const cls = `rounded-2xl p-5 border text-left w-full ${accent ? "bg-primary border-primary text-primary-foreground shadow-primary" : "bg-card border-border shadow-sm"}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} cursor-pointer transition-shadow hover:shadow-md`}>{body}</button>
    : <div className={cls}>{body}</div>;
}
