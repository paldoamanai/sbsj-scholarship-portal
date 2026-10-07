"use client";

import { ChevronRight, FileText, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/student/ui";
import { formatDate, peso } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

type AppRow = Tables<"applications"> & { scholarships: { name: string } | null };

/** "Contact the office" as a link to the Help tab when the caller can open it, plain text otherwise. */
export function ContactOffice({ onContact }: { onContact?: () => void }) {
  if (!onContact) return <>Contact the office</>;
  return (
    <button type="button" onClick={onContact} className="font-semibold underline underline-offset-2 hover:opacity-80 cursor-pointer">
      Contact the office
    </button>
  );
}

/** Why an application was disapproved, and when. Renders nothing for any other status. */
export function DisapprovalReason({ app, compact = false, onContact }: { app: Tables<"applications">; compact?: boolean; onContact?: () => void }) {
  if (app.status !== "Disapproved") return null;
  return (
    <div className={`rounded-xl border border-red-200 bg-red-50 text-red-800 ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}>
      <p className="font-semibold flex items-center gap-1.5">
        <XCircle className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /> Not approved · {formatDate(app.decided_at ?? app.updated_at)}
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        <span className="font-semibold">Reason: </span>
        {app.notes?.trim() || "The scholarship office did not give a reason."}
      </p>
      <p className="mt-1"><ContactOffice onContact={onContact} /> if you have questions.</p>
    </div>
  );
}

/** Every application the student has made, newest first, with disapproval reasons shown inline. */
export default function ApplicationHistory({ applications, onView, onContact, limit }: {
  applications: AppRow[];
  onView: (id: string) => void;
  /** Opens the Help tab from "Contact the office". */
  onContact?: () => void;
  /** Show only the newest N (the caller links to the full list). */
  limit?: number;
}) {
  const shown = limit ? applications.slice(0, limit) : applications;
  if (applications.length === 0) {
    return (
      <div className="text-center py-10 px-4">
        <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">You haven&apos;t applied for a scholarship yet.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {shown.map((a) => (
        <li key={a.id} className="px-4 sm:px-5 py-3.5 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground break-words">
                {a.scholarships?.name ?? "Scholarship"}
                {a.is_renewal && <span className="ml-2 rounded-full border border-primary/20 bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">Renewal</span>}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[a.academic_year, a.semester].filter(Boolean).join(" · ") || new Date(a.created_at).getFullYear()} · Submitted {formatDate(a.created_at)}
                {a.status === "Approved" && a.amount_approved != null ? ` · Award ${peso(a.amount_approved)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={a.status} />
              <button type="button" onClick={() => onView(a.id)}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:text-primary/80 cursor-pointer">
                Details <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <DisapprovalReason app={a} compact onContact={onContact} />
        </li>
      ))}
    </ul>
  );
}
