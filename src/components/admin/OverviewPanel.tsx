"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import {
  FileText, CheckCircle, XCircle, Clock, Users, Banknote, Plus, Bell, ArrowRight, GraduationCap,
  RefreshCw, Loader2, AlertTriangle, ShieldCheck, Wallet, CalendarClock, TrendingUp, TrendingDown, Minus,
  FileDown, ScrollText, Table2, BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

export type OverviewApp = Tables<"applications"> & { scholarships: { name: string } | null; profiles?: Tables<"profiles"> | null };

type Props = {
  applications: OverviewApp[];
  scholarships: Tables<"scholarships">[];
  profiles: Tables<"profiles">[];
  payments: Tables<"payments">[];
  verifications: Tables<"scholar_verifications">[];
  auditLogs: Tables<"audit_logs">[];
  firstName?: string | null;
  refreshing: boolean;
  lastUpdated: Date | null;
  loadError: string | null;
  onRefresh: () => void;
  onNavigate: (section: string, opts?: { status?: string; verif?: string }) => void;
  onViewApp: (a: OverviewApp) => void;
};

const formatPHP = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const initials = (first?: string | null, last?: string | null) => `${(first || "?")[0] || ""}${(last || "")[0] || ""}`.toUpperCase();
const DAY = 86400000;
const PERIODS: Record<string, string> = { all: "All time", "30d": "Last 30 days", "6m": "Last 6 months", year: "This year" };
const STATUS_COLOR: Record<string, string> = {
  Approved: "hsl(var(--success))", Rejected: "hsl(var(--destructive))", Pending: "hsl(var(--warning))", Waitlisted: "hsl(var(--muted-foreground))",
};

function periodStart(period: string): Date | null {
  const now = new Date();
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  if (period === "6m") return new Date(now.getFullYear(), now.getMonth() - 5, 1);
  if (period === "30d") return new Date(now.getTime() - 30 * DAY);
  return null;
}


// ── Chart building blocks ─────────────────────────────────────────────────────
type TableSpec = { head: string[]; rows: (string | number)[][] };

// Every chart can flip to a table (accessibility + exact values).
function ChartCard({ title, subtitle, table, empty, children, className }: {
  title: string; subtitle?: string; table: TableSpec; empty?: boolean; children: React.ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {!empty && (
            <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}
              aria-label={asTable ? `Show ${title} as chart` : `Show ${title} as table`}
              className="shrink-0 h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center cursor-pointer transition-colors">
              {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No data for this period yet.</p>
          </div>
        ) : asTable ? (
          <div className="max-h-[260px] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{table.head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-1.5 ${j === 0 ? "text-left" : "text-right tabular-nums"}`}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
}

function MonthTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{payload[0].value} application{payload[0].value === 1 ? "" : "s"}</p>
    </div>
  );
}

// Horizontal ranked bars with direct value labels — clearer than a pie for many categories.
function RankedBars({ rows, unit }: { rows: { name: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((t, r) => t + r.value, 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${r.value} ${unit} (${total ? Math.round((r.value / total) * 100) : 0}%)`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="tabular-nums font-semibold shrink-0">{r.value}<span className="ml-1 text-xs font-normal text-muted-foreground">{total ? Math.round((r.value / total) * 100) : 0}%</span></span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// One segmented bar (2px gaps) + a legend that carries label, count and share, so colour is never the only cue.
function SegmentedBar({ segments, total, ariaLabel }: { segments: { name: string; value: number; color: string; icon?: React.ReactNode }[]; total: number; ariaLabel: string }) {
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.filter((x) => x.value > 0).map((x) => (
          <div key={x.name} title={`${x.name}: ${x.value}`} className="h-full first:rounded-l-full last:rounded-r-full transition-all hover:opacity-80" style={{ width: `${(x.value / Math.max(1, total)) * 100}%`, background: x.color }} />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {segments.map((x) => (
          <li key={x.name} className="flex items-center gap-2 text-sm min-w-0">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: x.color }} />
            <span className="text-muted-foreground truncate">{x.name}</span>
            <span className="ml-auto tabular-nums font-semibold">{x.value}</span>
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{total ? Math.round((x.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Trend({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  if (previous === 0 && current === 0) return null;
  const pct = previous === 0 ? 100 : Math.round(((current - previous) / previous) * 100);
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const cls = pct > 0 ? "text-success" : pct < 0 ? "text-destructive" : "text-muted-foreground";
  return <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${cls}`}><Icon className="h-3 w-3" />{pct > 0 ? "+" : ""}{pct}%</span>;
}

export default function OverviewPanel({
  applications, scholarships, profiles, payments, verifications, auditLogs,
  firstName, refreshing, lastUpdated, loadError, onRefresh, onNavigate, onViewApp,
}: Props) {
  const [period, setPeriod] = useState("all");

  const data = useMemo(() => {
    const now = Date.now();
    const since = periodStart(period);
    const span = since ? now - since.getTime() : null;
    const prevSince = since && span ? new Date(since.getTime() - span) : null;
    const inCur = (iso: string) => !since || new Date(iso) >= since;
    const inPrev = (iso: string) => !!prevSince && !!since && new Date(iso) >= prevSince && new Date(iso) < since;
    const payDate = (p: Tables<"payments">) => p.disbursed_at || p.scheduled_date || p.created_at;
    const cnt = (list: OverviewApp[], st: string) => list.filter((a) => a.status === st).length;

    const curApps = applications.filter((a) => inCur(a.created_at));
    const prevApps = prevSince ? applications.filter((a) => inPrev(a.created_at)) : null;
    const total = curApps.length;
    const approved = cnt(curApps, "Approved");
    const rejected = cnt(curApps, "Rejected");
    const pending = cnt(curApps, "Pending");
    const waitlisted = cnt(curApps, "Waitlisted");

    const disbursed = payments.filter((p) => p.status === "Disbursed");
    const disbCur = disbursed.filter((p) => inCur(payDate(p))).reduce((t, p) => t + Number(p.amount || 0), 0);
    const disbPrev = prevSince ? disbursed.filter((p) => inPrev(payDate(p))).reduce((t, p) => t + Number(p.amount || 0), 0) : null;

    const newStudents = profiles.filter((p) => inCur(p.created_at)).length;
    const newStudentsPrev = prevSince ? profiles.filter((p) => inPrev(p.created_at)).length : null;

    // Chart: last N months, zero-filled.
    const nowD = new Date();
    const months = period === "year" ? nowD.getMonth() + 1 : period === "all" ? 12 : 6;
    const perMonth = Array.from({ length: months }, (_, i) => {
      const d = new Date(nowD.getFullYear(), nowD.getMonth() - (months - 1 - i), 1);
      const count = applications.filter((a) => { const c = new Date(a.created_at); return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth(); }).length;
      return { month: d.toLocaleString("default", { month: "short", year: "2-digit" }), count };
    });

    const statusPie = [
      { name: "Approved", value: approved }, { name: "Rejected", value: rejected },
      { name: "Pending", value: pending }, { name: "Waitlisted", value: waitlisted },
    ].filter((d) => d.value > 0);

    const dist = new Map<string, { name: string; value: number }>();
    curApps.forEach((a) => {
      const key = a.scholarship_id ?? "none";
      const e = dist.get(key) ?? { name: a.scholarships?.name || "Unassigned", value: 0 };
      e.value += 1; dist.set(key, e);
    });

    // Scholarships: slot usage + deadlines (all time, not period-bound).
    const active = scholarships.filter((s) => s.is_active);
    const approvedBy = (id: string) => applications.filter((a) => a.scholarship_id === id && a.status === "Approved").length;
    const applicantsBy = (id: string) => applications.filter((a) => a.scholarship_id === id).length;
    const deadlineOf = (s: Tables<"scholarships">) => (s.deadline ? new Date(`${s.deadline}T23:59:59`).getTime() : null);
    const closingSoon = active.filter((s) => { const d = deadlineOf(s); return d !== null && d >= now && d - now <= 14 * DAY; })
      .sort((x, y) => (deadlineOf(x)! - deadlineOf(y)!));
    const pastDeadline = active.filter((s) => { const d = deadlineOf(s); return d !== null && d < now; });
    const fullPrograms = active.filter((s) => s.slots > 0 && approvedBy(s.id) >= s.slots);

    // Money
    const sumAmt = (l: Tables<"payments">[]) => l.reduce((t, p) => t + Number(p.amount || 0), 0);
    const queuedList = payments.filter((p) => p.status === "Pending" || p.status === "Processing");
    const budget = active.reduce((t, s) => t + Number(s.total_budget || 0), 0);
    const disbursedAll = sumAmt(disbursed);
    const queued = sumAmt(queuedList);
    const remaining = budget - disbursedAll - queued;

    const paidAppIds = new Set(payments.filter((p) => p.status !== "Cancelled").map((p) => p.application_id).filter(Boolean));
    const awaiting = applications.filter((a) => a.status === "Approved" && !paidAppIds.has(a.id));
    const flagged = verifications.filter((v) => v.verification_status === "Flagged").length;
    const unverified = verifications.filter((v) => v.verification_status === "Pending").length;

    return {
      total, approved, rejected, pending, waitlisted, prevApps, prevTotal: prevApps?.length ?? null,
      prevApproved: prevApps ? cnt(prevApps, "Approved") : null, prevRejected: prevApps ? cnt(prevApps, "Rejected") : null,
      prevPending: prevApps ? cnt(prevApps, "Pending") : null,
      disbCur, disbPrev, newStudents, newStudentsPrev, perMonth, months, statusPie, distribution: (() => { const all = [...dist.values()].sort((x, y) => y.value - x.value); if (all.length <= 6) return all; const rest = all.slice(5).reduce((t, r) => t + r.value, 0); return [...all.slice(0, 5), { name: "Other programs", value: rest }]; })(),
      monthTotal: perMonth.reduce((t, m) => t + m.count, 0), monthAvg: perMonth.reduce((t, m) => t + m.count, 0) / perMonth.length, monthPeak: perMonth.reduce((b, m) => (m.count > b.count ? m : b), perMonth[0]),
      active, approvedBy, applicantsBy, closingSoon, pastDeadline, fullPrograms,
      budget, disbursedAll, queued, remaining, queuedCount: queuedList.length, awaiting, flagged, unverified,
      approvalRate: total ? Math.round((approved / total) * 100) : 0,
      rejectionRate: total ? Math.round((rejected / total) * 100) : 0,
      activeStudents: profiles.filter((p) => p.is_active).length,
    };
  }, [applications, scholarships, profiles, payments, verifications, period]);

  const pendingApps = useMemo(() => applications.filter((a) => a.status === "Pending").slice(0, 5), [applications]);
  const recent = useMemo(() => auditLogs.slice(0, 8), [auditLogs]);

  const stats = [
    { label: "Total Applicants", value: data.total, sub: `${data.pending} pending`, icon: FileText, color: "text-primary", trend: <Trend current={data.total} previous={data.prevTotal} />, go: () => onNavigate("applications", { status: "all" }) },
    { label: "Approved", value: data.approved, sub: `${data.approvalRate}% approval rate`, icon: CheckCircle, color: "text-success", trend: <Trend current={data.approved} previous={data.prevApproved} />, go: () => onNavigate("applications", { status: "approved" }) },
    { label: "Rejected", value: data.rejected, sub: `${data.rejectionRate}% rejection rate`, icon: XCircle, color: "text-destructive", trend: <Trend current={data.rejected} previous={data.prevRejected} />, go: () => onNavigate("applications", { status: "rejected" }) },
    { label: "Pending", value: data.pending, sub: "Needs review", icon: Clock, color: "text-warning", trend: <Trend current={data.pending} previous={data.prevPending} />, go: () => onNavigate("applications", { status: "pending" }) },
    { label: "Students", value: profiles.length, sub: `${data.activeStudents} active · ${data.newStudents} new`, icon: Users, color: "text-primary", trend: <Trend current={data.newStudents} previous={data.newStudentsPrev} />, go: () => onNavigate("students") },
    { label: "Disbursed", value: formatPHP(data.disbCur), sub: PERIODS[period], icon: Banknote, color: "text-success", trend: <Trend current={data.disbCur} previous={data.disbPrev} />, go: () => onNavigate("disbursement"), small: true },
  ];

  const attention = [
    { show: data.flagged > 0, icon: ShieldCheck, tone: "text-destructive", text: `${data.flagged} flagged verification${data.flagged === 1 ? "" : "s"}`, cta: "Review", go: () => onNavigate("verification", { verif: "Flagged" }) },
    { show: data.unverified > 0, icon: ShieldCheck, tone: "text-warning", text: `${data.unverified} scholar${data.unverified === 1 ? "" : "s"} awaiting verification`, cta: "Verify", go: () => onNavigate("verification", { verif: "Pending" }) },
    { show: data.awaiting.length > 0, icon: Wallet, tone: "text-warning", text: `${data.awaiting.length} approved application${data.awaiting.length === 1 ? "" : "s"} with no payment`, cta: "Disburse", go: () => onNavigate("disbursement") },
    { show: data.queuedCount > 0, icon: Banknote, tone: "text-primary", text: `${data.queuedCount} payment${data.queuedCount === 1 ? "" : "s"} pending or processing (${formatPHP(data.queued)})`, cta: "Open", go: () => onNavigate("disbursement") },
    { show: data.pending > 0, icon: Clock, tone: "text-warning", text: `${data.pending} application${data.pending === 1 ? "" : "s"} waiting for review`, cta: "Review", go: () => onNavigate("applications", { status: "pending" }) },
    ...data.closingSoon.map((s) => ({ show: true, icon: CalendarClock, tone: "text-warning", text: `${s.name} closes ${new Date(`${s.deadline}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`, cta: "View", go: () => onNavigate("scholarships") })),
    ...data.pastDeadline.map((s) => ({ show: true, icon: AlertTriangle, tone: "text-destructive", text: `${s.name} is active but past its deadline`, cta: "Fix", go: () => onNavigate("scholarships") })),
    ...data.fullPrograms.map((s) => ({ show: true, icon: GraduationCap, tone: "text-warning", text: `${s.name} has filled all ${s.slots} slots`, cta: "View", go: () => onNavigate("scholarships") })),
  ].filter((x) => x.show);

  return (
    <div className="space-y-6 animate-fade-in">
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Some dashboard data failed to load: {loadError}</span>
          <Button size="sm" variant="outline" onClick={onRefresh}>Retry</Button>
        </div>
      )}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-hero p-6 md:p-8 text-primary-foreground shadow-primary">
        <div className="absolute inset-0 opacity-[0.08] [background-image:repeating-linear-gradient(135deg,#fff_0,#fff_1px,transparent_1px,transparent_14px)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-display font-bold">Dashboard</h2>
            <p className="mt-1 text-sm text-primary-foreground/80">
              Welcome back{firstName ? `, ${firstName}` : ""}! Here&apos;s what&apos;s happening today.
            </p>
            <p className="mt-1 text-xs text-primary-foreground/70">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : ""}</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onRefresh} aria-label="Refresh dashboard" disabled={refreshing}
              className="h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-60">
              {refreshing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => onNavigate("applications", { status: "pending" })} aria-label={`${data.pending} pending applications need review`}
              className="relative h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 transition-colors flex items-center justify-center cursor-pointer">
              <Bell className="h-5 w-5" />
              {data.pending > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {data.pending > 99 ? "99+" : data.pending}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Period + quick actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onNavigate("scholarships")} className="cursor-pointer"><Plus className="mr-1 h-4 w-4" />Create Scholarship</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("verification", { verif: "Flagged" })} className="cursor-pointer"><ShieldCheck className="mr-1 h-4 w-4" />Review flagged{data.flagged > 0 ? ` (${data.flagged})` : ""}</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("disbursement")} className="cursor-pointer"><Banknote className="mr-1 h-4 w-4" />Disburse pending</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("reports")} className="cursor-pointer"><FileDown className="mr-1 h-4 w-4" />Export report</Button>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-44" aria-label="Period"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(PERIODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="hover-lift cursor-pointer" role="button" tabIndex={0} onClick={stat.go}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") stat.go(); }}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground truncate">{stat.label}</p>
                <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center shrink-0"><stat.icon className={`h-4 w-4 ${stat.color}`} /></div>
              </div>
              <p className={`mt-2 ${stat.small ? "text-xl" : "text-3xl"} font-bold font-display tabular-nums leading-none`}>{stat.value}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground truncate">{stat.sub}</p>
                {stat.trend}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {period !== "all" && <p className="-mt-3 text-xs text-muted-foreground">Trend arrows compare with the previous equal-length period.</p>}

      {/* Needs attention + Funds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />Needs Attention</CardTitle></CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">All clear — nothing needs action right now.</p>
            ) : (
              <ul className="divide-y">
                {attention.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 py-2.5">
                    <a.icon className={`h-4 w-4 shrink-0 ${a.tone}`} />
                    <span className="text-sm flex-1 min-w-0">{a.text}</span>
                    <Button size="sm" variant="secondary" className="cursor-pointer shrink-0" onClick={a.go}>{a.cta}</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Funds</CardTitle>
            <button type="button" onClick={() => onNavigate("funds")} className="text-xs font-medium text-primary hover:underline cursor-pointer">Details</button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div><p className="text-xs text-muted-foreground">Budget (active programs)</p><p className="text-lg font-bold font-display">{formatPHP(data.budget)}</p></div>
            <Progress value={data.budget ? Math.min(100, ((data.disbursedAll + data.queued) / data.budget) * 100) : 0} className="h-2" />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><p className="text-muted-foreground">Disbursed</p><p className="font-semibold text-success">{formatPHP(data.disbursedAll)}</p></div>
              <div><p className="text-muted-foreground">Queued</p><p className="font-semibold text-warning">{formatPHP(data.queued)}</p></div>
              <div><p className="text-muted-foreground">Remaining</p><p className={`font-semibold ${data.remaining < 0 ? "text-destructive" : ""}`}>{formatPHP(data.remaining)}</p></div>
            </div>
            {data.remaining < 0 && <p className="text-xs text-destructive">Committed payments exceed the budget.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Trends + status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard className="lg:col-span-2" title="Applications per Month"
          subtitle={`${data.monthTotal} in the last ${data.months} months · peak ${data.monthPeak.month} (${data.monthPeak.count}) · avg ${data.monthAvg.toFixed(1)}/mo`}
          table={{ head: ["Month", "Applications"], rows: data.perMonth.map((m) => [m.month, m.count]) }} empty={data.monthTotal === 0}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.perMonth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip content={<MonthTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }} />
              <ReferenceLine y={data.monthAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Application Status" subtitle={`${data.total} application${data.total === 1 ? "" : "s"} · ${PERIODS[period].toLowerCase()}`}
          table={{ head: ["Status", "Count", "Share"], rows: data.statusPie.map((d) => [d.name, d.value, `${data.total ? Math.round((d.value / data.total) * 100) : 0}%`]) }} empty={data.statusPie.length === 0}>
          <div className="pt-2">
            <p className="mb-3 text-3xl font-bold font-display tabular-nums">{data.approvalRate}%<span className="ml-2 text-sm font-normal text-muted-foreground">approved</span></p>
            <SegmentedBar total={data.total} ariaLabel={`Application status: ${data.statusPie.map((d) => `${d.value} ${d.name}`).join(", ")}`}
              segments={["Approved", "Pending", "Waitlisted", "Rejected"].map((n) => ({ name: n, value: data.statusPie.find((d) => d.name === n)?.value ?? 0, color: STATUS_COLOR[n] }))} />
          </div>
        </ChartCard>
      </div>

      {/* Active scholarships + Pending review */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Active Scholarships</CardTitle>
            <button type="button" onClick={() => onNavigate("scholarships")} className="text-xs font-medium text-primary hover:underline cursor-pointer">View All</button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.active.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No active scholarships yet.</p>}
            {data.active.slice(0, 4).map((s) => {
              const filled = data.approvedBy(s.id);
              const pct = s.slots > 0 ? Math.min(100, Math.round((filled / s.slots) * 100)) : 0;
              return (
                <div key={s.id} className="rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Deadline: {s.deadline || "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {data.applicantsBy(s.id)} applicants</span>
                        <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" /> {filled}/{s.slots} slots filled · {Math.max(0, s.slots - filled)} left</span>
                      </p>
                      <Progress value={pct} className="mt-2 h-1.5" />
                    </div>
                    <Button size="sm" variant="secondary" className="shrink-0 cursor-pointer" onClick={() => onNavigate("scholarships")}>View</Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Pending Review</CardTitle>
            <button type="button" onClick={() => onNavigate("applications", { status: "pending" })} className="text-xs font-medium text-primary hover:underline cursor-pointer">View All</button>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingApps.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nothing pending review.</p>}
            {pendingApps.map((a) => (
              <button key={a.id} type="button" onClick={() => onViewApp(a)} className="w-full flex items-center gap-3 text-left rounded-lg p-2 hover:bg-muted/40 transition-colors cursor-pointer">
                <div className="h-9 w-9 rounded-full bg-accent text-accent-foreground text-xs font-semibold flex items-center justify-center shrink-0">{initials(a.profiles?.first_name, a.profiles?.last_name)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{a.profiles ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() : "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.scholarships?.name || "—"}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>


      {/* Distribution + students */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard className="lg:col-span-2" title="Applications by Scholarship" subtitle={`Top programs · ${PERIODS[period].toLowerCase()}`}
          table={{ head: ["Scholarship", "Applications"], rows: data.distribution.map((d) => [d.name, d.value]) }} empty={data.distribution.length === 0}>
          <RankedBars rows={data.distribution} unit="applications" />
        </ChartCard>

        <ChartCard title="Students" subtitle="Active vs inactive accounts"
          table={{ head: ["Group", "Students"], rows: [["Active", data.activeStudents], ["Inactive", profiles.length - data.activeStudents]] }} empty={profiles.length === 0}>
          <div className="pt-2">
            <p className="mb-3 text-3xl font-bold font-display tabular-nums">{profiles.length ? Math.round((data.activeStudents / profiles.length) * 100) : 0}%<span className="ml-2 text-sm font-normal text-muted-foreground">active</span></p>
            <SegmentedBar total={profiles.length} ariaLabel={`${data.activeStudents} active and ${profiles.length - data.activeStudents} inactive students`}
              segments={[{ name: "Active", value: data.activeStudents, color: "hsl(var(--success))" }, { name: "Inactive", value: profiles.length - data.activeStudents, color: "hsl(var(--muted-foreground))" }]} />
          </div>
        </ChartCard>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><ScrollText className="h-4 w-4" />Recent Activity</CardTitle>
          <button type="button" onClick={() => onNavigate("audit-logs")} className="text-xs font-medium text-primary hover:underline cursor-pointer">View audit log</button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((l) => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{l.action.replace(/_/g, " ")}</span> <span className="text-muted-foreground">· {l.entity_type}{l.user_email ? ` · ${l.user_email}` : ""}</span></span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
