import type { Tables, Json } from "@/integrations/supabase/types";
import { ROLE_LABEL } from "@/lib/permissions";

// ── Shapes ──
// `money` columns are formatted as pesos; `totals` columns get a summed "Total" row.
export type ReportSection = { name: string; head: string[]; rows: (string | number)[][]; money?: string[]; totals?: string[] };
export type ReportDef = { title: string; filters: string[]; sections: ReportSection[]; count: number; countLabel: string; notes?: string[] };

export type ReportApp = Tables<"applications"> & { scholarships: { name: string } | null; profiles?: Tables<"profiles"> | null };
export type DocSummary = { id: string; user_id: string; application_id: string | null; document_type: string; status: string; uploaded_at: string };
/** Admin / super admin accounts, kept apart from student profiles. */
export type StaffMember = { id: string; name: string; email: string | null; role: string };

export type ReportData = {
  applications: ReportApp[];
  scholarships: Tables<"scholarships">[];
  profiles: Tables<"profiles">[];
  staff: StaffMember[];
  payments: Tables<"payments">[];
  auditLogs: Tables<"audit_logs">[];
  /** The audit rows stop short of the period (fetch cap hit). */
  auditTruncated?: boolean;
  payIssues: Tables<"payment_issues">[];
  gradeUpdates: Tables<"grade_updates">[];
  dataRequests: Tables<"data_requests">[];
  documents: DocSummary[];
  requiredDocuments: string[];
  minGrade: number;
};

export type ReportFilters = {
  period: string; from: string; to: string;
  program: string; payStatus: string;
  academicYear: string; semester: string;
  student: string;
  /** Audit trail only: an action, an entity type, and a user id ("system" for entries with no user). */
  auditAction: string; auditEntity: string; auditUser: string;
};
export const ALL_FILTERS: ReportFilters = {
  period: "all", from: "", to: "", program: "all", payStatus: "all", academicYear: "all", semester: "all", student: "",
  auditAction: "all", auditEntity: "all", auditUser: "all",
};

export type ReportKey = "scholars" | "budget" | "funds" | "disbursements" | "statistics" | "grades" | "operations" | "history" | "audit";
export type ReportFilterKey = "period" | "program" | "term" | "payStatus" | "student" | "audit";
export const FILTER_LABEL: Record<ReportFilterKey, string> = { period: "Period", program: "Program", term: "Academic year & semester", payStatus: "Payment status", student: "Student", audit: "Action, record type & user" };

/** Which filters each report honours. Everything else is ignored (and not printed on the report). */
export const REPORT_FILTERS: Record<ReportKey, ReportFilterKey[]> = {
  scholars: ["period", "program", "term"],
  budget: ["period", "program", "term"],
  funds: ["period", "program", "term"],
  disbursements: ["period", "program", "term", "payStatus"],
  statistics: ["period", "program", "term"],
  grades: ["period", "program"],
  operations: ["period"],
  history: ["student"],
  audit: ["period", "audit"],
};
/** Wide reports print landscape. */
export const LANDSCAPE: ReportKey[] = ["scholars", "budget", "disbursements", "grades", "operations", "history", "audit"];

// ── Small helpers ──
export const formatPHP = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY = 86400000;
const fmtDate = (d: string | null | undefined) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d).toLocaleDateString("en-PH") : "—");
const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(1)}%` : "—");
const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / DAY;
const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayText = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)} days`);
const sum = (xs: Tables<"payments">[]) => xs.reduce((t, p) => t + Number(p.amount || 0), 0);
const clip = (s: string | null | undefined, n = 120) => (!s ? "—" : s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const personName = (p?: Tables<"profiles"> | null) => (p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || "—" : "—");
/** "Dela Cruz, Juan M." — the order official lists are sorted and printed in. */
export const listName = (p?: Tables<"profiles"> | null) => {
  if (!p) return "—";
  const first = [p.first_name, p.middle_name ? `${p.middle_name.trim()[0]}.` : ""].filter(Boolean).join(" ");
  return [p.last_name, first].filter(Boolean).join(", ") || p.email || "—";
};
const ageOn = (dob: string | null | undefined, at: string | Date = new Date()) => {
  if (!dob) return null;
  const b = new Date(`${dob.slice(0, 10)}T00:00:00`), d = new Date(at);
  if (Number.isNaN(b.getTime())) return null;
  return d.getFullYear() - b.getFullYear() - (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate()) ? 1 : 0);
};
const termText = (a?: Pick<Tables<"applications">, "academic_year" | "semester"> | null) => (a ? [a.academic_year, a.semester].filter(Boolean).join(" · ") : "") || "—";

export function getRange(period: string, from: string, to: string): { since: Date | null; until: Date | null } {
  const now = new Date();
  if (period === "year") return { since: new Date(now.getFullYear(), 0, 1), until: null };
  if (period === "6m") return { since: new Date(now.getFullYear(), now.getMonth() - 5, 1), until: null };
  if (period === "30d") return { since: new Date(now.getTime() - 30 * DAY), until: null };
  if (period === "custom") {
    return {
      since: from ? new Date(`${from}T00:00:00`) : null,
      until: to ? new Date(`${to}T23:59:59.999`) : null,
    };
  }
  return { since: null, until: null };
}

export function periodLabel(f: Pick<ReportFilters, "period" | "from" | "to">) {
  if (f.period === "year") return "This year";
  if (f.period === "6m") return "Last 6 months";
  if (f.period === "30d") return "Last 30 days";
  if (f.period === "custom") return `${f.from || "…"} to ${f.to || "…"}`;
  return "All time";
}

// Older audit rows stored their values as JSON-encoded strings; newer ones are real JSON.
const jsonValue = (v: Json | null | undefined): unknown => {
  let x: unknown = v ?? null;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { /* keep the string */ } }
  return x;
};
const jsonText = (v: Json | null | undefined) => {
  const x = jsonValue(v);
  return x === null ? "—" : typeof x === "string" ? x : JSON.stringify(x);
};
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** Fields whose value differs between before and after (or every field of whichever side exists). */
const changedFields = (l: Tables<"audit_logs">) => {
  const a = jsonValue(l.previous_value), b = jsonValue(l.new_value);
  if (isObj(a) && isObj(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return isObj(b) ? Object.keys(b) : isObj(a) ? Object.keys(a) : [];
};
/** "Chrome on Windows" from a user agent string. */
export const deviceText = (ua: string | null | undefined) => {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return browser && os ? `${browser} on ${os}` : browser || os || clip(ua, 40);
};

/** Who an audit row is about, in words: "Juan Dela Cruz · Merit Scholarship" rather than a UUID. */
export function auditContext(data?: Partial<Pick<ReportData, "applications" | "payments" | "profiles" | "scholarships" | "staff" | "payIssues" | "gradeUpdates" | "dataRequests" | "documents">>) {
  const byId = <T extends { id: string }>(xs?: T[]) => new Map((xs ?? []).map((x) => [x.id, x]));
  const apps = byId(data?.applications), pays = byId(data?.payments), profs = byId(data?.profiles), progs = byId(data?.scholarships), staff = byId(data?.staff);
  const issues = byId(data?.payIssues), grades = byId(data?.gradeUpdates), reqs = byId(data?.dataRequests), docs = byId(data?.documents);
  const who = (uid?: string | null) => (uid ? staff.get(uid)?.name ?? (profs.get(uid) ? personName(profs.get(uid)) : null) : null);
  const record = (l: Tables<"audit_logs">): string => {
    const id = l.entity_id;
    const after = jsonValue(l.new_value);
    if (l.entity_type === "system_settings") return isObj(after) && typeof after.key === "string" ? `Setting: ${after.key}` : "Settings";
    if (!id) return "—";
    const short = `#${id.slice(0, 8)}`;
    switch (l.entity_type) {
      case "applications": { const a = apps.get(id); return a ? `${personName(profs.get(a.user_id) ?? a.profiles)} · ${a.scholarships?.name ?? "—"}` : short; }
      case "payments": { const p = pays.get(id); return p ? `${who(p.user_id) ?? "—"} · ${formatPHP(Number(p.amount))}` : short; }
      case "profiles": return who(id) ?? short;
      case "user_roles": return who(id) ?? short;
      case "scholarships": return progs.get(id)?.name ?? short;
      case "payment_issues": { const i = issues.get(id); return i ? `${who(i.user_id) ?? "—"} · ${i.kind}` : short; }
      case "grade_updates": { const g = grades.get(id); return g ? `${who(g.user_id) ?? "—"} · ${g.term}` : short; }
      case "data_requests": { const r = reqs.get(id); return r ? `${who(r.user_id) ?? "—"} · ${r.kind}` : short; }
      case "documents": { const d = docs.get(id); return d ? `${who(d.user_id) ?? "—"} · ${d.document_type}` : short; }
      default: return short;
    }
  };
  const user = (l: Tables<"audit_logs">) => (l.user_id ? who(l.user_id) ?? l.user_email ?? "—" : "System");
  const role = (l: Tables<"audit_logs">) => {
    if (!l.user_id) return "System";
    const st = staff.get(l.user_id);
    return st ? ROLE_LABEL[st.role] ?? st.role : profs.has(l.user_id) ? "Student" : "—";
  };
  return { record, user, role };
}

export const logsToSection = (logs: Tables<"audit_logs">[], data?: Parameters<typeof auditContext>[0]): ReportSection => {
  const ctx = auditContext(data);
  return {
    name: "Audit Log",
    head: ["Date & Time", "User", "Email", "Role", "Action", "Entity", "Record", "Changed Fields", "Before", "After", "IP Address", "Device"],
    rows: logs.map((l) => [
      fmtDateTime(l.created_at), ctx.user(l), l.user_email || "—", ctx.role(l), l.action, l.entity_type, ctx.record(l),
      changedFields(l).join(", ") || "—", jsonText(l.previous_value), jsonText(l.new_value), l.ip_address || "—", deviceText(l.user_agent),
    ]),
  };
};

// Applications keep a snapshot of the student's school details at submission; older rows may not.
export const appSchool = (a: ReportApp) => a.school_name ?? a.profiles?.school_name ?? null;
export const appCourse = (a: ReportApp) => a.course ?? a.profiles?.course ?? null;
export const appYearLevel = (a: ReportApp) => a.year_level ?? a.profiles?.year_level ?? null;
export const appGrade = (a: ReportApp) => a.average_grade ?? a.profiles?.average_grade ?? null;
export const appApprovedAt = (a: ReportApp) => a.approved_at ?? a.updated_at;

const INCOME_BRACKETS: [string, number][] = [
  ["Below ₱10,000", 10000], ["₱10,000 – ₱19,999", 20000], ["₱20,000 – ₱39,999", 40000], ["₱40,000 – ₱79,999", 80000], ["₱80,000 and above", Infinity],
];
export const incomeBracket = (n: number | null) => (n === null ? "Not specified" : INCOME_BRACKETS.find(([, max]) => Number(n) < max)![0]);
const AGE_BRACKETS: [string, number][] = [["Under 18", 18], ["18–20", 21], ["21–23", 24], ["24–26", 27], ["27 and above", Infinity]];
const ageBracket = (n: number | null) => (n === null ? "Not specified" : AGE_BRACKETS.find(([, max]) => n < max)![0]);
const GRADE_BRACKETS: [string, number][] = [["95 and above", 95], ["90 – 94.99", 90], ["85 – 89.99", 85], ["80 – 84.99", 80], ["75 – 79.99", 75], ["Below 75", -Infinity]];
const gradeBracket = (n: number | null) => (n === null ? "Not specified" : GRADE_BRACKETS.find(([, min]) => Number(n) >= min)![0]);
const sizeBracket = (n: number | null) => (n === null ? "Not specified" : n <= 2 ? "1–2" : n <= 4 ? "3–4" : n <= 6 ? "5–6" : "7 or more");

// ── Scope: one place that decides what a set of filters includes ──
export function scope(data: ReportData, f: ReportFilters) {
  const { since, until } = getRange(f.period, f.from, f.to);
  const within = (d: string | null | undefined) => {
    if (!d) return !since && !until;
    const t = new Date(d);
    return (!since || t >= since) && (!until || t <= until);
  };
  const termSet = f.academicYear !== "all" || f.semester !== "all";
  const termOk = (a?: ReportApp | null) => !!a && (f.academicYear === "all" || a.academic_year === f.academicYear) && (f.semester === "all" || a.semester === f.semester);
  const progOk = (id: string | null | undefined) => f.program === "all" || id === f.program;
  const appOk = (a: ReportApp) => progOk(a.scholarship_id) && (!termSet || termOk(a));
  const appById = new Map(data.applications.map((a) => [a.id, a]));
  const payApp = (p: Tables<"payments">) => (p.application_id ? appById.get(p.application_id) : undefined);
  const payOk = (p: Tables<"payments">) => {
    const a = payApp(p);
    if (f.program !== "all" && a?.scholarship_id !== f.program) return false;
    return !termSet || termOk(a);
  };
  const payDate = (p: Tables<"payments">) => p.disbursed_at || p.scheduled_date || p.created_at;
  const profById = new Map(data.profiles.map((p) => [p.id, p]));
  const appAward = (a: ReportApp) => Number(a.amount_approved ?? data.scholarships.find((s) => s.id === a.scholarship_id)?.amount ?? 0);
  return { within, termOk, progOk, appOk, payApp, payOk, payDate, profById, appAward };
}

// ── Shared figures (reports + Analytics charts) ──
export function budgetRows(data: ReportData, f: ReportFilters) {
  const s = scope(data, f);
  const pays = data.payments.filter((p) => s.payOk(p) && s.within(s.payDate(p)));
  return data.scholarships.filter((sc) => s.progOk(sc.id)).map((sc) => {
    const list = pays.filter((p) => s.payApp(p)?.scholarship_id === sc.id);
    const approved = data.applications.filter((a) => a.scholarship_id === sc.id && a.status === "Approved" && s.appOk(a));
    const disbursed = sum(list.filter((p) => p.status === "Disbursed"));
    const queued = sum(list.filter((p) => p.status === "Pending" || p.status === "Processing"));
    const budget = Number(sc.total_budget || 0);
    return {
      id: sc.id, name: sc.name, budget, slots: Number(sc.slots || 0), approved: approved.length,
      committed: approved.reduce((t, a) => t + s.appAward(a), 0),
      disbursed, queued, remaining: budget - disbursed - queued,
    };
  });
}

export function monthlyDisbursed(data: ReportData, f: ReportFilters) {
  const s = scope(data, f);
  const m = new Map<string, number>();
  data.payments.filter((p) => p.status === "Disbursed" && s.payOk(p) && s.within(s.payDate(p))).forEach((p) => {
    const d = new Date(s.payDate(p));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    m.set(key, (m.get(key) ?? 0) + Number(p.amount || 0));
  });
  return [...m.entries()].sort(([x], [y]) => x.localeCompare(y))
    .map(([key, amount]) => ({ month: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-PH", { month: "short", year: "2-digit" }), amount }));
}

/** Applications in scope (by submission date), grouped with approval counts and rates. */
export function applicationGroups(data: ReportData, f: ReportFilters, label: (a: ReportApp) => string | null | undefined, order?: string[]) {
  const s = scope(data, f);
  const apps = data.applications.filter((a) => s.appOk(a) && s.within(a.created_at));
  const m = new Map<string, ReportApp[]>();
  apps.forEach((a) => { const k = label(a) || "Not specified"; m.set(k, [...(m.get(k) ?? []), a]); });
  const rows = [...m.entries()].map(([name, list]) => {
    const c = (st: string) => list.filter((a) => a.status === st).length;
    return { name, total: list.length, approved: c("Approved"), disapproved: c("Disapproved"), open: c("Pending") + c("Waitlisted"), withdrawn: c("Withdrawn") };
  });
  return order
    ? rows.sort((x, y) => (order.indexOf(x.name) + 1 || 99) - (order.indexOf(y.name) + 1 || 99))
    : rows.sort((x, y) => y.total - x.total);
}

export function turnaround(data: ReportData, f: ReportFilters) {
  const s = scope(data, f);
  const decided = data.applications.filter((a) => a.decided_at && s.appOk(a) && s.within(a.decided_at));
  const toDecision = decided.map((a) => daysBetween(a.created_at, a.decided_at!));
  const toPayout = data.applications
    .filter((a) => a.status === "Approved" && s.appOk(a) && s.within(appApprovedAt(a)))
    .map((a) => {
      const first = data.payments.filter((p) => p.application_id === a.id && p.status === "Disbursed" && p.disbursed_at)
        .map((p) => p.disbursed_at!).sort()[0];
      return first ? daysBetween(appApprovedAt(a), first) : null;
    })
    .filter((x): x is number => x !== null && x >= 0);
  return { decided: decided.length, avgDecision: mean(toDecision), medianDecision: median(toDecision), maxDecision: toDecision.length ? Math.max(...toDecision) : null, avgPayout: mean(toPayout), paidOut: toPayout.length };
}

// ── Report builder ──
export function buildReport(key: ReportKey, data: ReportData, f: ReportFilters): ReportDef {
  const s = scope(data, f);
  const programName = (id: string | null | undefined) => data.scholarships.find((sc) => sc.id === id)?.name || "Unassigned";
  const filters = REPORT_FILTERS[key].flatMap((k): string[] => {
    if (k === "period") return [`Period: ${periodLabel(f)}`];
    if (k === "program") return [`Program: ${f.program === "all" ? "All programs" : programName(f.program)}`];
    if (k === "term") return [`Term: ${f.academicYear === "all" ? "All academic years" : `AY ${f.academicYear}`}, ${f.semester === "all" ? "all semesters" : f.semester}`];
    if (k === "payStatus") return [`Payments: ${f.payStatus === "all" ? "All except cancelled" : f.payStatus}`];
    return [];
  });
  const payStudent = (p: Tables<"payments">) => personName(s.profById.get(p.user_id));
  const staffById = new Map(data.staff.map((m) => [m.id, m]));
  const staffName = (id: string | null | undefined) => (id ? staffById.get(id)?.name ?? "Former staff" : "—");
  const paidFor = (appId: string) => sum(data.payments.filter((p) => p.application_id === appId && p.status === "Disbursed"));
  const minFor = (a: Pick<Tables<"applications">, "scholarship_id">) => Number(data.scholarships.find((sc) => sc.id === a.scholarship_id)?.min_grade ?? data.minGrade);
  const payProgram = (p: Tables<"payments">) => s.payApp(p)?.scholarships?.name || "—";
  const kind = (a: ReportApp) => (a.is_renewal ? "Renewal" : "New");

  if (key === "scholars") {
    const apps = data.applications
      .filter((a) => a.status === "Approved" && s.appOk(a) && s.within(appApprovedAt(a)))
      .sort((x, y) => listName(x.profiles).localeCompare(listName(y.profiles)) || (x.scholarships?.name ?? "").localeCompare(y.scholarships?.name ?? ""));
    const students = [...new Map(apps.map((a) => [a.user_id, a.profiles])).entries()];
    const multi = apps.length - students.length;
    return {
      title: "List of Scholars", filters, count: students.length, countLabel: "scholars",
      notes: [
        "Grade at Application is the grade the student declared when applying; Current Grade is the verified average on file. Disbursed and Balance are to date, regardless of the period.",
        ...(multi > 0 ? [`${apps.length} approved scholarships across ${students.length} scholars: a scholar with more than one scholarship appears once per scholarship.`] : []),
      ],
      sections: [
        {
          name: "Scholars",
          head: ["#", "Name", "Student ID", "School", "Course", "Year Level", "Grade at Application", "Current Grade", "Scholarship", "AY / Semester", "Type", "Approved On", "Award", "Disbursed", "Balance", "Payout Status"],
          rows: apps.map((a, i) => {
            const award = s.appAward(a), paid = paidFor(a.id);
            const g = a.profiles?.average_grade;
            const current = g === null || g === undefined ? "—" : Number(g) < minFor(a) ? `${g} (below ${minFor(a)})` : g;
            return [i + 1, listName(a.profiles), a.profiles?.student_id_number || "—", appSchool(a) || "—", appCourse(a) || "—", appYearLevel(a) || "—", a.average_grade ?? "—", current,
              a.scholarships?.name || "—", termText(a), kind(a), fmtDate(appApprovedAt(a)), award, paid, award - paid, a.disbursement_status || "—"];
          }),
          money: ["Award", "Disbursed", "Balance"], totals: ["Award", "Disbursed", "Balance"],
        },
        {
          name: "Contact & Address",
          head: ["#", "Name", "Sex", "Age", "Civil Status", "Phone", "Email", "Address", "Guardian", "Guardian Contact"],
          rows: students.map(([, p], i) => [
            i + 1, listName(p), p?.sex || "—", ageOn(p?.dob) ?? "—", p?.civil_status || "—", p?.phone || "—", p?.email || "—",
            [p?.street_address, p?.barangay, p?.municipality, p?.province].filter(Boolean).join(", ") || "—",
            [p?.guardian_name, p?.guardian_relationship && `(${p.guardian_relationship})`].filter(Boolean).join(" ") || "—", p?.guardian_phone || "—",
          ]),
        },
      ],
    };
  }

  if (key === "budget") {
    const rows = budgetRows(data, f);
    const over = rows.filter((r) => r.budget > 0 && r.remaining < 0);
    const overCommitted = rows.filter((r) => r.budget > 0 && r.committed > r.budget);
    return {
      title: "Budget vs. Utilization", filters, count: rows.length, countLabel: "programs",
      notes: [
        "Disbursed and queued amounts follow the period; Committed is the award total of approved scholars.",
        ...(over.length ? [`Over budget: ${over.map((r) => r.name).join(", ")}`] : []),
        ...(overCommitted.length ? [`Awards to approved scholars exceed the budget: ${overCommitted.map((r) => r.name).join(", ")}`] : []),
      ],
      sections: [
        {
          name: "Budget",
          head: ["Scholarship", "Budget", "Committed", "Disbursed", "Queued", "Remaining", "Used %"],
          rows: rows.map((r) => [r.name, r.budget, r.committed, r.disbursed, r.queued, r.remaining, pct(r.disbursed, r.budget)]),
          money: ["Budget", "Committed", "Disbursed", "Queued", "Remaining"], totals: ["Budget", "Committed", "Disbursed", "Queued", "Remaining"],
        },
        {
          name: "Slots",
          head: ["Scholarship", "Slots", "Approved", "Open Slots", "Filled %"],
          rows: rows.map((r) => [r.name, r.slots, r.approved, Math.max(0, r.slots - r.approved), pct(r.approved, r.slots)]),
          totals: ["Slots", "Approved", "Open Slots"],
        },
      ],
    };
  }

  if (key === "funds") {
    const pays = data.payments.filter((p) => s.payOk(p) && s.within(s.payDate(p)));
    const paid = pays.filter((p) => p.status === "Disbursed");
    const live = pays.filter((p) => p.status !== "Cancelled");
    const queuedOf = (l: Tables<"payments">[]) => sum(l.filter((p) => p.status === "Pending" || p.status === "Processing"));
    const pipeline: (string | number)[][] = (["Pending", "Processing", "Disbursed", "Cancelled"] as const).map((st) => { const l = pays.filter((p) => p.status === st); return [st, l.length, sum(l)]; });
    pipeline.push(["Total (excluding cancelled)", live.length, sum(live)]);
    const budgets = budgetRows(data, f);
    const programIds = [...data.scholarships.filter((sc) => s.progOk(sc.id)).map((sc) => sc.id), ...(f.program === "all" ? [null] : [])];
    const byProgram = programIds.map((id) => {
      const l = pays.filter((p) => (s.payApp(p)?.scholarship_id ?? null) === id);
      const lp = l.filter((p) => p.status === "Disbursed");
      const scholars = new Set(lp.map((p) => p.user_id)).size;
      return [programName(id), lp.length, scholars, sum(lp), scholars ? sum(lp) / scholars : 0, queuedOf(l), sum(l.filter((p) => p.status === "Cancelled"))];
    }).filter((r, i) => programIds[i] !== null || (r[3] as number) + (r[5] as number) + (r[6] as number) > 0);
    const methods = new Map<string, Tables<"payments">[]>();
    paid.forEach((p) => methods.set(p.method || "Other", [...(methods.get(p.method || "Other") ?? []), p]));
    const months = new Map<string, Tables<"payments">[]>();
    paid.forEach((p) => { const d = new Date(s.payDate(p)); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; months.set(k, [...(months.get(k) ?? []), p]); });
    const terms = new Map<string, Tables<"payments">[]>();
    live.forEach((p) => { const k = termText(s.payApp(p)); terms.set(k, [...(terms.get(k) ?? []), p]); });
    const cancelled = pays.filter((p) => p.status === "Cancelled");
    return {
      title: "Fund Utilization Report", filters, count: byProgram.length, countLabel: "programs",
      notes: ["Budget and Remaining are each program's total budget; disbursed and queued amounts follow the period. Payments fall in the period by disbursed date, else scheduled date, else the date created."],
      sections: [
        {
          name: "Budget Utilization",
          head: ["Scholarship", "Budget", "Disbursed", "Queued", "Remaining", "Utilized %"],
          rows: budgets.map((r) => [r.name, r.budget, r.disbursed, r.queued, r.remaining, pct(r.disbursed, r.budget)]),
          money: ["Budget", "Disbursed", "Queued", "Remaining"], totals: ["Budget", "Disbursed", "Queued", "Remaining"],
        },
        { name: "Payment Pipeline", head: ["Status", "Payments", "Amount"], rows: pipeline, money: ["Amount"] },
        {
          name: "By Scholarship Program",
          head: ["Scholarship", "Payments", "Scholars Paid", "Disbursed", "Avg per Scholar", "Queued", "Cancelled"], rows: byProgram,
          money: ["Disbursed", "Avg per Scholar", "Queued", "Cancelled"], totals: ["Payments", "Disbursed", "Queued", "Cancelled"],
        },
        {
          name: "By Month Disbursed", head: ["Month", "Payments", "Scholars Paid", "Disbursed"],
          rows: [...months.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, l]) => [new Date(`${k}-01T00:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" }), l.length, new Set(l.map((p) => p.user_id)).size, sum(l)]),
          money: ["Disbursed"], totals: ["Payments", "Disbursed"],
        },
        {
          name: "By Academic Year & Semester", head: ["AY / Semester", "Payments", "Scholars Paid", "Disbursed", "Queued"],
          rows: [...terms.entries()].sort(([x], [y]) => y.localeCompare(x)).map(([k, l]) => { const lp = l.filter((p) => p.status === "Disbursed"); return [k, l.length, new Set(lp.map((p) => p.user_id)).size, sum(lp), queuedOf(l)]; }),
          money: ["Disbursed", "Queued"], totals: ["Payments", "Disbursed", "Queued"],
        },
        { name: "By Payment Method", head: ["Method", "Payments", "Amount", "Share %"], rows: [...methods.entries()].sort((x, y) => sum(y[1]) - sum(x[1])).map(([m, l]) => [m, l.length, sum(l), pct(sum(l), sum(paid))]), money: ["Amount"], totals: ["Payments", "Amount"] },
        {
          name: "Cancelled Payments", head: ["Student", "Program", "Reference", "Created", "Cancelled On", "Cancelled By", "Amount", "Reason"],
          rows: cancelled.map((p) => [payStudent(p), payProgram(p), p.reference || "—", fmtDate(p.created_at), fmtDate(p.cancelled_at), staffName(p.cancelled_by), Number(p.amount), p.cancel_reason || "—"]),
          money: ["Amount"], totals: ["Amount"],
        },
      ],
    };
  }

  if (key === "disbursements") {
    const list = data.payments.filter((p) => s.payOk(p) && s.within(s.payDate(p)) && (f.payStatus === "all" ? p.status !== "Cancelled" : p.status === f.payStatus))
      .sort((x, y) => s.payDate(x).localeCompare(s.payDate(y)) || payStudent(x).localeCompare(payStudent(y)));
    const totals = (["Pending", "Processing", "Disbursed", "Cancelled"] as const)
      .map((st) => { const l = list.filter((p) => p.status === st); return [st, l.length, sum(l)]; })
      .filter((r) => (r[1] as number) > 0);
    const programs = new Map<string, Tables<"payments">[]>();
    list.forEach((p) => { const k = payProgram(p); programs.set(k, [...(programs.get(k) ?? []), p]); });
    const paid = list.filter((p) => p.status === "Disbursed");
    const receiptText = (p: Tables<"payments">) => (p.student_receipt_ref ?? (p.student_receipt_path ? "Photo (before reference numbers)" : p.student_receipt_at ? "Confirmed, no number" : "Not yet submitted"));
    const matches = (p: Tables<"payments">) => {
      if (!p.student_receipt_ref || !p.reference) return "—";
      const k = (r: string) => r.toUpperCase().replace(/[\s\-_./#]/g, "");
      return k(p.student_receipt_ref) === k(p.reference) ? "Yes" : "No";
    };
    return {
      title: "Disbursement Summary", filters, count: list.length, countLabel: "payments",
      notes: [
        "Payments fall in the period by disbursed date, else scheduled date, else the date created.",
        "Receipt Ref. is the reference number the student typed from the receipt they signed. Matches compares it with the payment's own reference (cheque or voucher number).",
      ],
      sections: [
        {
          name: "Payments",
          head: ["Student", "Student ID", "Barangay", "Program", "AY / Semester", "Type", "Reference", "Method", "Preferred", "Status", "Scheduled", "Disbursed", "Disbursed By", "Proof on File", "Notes", "Amount"],
          rows: list.map((p) => {
            const st = s.profById.get(p.user_id), a = s.payApp(p);
            return [payStudent(p), st?.student_id_number || "—", st?.barangay || "—", payProgram(p), termText(a), a ? kind(a) : "—", p.reference || "—", p.method || "—", p.preferred_method || "—",
              p.status, fmtDate(p.scheduled_date), fmtDate(p.disbursed_at), staffName(p.disbursed_by), p.receipt_path ? "Yes" : "No", clip(p.notes, 80), Number(p.amount)];
          }),
          money: ["Amount"], totals: ["Amount"],
        },
        {
          name: "Student Receipt Confirmation",
          head: ["Student", "Program", "Reference", "Disbursed", "Receipt Ref.", "Matches", "Submitted", "Review", "Reviewed By", "Reviewed On", "Review Note", "Amount"],
          rows: paid.map((p) => [payStudent(p), payProgram(p), p.reference || "—", fmtDate(p.disbursed_at), receiptText(p), matches(p), fmtDate(p.student_receipt_at),
            p.student_receipt_at ? p.receipt_review_status : "—", staffName(p.receipt_reviewed_by), fmtDate(p.receipt_reviewed_at), clip(p.receipt_review_note, 80), Number(p.amount)]),
          money: ["Amount"], totals: ["Amount"],
        },
        { name: "Totals by Program", head: ["Program", "Payments", "Scholars", "Amount"], rows: [...programs.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, l]) => [k, l.length, new Set(l.map((p) => p.user_id)).size, sum(l)]), money: ["Amount"], totals: ["Payments", "Amount"] },
        { name: "Totals by Status", head: ["Status", "Payments", "Amount"], rows: totals, money: ["Amount"], totals: ["Payments", "Amount"] },
      ],
    };
  }

  if (key === "grades") {
    const scholars = data.applications.filter((a) => a.status === "Approved" && s.progOk(a.scholarship_id));
    const scholarIds = new Set(scholars.map((a) => a.user_id));
    const subs = data.gradeUpdates.filter((g) => s.within(g.created_at) && (f.program === "all" || scholarIds.has(g.user_id)));
    const programOfUser = (uid: string) => scholars.filter((a) => a.user_id === uid).map((a) => a.scholarships?.name).filter(Boolean).join(", ") || "—";
    const required = (a: ReportApp) => Number(data.scholarships.find((sc) => sc.id === a.scholarship_id)?.min_grade ?? data.minGrade);
    const current = (uid: string) => s.profById.get(uid)?.average_grade ?? null;
    const below = scholars.filter((a) => { const g = current(a.user_id); return g === null || Number(g) < required(a); });
    const byProgram = data.scholarships.filter((sc) => s.progOk(sc.id)).map((sc) => {
      const l = scholars.filter((a) => a.scholarship_id === sc.id);
      const grades = l.map((a) => current(a.user_id)).filter((g): g is number => g !== null).map(Number);
      const avg = mean(grades);
      return [sc.name, l.length, grades.length, avg === null ? "—" : avg.toFixed(2), grades.length ? Math.min(...grades) : "—", below.filter((a) => a.scholarship_id === sc.id).length];
    }).filter((r) => (r[1] as number) > 0);
    const statusCounts = ["Pending", "Approved", "Disapproved"].map((st) => [st, subs.filter((g) => g.status === st).length]);
    return {
      title: "Grades & Retention", filters, count: subs.length + scholars.length, countLabel: "records",
      notes: ["Current grade is the scholar's verified average on file. The required grade is the program minimum, or the portal minimum when the program has none."],
      sections: [
        { name: "Average Grade by Program", head: ["Scholarship", "Scholars", "With Grade", "Average", "Lowest", "Below Minimum"], rows: byProgram, totals: ["Scholars", "With Grade", "Below Minimum"] },
        { name: "Scholars Below Minimum", head: ["Student", "Program", "Current Grade", "Required", "Grade Term"], rows: below.map((a) => [personName(a.profiles), a.scholarships?.name || "—", current(a.user_id) ?? "No grade on file", required(a), s.profById.get(a.user_id)?.grade_term || "—"]) },
        { name: "Grade Submissions by Status", head: ["Status", "Submissions"], rows: statusCounts, totals: ["Submissions"] },
        { name: "Grade Submissions", head: ["Student", "Program", "Term", "Grade", "Status", "Submitted", "Reviewed", "Note"], rows: subs.map((g) => [personName(s.profById.get(g.user_id)), programOfUser(g.user_id), g.term, Number(g.grade), g.status, fmtDate(g.created_at), fmtDate(g.reviewed_at), clip(g.review_note)]) },
      ],
    };
  }

  if (key === "operations") {
    const t = turnaround(data, f);
    const open = data.applications.filter((a) => a.status === "Pending" || a.status === "Waitlisted");
    const oldest = open.length ? Math.max(...open.map((a) => daysBetween(a.created_at, new Date().toISOString()))) : null;
    const issues = data.payIssues.filter((i) => s.within(i.created_at));
    const issueKinds = [...new Set(issues.map((i) => i.kind))].sort();
    const resolveDays = (i: Tables<"payment_issues">) => (i.resolved_at ? daysBetween(i.created_at, i.resolved_at) : null);
    const paid = data.payments.filter((p) => p.status === "Disbursed" && s.within(s.payDate(p)));
    const receiptState = (p: Tables<"payments">) => (p.student_receipt_at ? `Receipt ${p.receipt_review_status.toLowerCase()}` : "No receipt submitted");
    const receiptRows = [...new Set(paid.map(receiptState))].sort().map((st) => [st, paid.filter((p) => receiptState(p) === st).length]);
    const docRows = open.filter((a) => s.within(a.created_at)).map((a) => {
      const sameYear = new Set(data.applications.filter((x) => x.user_id === a.user_id && x.academic_year === a.academic_year).map((x) => x.id));
      const latest = data.requiredDocuments.map((type) => ({
        type,
        doc: data.documents
          .filter((d) => d.user_id === a.user_id && d.document_type === type && (d.application_id === null || sameYear.has(d.application_id)))
          .sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at))[0],
      }));
      const missing = latest.filter((x) => !x.doc).map((x) => x.type);
      return [personName(a.profiles), a.scholarships?.name || "—", fmtDate(a.created_at), data.requiredDocuments.length, latest.filter((x) => x.doc).length, latest.filter((x) => x.doc?.status === "Verified").length, latest.filter((x) => x.doc?.status === "Disapproved").length, missing.join(", ") || "—"];
    });
    const reqs = data.dataRequests.filter((r) => s.within(r.created_at));
    const handleDays = (r: Tables<"data_requests">) => (r.handled_at ? daysBetween(r.created_at, r.handled_at) : null);
    return {
      title: "Operations Report", filters, count: t.decided + issues.length + paid.length + docRows.length + reqs.length, countLabel: "records",
      sections: [
        {
          name: "Turnaround",
          head: ["Metric", "Value"],
          rows: [
            ["Applications decided in period", t.decided],
            ["Average days from submission to decision", dayText(t.avgDecision)],
            ["Median days from submission to decision", dayText(t.medianDecision)],
            ["Longest wait for a decision", dayText(t.maxDecision)],
            ["Applications still pending or waitlisted (now)", open.length],
            ["Oldest open application", dayText(oldest)],
            ["Average days from approval to first payout", dayText(t.avgPayout)],
            ["Scholars paid out (approved in period)", t.paidOut],
          ],
        },
        {
          name: "Payment Problems Summary",
          head: ["Kind", "Reported", "Resolved", "Open", "Avg Days to Resolve"],
          rows: issueKinds.map((k) => { const l = issues.filter((i) => i.kind === k); const d = l.map(resolveDays).filter((x): x is number => x !== null); return [k, l.length, d.length, l.length - d.length, dayText(mean(d))]; }),
          totals: ["Reported", "Resolved", "Open"],
        },
        {
          name: "Payment Problem Reports",
          head: ["Student", "Kind", "Status", "Reported", "Resolved", "Days", "Message"],
          rows: issues.map((i) => { const d = resolveDays(i); return [personName(s.profById.get(i.user_id)), i.kind, i.status, fmtDate(i.created_at), fmtDate(i.resolved_at), d === null ? "—" : d.toFixed(1), clip(i.message)]; }),
        },
        { name: "Student Receipt Confirmations", head: ["Status", "Disbursed Payments"], rows: receiptRows, totals: ["Disbursed Payments"] },
        { name: "Document Completeness (open applications)", head: ["Student", "Program", "Submitted", "Required", "Uploaded", "Verified", "Disapproved", "Missing"], rows: docRows },
        {
          name: "Data & Deletion Requests",
          head: ["Student", "Kind", "Status", "Requested", "Handled", "Days"],
          rows: reqs.map((r) => { const d = handleDays(r); return [personName(s.profById.get(r.user_id)), r.kind, r.status, fmtDate(r.created_at), fmtDate(r.handled_at), d === null ? "—" : d.toFixed(1)]; }),
        },
      ],
    };
  }

  if (key === "history") {
    const p = s.profById.get(f.student);
    if (!p) return { title: "Scholar History", filters: ["Student: none selected"], count: 0, countLabel: "students", sections: [] };
    const apps = data.applications.filter((a) => a.user_id === p.id);
    const pays = data.payments.filter((x) => x.user_id === p.id).sort((x, y) => y.created_at.localeCompare(x.created_at));
    const grades = data.gradeUpdates.filter((g) => g.user_id === p.id);
    const issues = data.payIssues.filter((i) => i.user_id === p.id);
    return {
      title: `Scholar History — ${personName(p)}`, filters: [`Student: ${personName(p)}${p.student_id_number ? ` (${p.student_id_number})` : ""}`], count: 1, countLabel: "student",
      sections: [
        {
          name: "Profile", head: ["Field", "Value"],
          rows: [
            ["Name", personName(p)], ["Email", p.email || "—"], ["Phone", p.phone || "—"], ["Student ID", p.student_id_number || "—"],
            ["School", p.school_name || "—"], ["Course", p.course || "—"], ["Year Level", p.year_level || "—"],
            ["Current Grade", p.average_grade ?? "—"], ["Grade Term", p.grade_term || "—"],
            ["Address", [p.barangay, p.municipality, p.province].filter(Boolean).join(", ") || "—"],
            ["Account", p.is_active ? "Active" : "Inactive"], ["Registered", fmtDate(p.created_at)],
          ],
        },
        {
          name: "Summary", head: ["Metric", "Value"],
          rows: [
            ["Applications", apps.length], ["Approved", apps.filter((a) => a.status === "Approved").length],
            ["Total disbursed", formatPHP(sum(pays.filter((x) => x.status === "Disbursed")))],
            ["Queued", formatPHP(sum(pays.filter((x) => x.status === "Pending" || x.status === "Processing")))],
          ],
        },
        {
          name: "Applications", head: ["Submitted", "Program", "AY / Semester", "Type", "School", "Grade", "Status", "Decided", "Award"],
          rows: apps.map((a) => [fmtDate(a.created_at), a.scholarships?.name || "—", [a.academic_year, a.semester].filter(Boolean).join(" · ") || "—", kind(a), appSchool(a) || "—", appGrade(a) ?? "—", a.status, fmtDate(a.decided_at), a.status === "Approved" ? s.appAward(a) : "—"]),
          money: ["Award"],
        },
        {
          name: "Payments", head: ["Created", "Program", "Reference", "Method", "Status", "Disbursed", "Receipt Ref.", "Receipt Review", "Amount"],
          rows: pays.map((x) => [fmtDate(x.created_at), payProgram(x), x.reference || "—", x.method || "—", x.status, fmtDate(x.disbursed_at),
            x.student_receipt_ref ?? (x.student_receipt_path ? "Photo" : "—"), x.student_receipt_at ? x.receipt_review_status : "—", Number(x.amount)]),
          money: ["Amount"],
        },
        { name: "Grade Submissions", head: ["Term", "Grade", "Status", "Submitted", "Reviewed"], rows: grades.map((g) => [g.term, Number(g.grade), g.status, fmtDate(g.created_at), fmtDate(g.reviewed_at)]) },
        { name: "Payment Problems", head: ["Reported", "Kind", "Status", "Resolved"], rows: issues.map((i) => [fmtDate(i.created_at), i.kind, i.status, fmtDate(i.resolved_at)]) },
      ],
    };
  }

  if (key === "audit") {
    const ctx = auditContext(data);
    const logs = data.auditLogs.filter((l) => s.within(l.created_at)
      && (f.auditAction === "all" || l.action === f.auditAction)
      && (f.auditEntity === "all" || l.entity_type === f.auditEntity)
      && (f.auditUser === "all" || (l.user_id ?? "system") === f.auditUser));
    const userLabel = f.auditUser === "all" ? "All users" : f.auditUser === "system" ? "System" : (() => { const l = logs.find((x) => x.user_id === f.auditUser); return l ? ctx.user(l) : "Selected user"; })();
    const count = <K extends string>(keyOf: (l: Tables<"audit_logs">) => K) => {
      const m = new Map<K, Tables<"audit_logs">[]>();
      logs.forEach((l) => { const k = keyOf(l); m.set(k, [...(m.get(k) ?? []), l]); });
      return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
    };
    return {
      title: "Audit Trail", count: logs.length, countLabel: "entries",
      filters: [...filters, `Action: ${f.auditAction === "all" ? "All" : f.auditAction}`, `Record type: ${f.auditEntity === "all" ? "All" : f.auditEntity}`, `User: ${userLabel}`],
      notes: [
        `Times are shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Long Before/After values are shortened in the PDF; the Excel export has them in full.`,
        ...(data.auditTruncated ? [`Only the newest ${data.auditLogs.length.toLocaleString()} entries of the period were loaded. Narrow the period to export the rest.`] : []),
      ],
      sections: [
        { name: "Entries by Action", head: ["Action", "Record Type", "Entries", "Users"], rows: count((l) => `${l.action}\u0000${l.entity_type}`).map(([k, l]) => { const [a, e] = k.split("\u0000"); return [a, e, l.length, new Set(l.map((x) => x.user_id ?? "system")).size]; }), totals: ["Entries"] },
        { name: "Entries by User", head: ["User", "Email", "Role", "Entries", "First", "Last"], rows: count((l) => l.user_id ?? "system").map(([, l]) => [ctx.user(l[0]), l[0].user_email || "—", ctx.role(l[0]), l.length, fmtDateTime(l[l.length - 1].created_at), fmtDateTime(l[0].created_at)]), totals: ["Entries"] },
        logsToSection(logs, data),
      ],
    };
  }

  // statistics
  const apps = data.applications.filter((a) => s.appOk(a) && s.within(a.created_at));
  const by = (st: string) => apps.filter((a) => a.status === st).length;
  const approved = by("Approved");
  const decided = approved + by("Disapproved");
  // Turnaround here is for the applications submitted in the period, so it describes the same group as every other figure.
  const toDecision = apps.filter((a) => a.decided_at).map((a) => daysBetween(a.created_at, a.decided_at!));
  const incomes = apps.map((a) => a.household_income).filter((x): x is number => x !== null).map(Number);
  const sizes = apps.map((a) => a.household_size).filter((x): x is number => x !== null).map(Number);
  const groupRow = (name: string, l: ReportApp[]) => {
    const c = (st: string) => l.filter((a) => a.status === st).length;
    return [name, l.length, c("Approved"), c("Disapproved"), c("Pending") + c("Waitlisted"), c("Withdrawn"), pct(c("Approved"), c("Approved") + c("Disapproved"))];
  };
  const groupSection = (name: string, label: (a: ReportApp) => string | null | undefined, order?: string[]): ReportSection => {
    const m = new Map<string, ReportApp[]>();
    apps.forEach((a) => { const k = label(a) || "Not specified"; m.set(k, [...(m.get(k) ?? []), a]); });
    const entries = [...m.entries()];
    if (order) entries.sort(([x], [y]) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99));
    else entries.sort((x, y) => y[1].length - x[1].length);
    return {
      name, head: [name.replace(/^By /, ""), "Applications", "Approved", "Disapproved", "Pending", "Withdrawn", "Approval Rate"],
      rows: entries.map(([k, l]) => groupRow(k, l)),
      totals: ["Applications", "Approved", "Disapproved", "Pending", "Withdrawn"],
    };
  };
  const ageAt = (a: ReportApp) => ageOn(a.profiles?.dob, a.created_at);
  const months = [...new Set(apps.map((a) => a.created_at.slice(0, 7)))].sort();
  const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const avgIncome = mean(incomes);
  const medIncome = median(incomes);
  const avgSize = mean(sizes);
  const avgDecision = mean(toDecision), medDecision = median(toDecision);
  return {
    title: "Applicant Statistics", filters, count: apps.length, countLabel: "applications",
    notes: [
      "Approval rate is approved ÷ decided (approved + disapproved). Pending includes waitlisted. Every row adds up: Applications = Approved + Disapproved + Pending + Withdrawn.",
      "Days to decision cover the applications submitted in the period that have been decided. Household income is monthly, as entered by the applicant. Age is at the time of applying.",
    ],
    sections: [
      {
        name: "Summary", head: ["Metric", "Value"],
        rows: [
          ["Total Applications", apps.length], ["Unique Applicants", new Set(apps.map((a) => a.user_id)).size],
          ["Approved", approved], ["Disapproved", by("Disapproved")], ["Pending", by("Pending")], ["Waitlisted", by("Waitlisted")], ["Withdrawn", by("Withdrawn")],
          ["Approval Rate (of all)", pct(approved, apps.length)], ["Approval Rate (of decided)", pct(approved, decided)],
          ["New Applicants", apps.filter((a) => !a.is_renewal).length], ["Renewals", apps.filter((a) => a.is_renewal).length],
          ["Average Days to Decision", dayText(avgDecision)], ["Median Days to Decision", dayText(medDecision)],
          ["Average Monthly Household Income", avgIncome === null ? "—" : formatPHP(avgIncome)], ["Median Monthly Household Income", medIncome === null ? "—" : formatPHP(medIncome)],
          ["Average Household Size", avgSize === null ? "—" : avgSize.toFixed(1)],
        ],
      },
      { ...groupSection("By Scholarship Program", (a) => a.scholarships?.name), rows: data.scholarships.filter((sc) => s.progOk(sc.id)).map((sc) => groupRow(sc.name, apps.filter((a) => a.scholarship_id === sc.id))) },
      groupSection("By Month Submitted", (a) => monthLabel(a.created_at.slice(0, 7)), months.map(monthLabel)),
      groupSection("By Academic Year & Semester", (a) => termText(a), [...new Set(apps.map(termText))].sort().reverse()),
      groupSection("By Applicant Type", kind, ["New", "Renewal"]),
      groupSection("By Sex", (a) => a.profiles?.sex),
      groupSection("By Age", (a) => ageBracket(ageAt(a)), [...AGE_BRACKETS.map(([l]) => l), "Not specified"]),
      groupSection("By Civil Status", (a) => a.profiles?.civil_status),
      groupSection("By Year Level", appYearLevel),
      groupSection("By Grade at Application", (a) => gradeBracket(a.average_grade), [...GRADE_BRACKETS.map(([l]) => l), "Not specified"]),
      groupSection("By School", appSchool),
      groupSection("By Course", appCourse),
      groupSection("By Municipality", (a) => a.profiles?.municipality),
      groupSection("By Barangay", (a) => a.profiles?.barangay),
      groupSection("By Household Income", (a) => incomeBracket(a.household_income), [...INCOME_BRACKETS.map(([l]) => l), "Not specified"]),
      groupSection("By Household Size", (a) => sizeBracket(a.household_size), ["1–2", "3–4", "5–6", "7 or more", "Not specified"]),
    ],
  };
}

// ── Totals row ──
export function totalsRow(sec: ReportSection): (string | number)[] | null {
  if (!sec.totals?.length || !sec.rows.length) return null;
  return sec.head.map((h, i) => {
    if (i === 0) return "Total";
    if (!sec.totals!.includes(h)) return "";
    return sec.rows.reduce((t, r) => t + (typeof r[i] === "number" ? (r[i] as number) : 0), 0);
  });
}

// ── Export ──
export type Signatories = { preparedBy: string; preparedTitle: string; approvedBy: string; approvedTitle: string };
type ExportOpts = { landscape?: boolean; generatedBy?: string; programName?: string; signatories?: Signatories | null };

// jsPDF's built-in fonts can't draw "₱", so PDFs spell the currency out.
const pdfPHP = (n: number) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderPDF(def: ReportDef, file: string, opts: ExportOpts = {}) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF(opts.landscape ? { orientation: "landscape" } : undefined);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const clean = (t: string) => t.replace(/₱/g, "PHP ");
  doc.setFontSize(16);
  doc.text(opts.programName || "SB San Jose Scholarship Portal", 14, 15);
  doc.setFontSize(12);
  doc.text(clean(def.title), 14, 22);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}${opts.generatedBy ? ` by ${opts.generatedBy}` : ""}`, 14, 28);
  doc.text(clean(def.filters.join("   |   ")), 14, 33);
  let y = 40;
  for (const n of def.notes ?? []) {
    const lines = doc.splitTextToSize(clean(n), pageW - 28);
    doc.text(lines, 14, y - 2);
    y += lines.length * 4;
  }
  // Very long values (audit Before/After JSON) are shortened on paper; Excel keeps them whole.
  const cell = (sec: ReportSection, c: string | number, i: number) => (sec.money?.includes(sec.head[i]) && typeof c === "number" ? pdfPHP(c) : clean(clip(String(c), 300)));
  for (const sec of def.sections) {
    if (y > pageH - 30) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.text(sec.name, 14, y);
    const total = totalsRow(sec);
    autoTable(doc, {
      startY: y + 3,
      head: [sec.head],
      body: sec.rows.length ? sec.rows.map((r) => r.map((c, i) => cell(sec, c, i))) : [[{ content: "No data for these filters", colSpan: sec.head.length, styles: { halign: "center", textColor: 120 } }]],
      foot: total ? [total.map((c, i) => cell(sec, c, i))] : undefined,
      showFoot: "lastPage",
      styles: { fontSize: sec.head.length > 13 ? 6 : sec.head.length > 9 ? 7 : 8, cellPadding: sec.head.length > 13 ? 1 : 1.5 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      // Money columns right-aligned in the header, body and totals alike.
      didParseCell: (h) => { if (sec.money?.includes(sec.head[h.column.index]) && sec.rows.length) h.cell.styles.halign = "right"; },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }
  if (opts.signatories !== null) {
    const sig = opts.signatories ?? { preparedBy: "", preparedTitle: "", approvedBy: "", approvedTitle: "" };
    if (y > pageH - 45) { doc.addPage(); y = 25; } else y += 8;
    const block = (x: number, label: string, name: string, title: string) => {
      doc.setFontSize(9);
      doc.text(label, x, y);
      doc.line(x, y + 14, x + 70, y + 14);
      doc.setFontSize(10);
      if (name) doc.text(name, x, y + 19);
      doc.setFontSize(8);
      if (title) doc.text(title, x, y + 23);
    };
    block(14, "Prepared by:", sig.preparedBy, sig.preparedTitle);
    block(Math.max(100, pageW - 84), "Approved by:", sig.approvedBy, sig.approvedTitle);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Page ${i} of ${pages}`, pageW - 30, pageH - 8);
  }
  doc.save(file);
}

export async function renderExcel(def: ReportDef, file: string, opts: Pick<ExportOpts, "generatedBy" | "programName"> = {}) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const about = [[opts.programName || "SB San Jose Scholarship Portal"], [def.title], [`Generated ${new Date().toLocaleString()}${opts.generatedBy ? ` by ${opts.generatedBy}` : ""}`], ...def.filters.map((f) => [f]), ...(def.notes ?? []).map((n) => [n])];
  const aboutSheet = XLSX.utils.aoa_to_sheet(about);
  aboutSheet["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, aboutSheet, "About");
  const used = new Set<string>(["About"]);
  for (const sec of def.sections) {
    let name = sec.name.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet";
    let n = 2;
    while (used.has(name)) name = `${sec.name.replace(/[\\/?*[\]:]/g, "").slice(0, 28)} ${n++}`;
    used.add(name);
    const total = totalsRow(sec);
    const aoa = [sec.head, ...sec.rows, ...(total ? [total] : [])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Peso format on money columns, so the numbers stay numbers in Excel.
    sec.head.forEach((h, c) => {
      if (!sec.money?.includes(h)) return;
      for (let r = 1; r < aoa.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === "n") cell.z = '"₱"#,##0.00';
      }
    });
    ws["!cols"] = sec.head.map((h, c) => ({ wch: Math.min(60, Math.max(h.length, ...aoa.map((r) => String(r[c] ?? "").length)) + 2) }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, sec.rows.length), c: sec.head.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, file);
}
