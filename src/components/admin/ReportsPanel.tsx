"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  Users, Wallet, Banknote, BarChart3, ScrollText, FileDown, Eye, PiggyBank, GraduationCap, Activity, History, AlertTriangle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartCard, RankedBars } from "@/components/admin/OverviewPanel";
import { createClient } from "@/lib/supabase/client";
import { SEMESTERS, type AppSettings } from "@/lib/settings";
import {
  ALL_FILTERS, FILTER_LABEL, LANDSCAPE, REPORT_FILTERS, applicationGroups, auditContext, budgetRows, buildReport, formatPHP, getRange,
  incomeBracket, monthlyDisbursed, periodLabel, personName, renderExcel, renderPDF, totalsRow, turnaround,
  type ReportData, type ReportFilters, type ReportKey, type ReportSection,
} from "@/lib/reports";
import type { Tables } from "@/integrations/supabase/types";

// The in-page view shows this many rows per section; exports always include every row.
const REPORT_VIEW_ROWS = 200;
// Audit rows are fetched for the selected period in pages; stop here so a huge range can't hang the page.
const AUDIT_FETCH_CAP = 20000;

const REPORTS: { key: ReportKey; title: string; desc: string; icon: typeof Users }[] = [
  { key: "scholars", title: "List of Scholars", desc: "Approved scholars by name with school, grades, award, amount disbursed and balance, plus contact, address and guardian details", icon: Users },
  { key: "budget", title: "Budget vs. Utilization", desc: "Each program's budget against committed, disbursed and queued funds, plus slots filled", icon: PiggyBank },
  { key: "funds", title: "Fund Utilization Report", desc: "Budget used and remaining, payment pipeline, funds by program, month, term and method, and cancelled payments with who cancelled them", icon: Wallet },
  { key: "disbursements", title: "Disbursement Summary", desc: "Every payment with student ID, term, method, who disbursed it, the student's receipt reference number and its review, plus totals by program and status", icon: Banknote },
  { key: "statistics", title: "Applicant Statistics", desc: "Applications, unique applicants and approval rates by program, month, term, type, sex, age, civil status, year level, grade, school, course, location, income and household size", icon: BarChart3 },
  { key: "grades", title: "Grades & Retention", desc: "Grade submissions, average grade per program and scholars below the minimum", icon: GraduationCap },
  { key: "operations", title: "Operations Report", desc: "Decision and payout turnaround, payment problems, receipt confirmations, missing documents and data requests", icon: Activity },
  { key: "history", title: "Scholar History", desc: "One student's profile, applications, payments, grades and payment problems", icon: History },
  { key: "audit", title: "Audit Trail", desc: "Recorded admin and student actions with who did it, their role, the record in words, changed fields, IP address and device, plus counts by action and user", icon: ScrollText },
];

type Props = {
  data: Omit<ReportData, "auditLogs" | "auditTruncated" | "requiredDocuments" | "minGrade">;
  settings: AppSettings;
  adminEmail: string;
  // Period is shared with Fund Management.
  period: string; setPeriod: (v: string) => void;
  fromDate: string; setFromDate: (v: string) => void;
  toDate: string; setToDate: (v: string) => void;
};

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{formatPHP(payload[0].value)} disbursed</p>
    </div>
  );
}

// One bar per row against a 0–100% track; over 100% is capped visually and flagged with an icon + label.
function PercentBars({ rows }: { rows: { name: string; pct: number | null; detail: string; warn?: string }[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${r.detail}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="tabular-nums font-semibold shrink-0">{r.pct === null ? "—" : `${r.pct.toFixed(0)}%`}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, r.pct ?? 0)}%` }} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
            {r.warn && <><AlertTriangle className="h-3 w-3 text-destructive" /><span className="text-destructive font-medium">{r.warn}</span> · </>}
            {r.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold font-display tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function ReportsPanel({ data, settings, adminEmail, period, setPeriod, fromDate, setFromDate, toDate, setToDate }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [program, setProgram] = useState("all");
  const [payStatus, setPayStatus] = useState("all");
  const [academicYear, setAcademicYear] = useState("all");
  const [semester, setSemester] = useState("all");
  const [student, setStudent] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditEntity, setAuditEntity] = useState("all");
  const [auditUser, setAuditUser] = useState("all");
  const [viewReport, setViewReport] = useState<ReportKey | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  // The audit trail is fetched for the selected period, not taken from the 1,000 rows the page loads.
  const [auditLogs, setAuditLogs] = useState<Tables<"audit_logs">[]>([]);
  const [auditTruncated, setAuditTruncated] = useState(false);
  const [auditLoading, setAuditLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      const { since, until } = getRange(period, fromDate, toDate);
      const rows: Tables<"audit_logs">[] = [];
      let truncated = false;
      for (let from = 0; ; from += 1000) {
        let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).range(from, from + 999);
        if (since) q = q.gte("created_at", since.toISOString());
        if (until) q = q.lte("created_at", until.toISOString());
        const { data: page, error } = await q;
        if (cancelled) return;
        if (error) { toast.error("Couldn't load the audit trail", { description: error.message }); break; }
        rows.push(...(page ?? []));
        if (!page || page.length < 1000) break;
        if (rows.length >= AUDIT_FETCH_CAP) { truncated = true; break; }
      }
      if (cancelled) return;
      setAuditLogs(rows);
      setAuditTruncated(truncated);
      setAuditLoading(false);
    })();
    return () => { cancelled = true; };
  }, [period, fromDate, toDate, supabase]);

  const reportData: ReportData = useMemo(() => ({
    ...data, auditLogs, auditTruncated,
    requiredDocuments: settings.required_documents, minGrade: Number(settings.min_grade_requirement),
  }), [data, auditLogs, auditTruncated, settings.required_documents, settings.min_grade_requirement]);
  const filters: ReportFilters = { ...ALL_FILTERS, period, from: fromDate, to: toDate, program, payStatus, academicYear, semester, student, auditAction, auditEntity, auditUser };

  const defs = useMemo(() => Object.fromEntries(REPORTS.map((r) => [r.key, buildReport(r.key, reportData, filters)])) as Record<ReportKey, ReturnType<typeof buildReport>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportData, period, fromDate, toDate, program, payStatus, academicYear, semester, student, auditAction, auditEntity, auditUser]);

  // Choices for the audit filters, from the entries loaded for the period.
  const auditChoices = useMemo(() => {
    const ctx = auditContext(reportData);
    const users = new Map<string, string>();
    auditLogs.forEach((l) => { const k = l.user_id ?? "system"; if (!users.has(k)) users.set(k, k === "system" ? "System" : `${ctx.user(l)} (${ctx.role(l)})`); });
    return {
      actions: [...new Set(auditLogs.map((l) => l.action))].sort(),
      entities: [...new Set(auditLogs.map((l) => l.entity_type))].sort(),
      users: [...users.entries()].sort((x, y) => x[1].localeCompare(y[1])),
    };
  }, [auditLogs, reportData]);

  const academicYears = useMemo(() => [...new Set(data.applications.map((a) => a.academic_year).filter((x): x is string => !!x))].sort().reverse(), [data.applications]);
  const students = useMemo(() => {
    const applied = new Set(data.applications.map((a) => a.user_id));
    return data.profiles.filter((p) => applied.has(p.id)).sort((x, y) => personName(x).localeCompare(personName(y)));
  }, [data.profiles, data.applications]);

  // ── Analytics ──
  const analytics = useMemo(() => {
    const budgets = budgetRows(reportData, filters);
    const totalBudget = budgets.reduce((t, r) => t + r.budget, 0);
    const disbursed = budgets.reduce((t, r) => t + r.disbursed, 0);
    const queued = budgets.reduce((t, r) => t + r.queued, 0);
    const byProgram = applicationGroups(reportData, filters, (a) => a.scholarships?.name);
    const apps = byProgram.reduce((t, r) => t + r.total, 0);
    const approved = byProgram.reduce((t, r) => t + r.approved, 0);
    return {
      budgets, totalBudget, disbursed, queued,
      monthly: monthlyDisbursed(reportData, filters),
      byProgram, apps, approved,
      income: applicationGroups(reportData, filters, (a) => incomeBracket(a.household_income)),
      t: turnaround(reportData, filters),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportData, period, fromDate, toDate, program, academicYear, semester]);

  const exportOpts = (key: ReportKey) => ({
    landscape: LANDSCAPE.includes(key), generatedBy: adminEmail, programName: settings.program_name,
    signatories: { preparedBy: settings.report_prepared_by, preparedTitle: settings.report_prepared_title, approvedBy: settings.report_approved_by, approvedTitle: settings.report_approved_title },
  });
  const fileBase = (key: ReportKey) => `${key}-report-${new Date().toISOString().slice(0, 10)}`;
  const exportPDF = async (key: ReportKey) => {
    setExporting(`${key}-pdf`);
    try { await renderPDF(defs[key], `${fileBase(key)}.pdf`, exportOpts(key)); toast.success("PDF downloaded"); }
    catch (e) { toast.error("PDF export failed", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setExporting(null); }
  };
  const exportExcel = async (key: ReportKey) => {
    setExporting(`${key}-xlsx`);
    try { await renderExcel(defs[key], `${fileBase(key)}.xlsx`, exportOpts(key)); toast.success("Excel downloaded"); }
    catch (e) { toast.error("Excel export failed", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setExporting(null); }
  };

  const cell = (sec: ReportSection, c: string | number, i: number) => (sec.money?.includes(sec.head[i]) && typeof c === "number" ? formatPHP(c) : String(c));
  const scopeText = `${periodLabel(filters)}${program === "all" ? "" : ` · ${data.scholarships.find((s) => s.id === program)?.name ?? ""}`}${academicYear === "all" ? "" : ` · AY ${academicYear}`}${semester === "all" ? "" : ` · ${semester}`}`;
  const noSignatories = !settings.report_prepared_by && !settings.report_approved_by;
  const remaining = analytics.totalBudget - analytics.disbursed - analytics.queued;

  return (
    <div className="space-y-4 animate-fade-in">
      <h2 className="text-xl font-display font-bold">Reports & Analytics</h2>

      {/* Filters */}
      <Card>
        <CardContent className="py-4 flex gap-3 flex-wrap items-end">
          <div>
            <Label className="text-xs">Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="6m">Last 6 months</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (<>
            <div><Label className="text-xs">From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" /></div>
          </>)}
          <div>
            <Label className="text-xs">Program</Label>
            <Select value={program} onValueChange={setProgram}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All programs</SelectItem>
                {data.scholarships.map((sc) => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Academic year</Label>
            <Select value={academicYear} onValueChange={setAcademicYear}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {academicYears.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Semester</Label>
            <Select value={semester} onValueChange={setSemester}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All semesters</SelectItem>
                {SEMESTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground -mt-2">These filters apply to the analytics below and to each report that lists them. Period also applies to Fund Management.</p>

      {/* Analytics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Total budget" value={formatPHP(analytics.totalBudget)} sub={`${analytics.budgets.length} program${analytics.budgets.length === 1 ? "" : "s"}`} />
        <Kpi label="Disbursed" value={formatPHP(analytics.disbursed)} sub={analytics.totalBudget ? `${((analytics.disbursed / analytics.totalBudget) * 100).toFixed(1)}% of budget` : undefined} />
        <Kpi label="Remaining after queued" value={formatPHP(remaining)} sub={`${formatPHP(analytics.queued)} queued`} />
        <Kpi label="Approval rate" value={analytics.apps ? `${((analytics.approved / analytics.apps) * 100).toFixed(1)}%` : "—"} sub={analytics.t.avgDecision === null ? `${analytics.apps} applications` : `${analytics.apps} applications · ${analytics.t.avgDecision.toFixed(1)} days to decide`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Budget Utilization" subtitle={`Disbursed ÷ budget per program · ${scopeText}`}
          table={{ head: ["Program", "Budget", "Disbursed", "Queued", "Used"], rows: analytics.budgets.map((r) => [r.name, formatPHP(r.budget), formatPHP(r.disbursed), formatPHP(r.queued), r.budget ? `${((r.disbursed / r.budget) * 100).toFixed(1)}%` : "—"]) }}
          empty={analytics.budgets.length === 0}>
          <div className="max-h-[260px] overflow-y-auto pr-1">
            <PercentBars rows={analytics.budgets.map((r) => ({
              name: r.name,
              pct: r.budget ? (r.disbursed / r.budget) * 100 : null,
              detail: r.budget ? `${formatPHP(r.disbursed)} of ${formatPHP(r.budget)}` : `${formatPHP(r.disbursed)} disbursed · no budget set`,
              warn: r.budget > 0 && r.remaining < 0 ? "Over budget" : undefined,
            }))} />
          </div>
        </ChartCard>

        <ChartCard title="Disbursed per Month" subtitle={`${formatPHP(analytics.disbursed)} · ${scopeText}`}
          table={{ head: ["Month", "Disbursed"], rows: analytics.monthly.map((m) => [m.month, formatPHP(m.amount)]) }} empty={analytics.monthly.length === 0}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={analytics.monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => (v >= 1000000 ? `₱${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `₱${Math.round(v / 1000)}k` : `₱${v}`)} />
              <Tooltip content={<MoneyTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }} />
              <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Approval Rate by Program" subtitle={`Approved ÷ applications · ${scopeText}`}
          table={{ head: ["Program", "Applications", "Approved", "Rate"], rows: analytics.byProgram.map((r) => [r.name, r.total, r.approved, `${((r.approved / r.total) * 100).toFixed(1)}%`]) }}
          empty={analytics.byProgram.length === 0}>
          <div className="max-h-[260px] overflow-y-auto pr-1">
            <PercentBars rows={analytics.byProgram.map((r) => ({ name: r.name, pct: (r.approved / r.total) * 100, detail: `${r.approved} of ${r.total} approved · ${r.disapproved} disapproved · ${r.open} open` }))} />
          </div>
        </ChartCard>

        <ChartCard title="Applicants by Monthly Household Income" subtitle={`${analytics.apps} applications · ${scopeText}`}
          table={{ head: ["Income", "Applicants", "Approved"], rows: analytics.income.map((r) => [r.name, r.total, r.approved]) }}
          empty={analytics.income.length === 0}>
          <RankedBars unit="applicants" rows={analytics.income.map((r) => ({ name: r.name, value: r.total }))} />
        </ChartCard>
      </div>

      {/* Reports */}
      <h3 className="text-lg font-display font-semibold pt-2">Reports</h3>
      {noSignatories && <p className="text-xs text-muted-foreground -mt-2">PDFs end with blank &quot;Prepared by&quot; and &quot;Approved by&quot; lines. Add names in Settings → Report Signatories.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map((r) => {
          const def = defs[r.key];
          const busy = r.key === "audit" && auditLoading;
          const disabled = def.count === 0 || busy || !!exporting;
          return (
            <Card key={r.key}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><r.icon className="h-4 w-4 text-primary" />{r.title}</CardTitle>
                <CardDescription>{r.desc}</CardDescription>
                <p className="text-xs text-muted-foreground">Uses: {REPORT_FILTERS[r.key].map((k) => FILTER_LABEL[k]).join(" · ")}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {r.key === "history" && (
                  <Select value={student} onValueChange={setStudent}>
                    <SelectTrigger><SelectValue placeholder={students.length ? "Choose a student" : "No students have applied yet"} /></SelectTrigger>
                    <SelectContent>
                      {students.map((p) => <SelectItem key={p.id} value={p.id}>{personName(p)}{p.student_id_number ? ` · ${p.student_id_number}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {r.key === "audit" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Select value={auditAction} onValueChange={setAuditAction}>
                      <SelectTrigger aria-label="Action"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All actions</SelectItem>
                        {auditChoices.actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={auditEntity} onValueChange={setAuditEntity}>
                      <SelectTrigger aria-label="Record type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All record types</SelectItem>
                        {auditChoices.entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={auditUser} onValueChange={setAuditUser}>
                      <SelectTrigger aria-label="User"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All users</SelectItem>
                        {auditChoices.users.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {r.key === "disbursements" && (
                  <Select value={payStatus} onValueChange={setPayStatus}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All except cancelled</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Processing">Processing</SelectItem>
                      <SelectItem value="Disbursed">Disbursed</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" disabled={def.count === 0 || busy} onClick={() => setViewReport(r.key)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                  <Button variant="outline" size="sm" disabled={disabled} onClick={() => exportPDF(r.key)}>
                    {exporting === `${r.key}-pdf` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} PDF
                  </Button>
                  <Button variant="outline" size="sm" disabled={disabled} onClick={() => exportExcel(r.key)}>
                    {exporting === `${r.key}-xlsx` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} Excel
                  </Button>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {busy ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</span> : r.key === "history" && !student ? "Choose a student" : `${def.count.toLocaleString()} ${def.countLabel}`}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!viewReport} onOpenChange={(o) => { if (!o) setViewReport(null); }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          {viewReport && (() => {
            const def = defs[viewReport];
            return (<>
              <DialogHeader>
                <DialogTitle>{def.title}</DialogTitle>
                <p className="text-xs text-muted-foreground">{def.filters.join(" · ")} · {def.count.toLocaleString()} {def.countLabel}</p>
                {def.notes?.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
              </DialogHeader>
              <div className="space-y-6">
                {def.sections.map((sec) => {
                  const total = totalsRow(sec);
                  return (
                    <div key={sec.name} className="space-y-2">
                      <h3 className="text-sm font-semibold">{sec.name}</h3>
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                            {sec.head.map((h) => <TableHead key={h} className={sec.money?.includes(h) ? "text-right" : undefined}>{h}</TableHead>)}
                          </TableRow></TableHeader>
                          <TableBody>
                            {sec.rows.length === 0 && <TableRow><TableCell colSpan={sec.head.length} className="text-center py-6 text-muted-foreground">No data for these filters</TableCell></TableRow>}
                            {sec.rows.slice(0, REPORT_VIEW_ROWS).map((r, ri) => (
                              <TableRow key={ri}>
                                {r.map((c, i) => <TableCell key={i} className={`text-xs ${sec.money?.includes(sec.head[i]) ? "text-right tabular-nums" : ""}`}>{cell(sec, c, i)}</TableCell>)}
                              </TableRow>
                            ))}
                            {total && (
                              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                                {total.map((c, i) => <TableCell key={i} className={`text-xs ${sec.money?.includes(sec.head[i]) ? "text-right tabular-nums" : ""}`}>{cell(sec, c, i)}</TableCell>)}
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      {sec.rows.length > REPORT_VIEW_ROWS && (
                        <p className="text-xs text-muted-foreground">Showing the first {REPORT_VIEW_ROWS} of {sec.rows.length} rows (the total covers all of them). Export to see every row.</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <Button variant="outline" disabled={!!exporting} onClick={() => exportPDF(viewReport)}><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
                <Button variant="outline" disabled={!!exporting} onClick={() => exportExcel(viewReport)}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
              </DialogFooter>
            </>);
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
