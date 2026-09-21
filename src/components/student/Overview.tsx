"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Banknote, Bell, CalendarDays, Check, CheckCircle, ChevronRight, Circle, Eye, FileText,
  GraduationCap, Info, Lock, Upload, User, Users, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ProfileImage from "@/components/ProfileImage";
import ApplicationTimeline from "@/components/student/ApplicationTimeline";
import { Panel, SectionTitle, StatCard, StatusBadge } from "@/components/student/ui";
import { profileCompleteness } from "@/lib/profile";
import { availabilityInfo, deadlineLabel, peso, requirementLines, slotsLabel, type PublicScholarship } from "@/lib/scholarships";
import type { AppSettings } from "@/lib/settings";
import type { Tables } from "@/integrations/supabase/types";

type AppRow = Tables<"applications"> & { scholarships: { name: string } | null };

export type OverviewProps = {
  displayName: string;
  profile: Tables<"profiles"> | null;
  applications: AppRow[];
  currentApp: AppRow | undefined;
  payments: Tables<"payments">[];
  issues: Tables<"payment_issues">[];
  gradeUpdates: Tables<"grade_updates">[];
  docStatus: { uploaded: number; required: number; missing: string[]; rejected: { type: string; note: string | null }[] };
  scholarships: PublicScholarship[];
  notifications: Tables<"notifications">[];
  settings: AppSettings;
  /** Why the student can't submit an application right now (maintenance, closed, outside the window), or null. */
  applyBlocked: string | null;
  approvedTotal: number;
  locked: boolean;
  isDisbursed: boolean;
  currentYear: number;
  onNavigate: (tab: string) => void;
  onApply: (programId: string) => void;
  unreadCount: number;
  onOpenNotification: (n: Tables<"notifications">) => void;
  onMarkAllRead: () => void;
};

type Action = { id: string; tone: "red" | "amber" | "blue" | "green"; title: string; detail?: string; tab: string; cta: string };

const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
const daysUntil = (d: string) => Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86_400_000);

const toneCls: Record<Action["tone"], string> = {
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  blue: "border-primary/20 bg-accent text-foreground",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export default function Overview(p: OverviewProps) {
  const { profile, applications, currentApp, payments, settings, applyBlocked, scholarships } = p;
  const [showAllPrograms, setShowAllPrograms] = useState(false);
  const [program, setProgram] = useState<PublicScholarship | null>(null);

  const firstName = p.displayName.split(" ")[0] || "Student";
  const unread = p.unreadCount;
  const completeness = useMemo(() => profileCompleteness(profile), [profile]);
  const isNew = applications.length === 0;

  // ── money ──
  const live = payments.filter((x) => x.status !== "Cancelled");
  const disbursedTotal = live.filter((x) => x.status === "Disbursed").reduce((t, x) => t + x.amount, 0);
  const nextPayment = live
    .filter((x) => x.status === "Pending" || x.status === "Processing")
    .sort((a, b) => (a.scheduled_date ?? "9999").localeCompare(b.scheduled_date ?? "9999"))[0];

  // ── notices (what the whole system is doing, not just this student) ──
  const notices = useMemo(() => {
    const out: { tone: "red" | "amber" | "blue"; text: string }[] = [];
    if (settings.maintenance_mode) out.push({ tone: "red", text: settings.maintenance_message });
    else if (applyBlocked) out.push({ tone: "amber", text: applyBlocked });
    else if (!currentApp) {
      if (settings.application_close_date) {
        const d = daysUntil(settings.application_close_date);
        if (d >= 0 && d <= 14) out.push({ tone: "amber", text: `Applications close on ${short(settings.application_close_date)}${d === 0 ? " (today)" : ` (${d} day${d === 1 ? "" : "s"} left)`}.` });
      }
      const soonest = scholarships
        .filter((s) => s.availability === "open" && s.deadline && daysUntil(s.deadline) >= 0 && daysUntil(s.deadline) <= 14)
        .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""))[0];
      if (soonest?.deadline) out.push({ tone: "blue", text: `${soonest.name} closes ${daysUntil(soonest.deadline) === 0 ? "today" : `in ${daysUntil(soonest.deadline)} day${daysUntil(soonest.deadline) === 1 ? "" : "s"}`} (${short(soonest.deadline)}).` });
    }
    return out;
  }, [settings, applyBlocked, currentApp, scholarships]);

  // ── things that need the student ──
  const actions = useMemo(() => {
    const out: Action[] = [];
    const lastGrade = p.gradeUpdates[0];

    p.docStatus.rejected.forEach((d) =>
      out.push({ id: `doc-${d.type}`, tone: "red", title: `Upload a new ${d.type}`, detail: d.note ? `The office said: ${d.note}` : "The office didn't accept your copy.", tab: "documents", cta: "Replace" }));

    live.filter((x) => x.status === "Disbursed" && (!x.student_receipt_at || x.receipt_review_status === "Rejected")).forEach((x) =>
      out.push({ id: `rcpt-${x.id}`, tone: x.receipt_review_status === "Rejected" ? "red" : "amber",
        title: x.receipt_review_status === "Rejected" ? `Send your receipt again for ${peso(x.amount)}` : `Submit your signed receipt for ${peso(x.amount)}`,
        detail: x.receipt_review_status === "Rejected" ? x.receipt_review_note ?? undefined : "Upload it, or for cash confirm you received it.", tab: "disbursement", cta: "Open" }));

    if (lastGrade?.status === "Rejected") {
      out.push({ id: "grade", tone: "red", title: "Your grade update was not accepted", detail: lastGrade.review_note ?? undefined, tab: "profile", cta: "Fix it" });
    }

    if (!isNew) {
      if (completeness.missing.length > 0) {
        out.push({ id: "profile", tone: "amber", title: `Complete your profile (${completeness.percent}%)`, detail: `Still needed: ${completeness.missing.map((m) => m.label).join(", ")}.`, tab: "profile", cta: "Complete" });
      }
      const rejectedTypes = new Set(p.docStatus.rejected.map((d) => d.type));
      const gone = p.docStatus.missing.filter((m) => !rejectedTypes.has(m));
      if (gone.length > 0 && (!currentApp || currentApp.status === "Pending")) {
        out.push({ id: "docs", tone: "amber", title: `Upload ${gone.length} required document${gone.length === 1 ? "" : "s"}`, detail: gone.join(", "), tab: "documents", cta: "Upload" });
      }
    }

    p.issues.filter((i) => i.status === "Open").forEach((i) =>
      out.push({ id: `issue-${i.id}`, tone: "blue", title: "Waiting for the office to reply to your payment report", tab: "disbursement", cta: "View" }));

    if (!currentApp && !applyBlocked && !isNew) {
      out.push({ id: "apply", tone: "blue", title: "You can apply for a scholarship", detail: "Applications are open.", tab: "application", cta: "Apply" });
    }

    const order = { red: 0, amber: 1, blue: 2, green: 3 } as const;
    return out.sort((a, b) => order[a.tone] - order[b.tone]);
  }, [p.docStatus, p.gradeUpdates, p.issues, live, isNew, completeness, currentApp, applyBlocked]);

  // ── getting started (students who haven't applied yet) ──
  const checklist = [
    { label: "Complete your profile", done: completeness.missing.length === 0, tab: "profile", hint: completeness.missing.length ? `${completeness.missing.length} item${completeness.missing.length === 1 ? "" : "s"} left` : undefined },
    { label: "Get your grade verified", done: !!profile?.grade_verified_at, tab: "profile", hint: profile?.grade_verified_at ? undefined : "Submit your grade report in your profile" },
    { label: "Upload your required documents", done: p.docStatus.required > 0 && p.docStatus.missing.length === 0, tab: "documents", hint: p.docStatus.missing.length ? `${p.docStatus.missing.length} left` : undefined },
    { label: "Apply for a scholarship", done: !isNew, tab: "application", hint: applyBlocked ?? undefined },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;

  // ── programs ──
  const shownPrograms = showAllPrograms ? scholarships : scholarships.slice(0, 3);
  const programGrade = program
    ? requirementLines(program, currentApp?.is_renewal || applications.some((a) => a.status === "Approved") ? settings.renewal_min_grade : settings.min_grade_requirement)
    : [];
  const programBlock = !program ? null
    : currentApp ? `You already have an application for ${p.currentYear}.`
    : applyBlocked ? applyBlocked
    : !availabilityInfo(program).canApply ? availabilityInfo(program).label
    : null;

  const statusSub = !currentApp ? `No application for ${p.currentYear}`
    : currentApp.status === "Rejected" ? "See the reason below"
    : currentApp.status === "Waitlisted" ? "On the waitlist"
    : `${currentApp.is_renewal ? "Renewal · " : ""}Submitted ${new Date(currentApp.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-hero p-5 sm:p-7">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0, #fff 1px, transparent 1px, transparent 14px)" }} />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-display font-bold text-white">Dashboard</h1>
            <p className="text-sm text-white/80 mt-1">Welcome back, {firstName}! {actions.some((a) => a.tone !== "green" && a.tone !== "blue") ? "There are a few things that need your attention." : "Here's where things stand."}</p>
          </div>
          <div className="flex items-center gap-3 sm:shrink-0">
            <button onClick={() => p.onNavigate("notifications")} className="relative h-11 w-11 sm:h-10 sm:w-10 shrink-0 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer" aria-label="Notifications">
              <Bell className="h-4.5 w-4.5 text-white" />
              {unread > 0 && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white text-primary text-[9px] font-bold flex items-center justify-center">{unread > 9 ? "9+" : unread}</span>}
            </button>
            <button onClick={() => p.onNavigate("application")}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-white text-primary text-sm font-semibold px-4 py-3 sm:py-2.5 hover:bg-white/90 transition-colors cursor-pointer shadow-sm">
              {currentApp ? <Eye className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {currentApp ? "View Application" : applyBlocked ? "Applications unavailable" : "Apply for Scholarship"}
            </button>
          </div>
        </div>
      </div>

      {/* System / deadline notices */}
      {notices.map((n, i) => (
        <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${n.tone === "red" ? toneCls.red : n.tone === "amber" ? toneCls.amber : toneCls.blue}`}>
          {n.tone === "blue" ? <Info className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
          <span>{n.text}</span>
        </div>
      ))}

      {/* Getting started (new students) */}
      {isNew && (
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionTitle>Getting started</SectionTitle>
            <span className="text-xs font-semibold text-primary -mt-3">{checklistDone} of {checklist.length} done</span>
          </div>
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.label}>
                <button type="button" onClick={() => p.onNavigate(c.tab)} className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/60 transition-colors cursor-pointer">
                  <span className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${c.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {c.done ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`text-sm font-medium ${c.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{c.label}</span>
                    {!c.done && c.hint && <span className="block text-xs text-muted-foreground">{c.hint}</span>}
                  </span>
                  {!c.done && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Action needed */}
      <Panel className="p-5">
        <SectionTitle>Action needed</SectionTitle>
        {actions.length === 0 ? (
          <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${toneCls.green}`}>
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>You&apos;re all set. Nothing needs your attention right now.</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {actions.map((a) => (
              <li key={a.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl border px-4 py-3 ${toneCls[a.tone]}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{a.title}</p>
                  {a.detail && <p className="text-xs mt-0.5 opacity-90">{a.detail}</p>}
                </div>
                <Button size="sm" variant="outline" className="rounded-lg sm:shrink-0 bg-white/70 w-full sm:w-auto" onClick={() => p.onNavigate(a.tab)}>{a.cta}<ArrowRight className="ml-1 h-3 w-3" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Application Status" value={currentApp?.status || "None"} sub={statusSub}
          subTone={currentApp?.status === "Approved" ? "positive" : currentApp?.status === "Rejected" ? "warning" : "neutral"}
          accent={currentApp?.status === "Approved"} onClick={() => p.onNavigate("application")} />
        <StatCard icon={Upload} label="Documents" value={`${p.docStatus.uploaded} / ${p.docStatus.required}`}
          sub={p.docStatus.rejected.length > 0 ? `${p.docStatus.rejected.length} need${p.docStatus.rejected.length === 1 ? "s" : ""} a new copy` : p.docStatus.uploaded === p.docStatus.required ? "All complete" : `${p.docStatus.required - p.docStatus.uploaded} remaining`}
          subTone={p.docStatus.rejected.length === 0 && p.docStatus.uploaded === p.docStatus.required ? "positive" : "warning"} onClick={() => p.onNavigate("documents")} />
        <StatCard icon={Banknote} label="Payments" value={peso(disbursedTotal)}
          sub={nextPayment ? `Next: ${peso(nextPayment.amount)}${nextPayment.scheduled_date ? ` on ${short(nextPayment.scheduled_date)}` : ""}` : p.approvedTotal > 0 ? `of ${peso(p.approvedTotal)} approved` : "No payments yet"}
          onClick={() => p.onNavigate("disbursement")} />
        <StatCard icon={Bell} label="Notifications" value={unread} sub={unread === 0 ? "All caught up" : `${unread} unread`} subTone={unread === 0 ? "positive" : "warning"} onClick={() => p.onNavigate("notifications")} />
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Panel className="p-5">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
              <ProfileImage value={profile?.profile_picture_url} alt="Profile" className="h-16 w-16 rounded-2xl object-cover shrink-0"
                fallback={<div className="h-16 w-16 rounded-2xl bg-accent flex items-center justify-center shrink-0"><User className="h-7 w-7 text-accent-foreground" /></div>} />
              <div className="flex-1 text-center sm:text-left min-w-0">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-lg font-display font-bold text-foreground">{p.displayName || "Student"}</h2>
                  {p.locked && (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${p.isDisbursed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-accent text-accent-foreground border-primary/20"}`}>
                      <Lock className="h-3 w-3" />{p.isDisbursed ? "Disbursed" : "Approved — Locked"}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{profile?.course || "—"}{profile?.year_level ? ` · ${profile.year_level}` : ""}</p>
                <p className="text-sm text-muted-foreground">{profile?.school_name || "—"}</p>
              </div>
              <button onClick={() => p.onNavigate("profile")} className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:text-primary/80 transition-colors shrink-0 cursor-pointer">
                Edit Profile <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle>{currentApp ? `${currentApp.scholarships?.name ?? "Your application"}` : "Application Progress"}</SectionTitle>
              {currentApp && <div className="-mt-3"><StatusBadge status={currentApp.status} /></div>}
            </div>
            {currentApp ? (
              <ApplicationTimeline app={currentApp} payments={payments} />
            ) : (
              <div className="text-center py-6">
                <GraduationCap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">{applyBlocked ?? `You haven't applied for ${p.currentYear} yet.`}</p>
                {!applyBlocked && <Button className="bg-primary hover:bg-primary text-white rounded-xl" onClick={() => p.onNavigate("application")}>Apply for a scholarship</Button>}
              </div>
            )}
          </Panel>

          {applications.length > 0 && (
            <Panel>
              <div className="px-5 py-4 border-b border-border"><SectionTitle>My Applications</SectionTitle></div>
              <ul className="divide-y divide-border">
                {applications.map((a) => (
                  <li key={a.id} className="px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {a.scholarships?.name ?? "Scholarship"}
                        {a.is_renewal && <span className="ml-2 rounded-full border border-primary/20 bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">Renewal</span>}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[a.academic_year, a.semester].filter(Boolean).join(" · ") || new Date(a.created_at).getFullYear()} · Submitted {new Date(a.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                        {a.status === "Approved" && a.amount_approved != null ? ` · Award ${peso(a.amount_approved)}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <SectionTitle>Available Scholarships</SectionTitle>
              {scholarships.length > 3 && (
                <button onClick={() => setShowAllPrograms((v) => !v)} className="text-xs text-primary font-semibold hover:text-primary/80 cursor-pointer -mt-3">
                  {showAllPrograms ? "Show fewer" : `Browse all ${scholarships.length}`}
                </button>
              )}
            </div>
            <div className="divide-y divide-border">
              {scholarships.length === 0 && (
                <div className="text-center py-10">
                  <GraduationCap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No active scholarships right now.</p>
                </div>
              )}
              {shownPrograms.map((s) => {
                const av = availabilityInfo(s);
                return (
                  <div key={s.id} className="p-5 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                        <p className="text-sm font-semibold text-foreground break-words">{s.name}</p>
                        {s.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>}
                      </div>
                      <button onClick={() => setProgram(s)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-primary/30 text-primary text-xs font-semibold px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer">
                        Details <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                      {s.deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {short(s.deadline)} ({deadlineLabel(s.deadline)})</span>}
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {slotsLabel(s)}</span>
                      {Number(s.amount) > 0 && <span>{peso(s.amount)} per scholar</span>}
                      {!av.canApply && <span className="font-semibold text-destructive">{av.label}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Notifications */}
        <div className="space-y-5">
          <Panel>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
              <SectionTitle>Recent Notifications</SectionTitle>
              <div className="flex items-center gap-3 -mt-3">
                {unread > 0 && <button onClick={p.onMarkAllRead} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">Mark all read</button>}
                <button onClick={() => p.onNavigate("notifications")} className="text-xs text-primary font-semibold hover:text-primary/80 cursor-pointer">View all</button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {p.notifications.length === 0 && (
                <div className="text-center py-10 px-4">
                  <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No notifications yet.</p>
                </div>
              )}
              {p.notifications.slice(0, 5).map((n) => (
                <button key={n.id} type="button" onClick={() => p.onOpenNotification(n)}
                  className={`w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-muted/50 transition-colors cursor-pointer ${!n.read ? "bg-accent/50" : ""}`}>
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${n.type === "success" ? "bg-emerald-100" : n.type === "warning" ? "bg-amber-100" : n.type === "error" ? "bg-red-100" : "bg-accent"}`}>
                    {n.type === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : <Bell className={`h-4 w-4 ${n.type === "success" ? "text-emerald-600" : n.type === "warning" ? "text-amber-600" : "text-accent-foreground"}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground break-words">{n.title}</p>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{n.message}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">{new Date(n.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>
                  </div>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Program details */}
      <Dialog open={!!program} onOpenChange={(o) => { if (!o) setProgram(null); }}>
        <DialogContent className="rounded-2xl max-h-[90vh] overflow-y-auto">
          {program && (
            <>
              <DialogHeader><DialogTitle className="font-display">{program.name}</DialogTitle></DialogHeader>
              {program.description && <p className="text-sm text-muted-foreground leading-relaxed">{program.description}</p>}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground mb-0.5">Award</p><p className="font-semibold">{Number(program.amount) > 0 ? `${peso(program.amount)} per scholar` : "To be announced"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">Slots</p><p className="font-semibold">{slotsLabel(program)}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">Opens</p><p className="font-semibold">{program.open_date ? short(program.open_date) : "Now"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">Deadline</p><p className="font-semibold">{program.deadline ? short(program.deadline) : "No closing date"}</p></div>
              </div>
              {(programGrade.length > 0 || program.eligibility) && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Eligibility</p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
                    {programGrade.map((l) => <li key={l}>{l}</li>)}
                    {program.eligibility && <li>{program.eligibility}</li>}
                  </ul>
                </div>
              )}
              {programBlock && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{programBlock}</p>}
              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setProgram(null)}>Close</Button>
                <Button className="bg-primary hover:bg-primary text-white rounded-xl" disabled={!!programBlock} onClick={() => { const id = program.id; setProgram(null); p.onApply(id); }}>
                  Apply for this program
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
