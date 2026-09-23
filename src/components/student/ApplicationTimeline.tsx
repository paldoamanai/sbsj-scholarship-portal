"use client";

import { AlertTriangle, Check, Circle, Clock, X } from "lucide-react";
import { formatDate, pesoFixed } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

type App = Tables<"applications">;
type Payment = Tables<"payments">;

type Step = {
  key: string;
  title: string;
  detail?: string;
  date?: string | null;
  state: "done" | "current" | "upcoming" | "warn" | "bad";
};

/** The steps of one application, from submission to a confirmed receipt, for whatever state it is really in. */
export function buildTimeline(app: App, payments: Payment[]): Step[] {
  const mine = payments.filter((p) => p.application_id === app.id && p.status !== "Cancelled");
  const open = mine.filter((p) => p.status === "Pending" || p.status === "Processing");
  const disbursed = mine.filter((p) => p.status === "Disbursed");

  const steps: Step[] = [
    { key: "submitted", title: app.is_renewal ? "Renewal submitted" : "Application submitted", date: app.created_at, state: "done" },
  ];

  if (app.status === "Rejected") {
    steps.push({ key: "decision", title: "Not approved", date: app.updated_at, state: "bad",
      detail: app.notes || "Your application was not approved this time. You can apply again next year." });
    return steps;
  }
  if (app.status === "Revoked") {
    steps.push({ key: "decision", title: "Scholarship revoked", date: app.updated_at, state: "bad",
      detail: app.notes || "Your scholarship was revoked. Contact the scholarship office if you have questions." });
    return steps;
  }
  if (app.status === "Waitlisted") {
    steps.push({ key: "decision", title: "Waitlisted", date: app.updated_at, state: "warn",
      detail: app.notes || "You are on the waitlist. We will notify you if a slot opens." });
    return steps;
  }
  if (app.status === "Pending") {
    steps.push({ key: "review", title: "Under review", state: "current", detail: "The office is reviewing your application and documents." });
    steps.push({ key: "payment", title: "Payment scheduled", state: "upcoming" });
    steps.push({ key: "disbursed", title: "Payment received", state: "upcoming" });
    return steps;
  }

  // Approved
  steps.push({ key: "approved", title: "Approved", date: app.updated_at, state: "done",
    detail: [app.amount_approved != null ? `Award ${pesoFixed(app.amount_approved)}` : null, app.notes].filter(Boolean).join(" · ") || undefined });

  if (disbursed.length > 0) {
    steps.push({ key: "payment", title: "Payment scheduled", state: "done" });
    const last = [...disbursed].sort((a, b) => (b.disbursed_at ?? "").localeCompare(a.disbursed_at ?? ""))[0];
    steps.push({ key: "disbursed", title: "Payment released", date: last.disbursed_at, state: "done",
      detail: `${pesoFixed(disbursed.reduce((t, p) => t + p.amount, 0))} disbursed${open.length ? `, ${open.length} more scheduled` : ""}` });
    const unconfirmed = disbursed.filter((p) => !p.student_receipt_at || p.receipt_review_status === "Rejected");
    const waiting = disbursed.filter((p) => p.student_receipt_at && p.receipt_review_status === "Pending");
    steps.push(unconfirmed.length > 0
      ? { key: "receipt", title: "Submit your signed receipt", state: "current", detail: `${unconfirmed.length} payment${unconfirmed.length === 1 ? "" : "s"} still need${unconfirmed.length === 1 ? "s" : ""} your receipt.` }
      : waiting.length > 0
        ? { key: "receipt", title: "Receipt under review", state: "current", detail: "The office is checking your receipt." }
        : { key: "receipt", title: "Receipt accepted", state: "done" });
  } else if (open.length > 0) {
    const next = [...open].sort((a, b) => (a.scheduled_date ?? "9999").localeCompare(b.scheduled_date ?? "9999"))[0];
    steps.push({ key: "payment", title: "Payment scheduled", state: "current", date: next.scheduled_date,
      detail: `${pesoFixed(next.amount)} via ${next.method || "Cash or Cheque"}` });
    steps.push({ key: "disbursed", title: "Payment received", state: "upcoming" });
  } else {
    steps.push({ key: "payment", title: "Waiting for your payment to be scheduled", state: "current", detail: "The office will schedule it and you will be notified." });
    steps.push({ key: "disbursed", title: "Payment received", state: "upcoming" });
  }
  return steps;
}

const dot: Record<Step["state"], string> = {
  done: "bg-emerald-500 text-white",
  current: "bg-primary text-primary-foreground ring-4 ring-primary/15",
  upcoming: "bg-muted text-muted-foreground",
  warn: "bg-amber-500 text-white",
  bad: "bg-red-500 text-white",
};

export default function ApplicationTimeline({ app, payments }: { app: App; payments: Payment[] }) {
  const steps = buildTimeline(app, payments);
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const Icon = s.state === "done" ? Check : s.state === "bad" ? X : s.state === "warn" ? AlertTriangle : s.state === "current" ? Clock : Circle;
        return (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${dot[s.state]}`}><Icon className="h-3.5 w-3.5" /></span>
              {!last && <span className={`w-px flex-1 my-1 ${s.state === "done" ? "bg-emerald-300" : "bg-border"}`} />}
            </div>
            <div className={`pb-5 min-w-0 ${last ? "pb-0" : ""}`}>
              <p className={`text-sm font-semibold ${s.state === "upcoming" ? "text-muted-foreground" : "text-foreground"}`}>
                {s.title}{s.date && <span className="ml-2 text-xs font-normal text-muted-foreground">{formatDate(s.date)}</span>}
              </p>
              {s.detail && <p className={`text-xs mt-0.5 whitespace-pre-wrap ${s.state === "bad" ? "text-red-700" : s.state === "warn" ? "text-amber-700" : "text-muted-foreground"}`}>{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
