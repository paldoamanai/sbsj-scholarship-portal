"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Banknote, Bell, CalendarDays, CheckCircle, Eye, FileText,
  GraduationCap, Info, Lock, Upload, User, Users, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ProfileImage from "@/components/ProfileImage";
import { Panel, SectionTitle, StatCard, StatusBadge } from "@/components/student/ui";
import ApplicationHistory from "@/components/student/ApplicationHistory";
import { profileCompleteness } from "@/lib/profile";
import { availabilityInfo, deadlineLabel, programChecks, requirementLines, slotsLabel, type PublicScholarship } from "@/lib/scholarships";
import { daysUntil, formatDate, peso } from "@/lib/format";
import type { AppSettings } from "@/lib/settings";
import type { Tables } from "@/integrations/supabase/types";

type AppRow = Tables<"applications"> & { scholarships: { name: string } | null };

export type OverviewProps = {
  displayName: string;
  profile: Tables<"profiles"> | null;
  applications: AppRow[];
  /** The application in focus: the approved one, else the latest still in review. */
  currentApp: AppRow | undefined;
  /** This year's applications (withdrawn ones excluded). */
  yearApps: AppRow[];
  /** Whether the student may submit another application now (applications open, no maintenance). */
  canApplyMore: boolean;
  payments: Tables<"payments">[];
  issues: Tables<"payment_issues">[];
  gradeUpdates: Tables<"grade_updates">[];
  docStatus: { uploaded: number; required: number; missing: string[]; disapproved: { type: string; note: string | null }[] };
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
  onViewApplication: (id: string) => void;
  unreadCount: number;
  onOpenNotification: (n: Tables<"notifications">) => void;
  onMarkAllRead: () => void;
};

type Action = { id: string; tone: "red" | "amber" | "blue" | "green"; title: string; detail?: string; tab: string; cta: string };

const short = (d: string) => formatDate(d);

const toneCls: Record<Action["tone"], string> = {
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  blue: "border-primary/20 bg-accent text-foreground",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export default function Overview(p: OverviewProps) {
  const { profile, applications, currentApp, yearApps, canApplyMore, payments, settings, applyBlocked, scholarships } = p;
  const appliedTo = (programId: string) => yearApps.find((a) => a.scholarship_id === programId);
  const approvedApps = yearApps.filter((a) => a.status === "Approved");
  const [showAllPrograms, setShowAllPrograms] = useState(false);
  const [program, setProgram] = useState<PublicScholarship | null>(null);

  const firstName = p.displayName.split(" ")[0] || "Student";
  const unread = p.unreadCount;
  const completeness = useMemo(() => profileCompleteness(profile), [profile]);

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
    else if (canApplyMore) {
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
  }, [settings, applyBlocked, canApplyMore, scholarships]);

  // ── things that need the student ──
  const actions = useMemo(() => {
    const out: Action[] = [];
    const lastGrade = p.gradeUpdates[0];

    yearApps.filter((a) => a.changes_requested).forEach((a) =>
      out.push({ id: `changes-${a.id}`, tone: "red", title: `The office needs changes on ${a.scholarships?.name ?? "your application"}`,
        detail: a.changes_requested ?? undefined, tab: "application", cta: "Open" }));

    p.docStatus.disapproved.forEach((d) =>
      out.push({ id: `doc-${d.type}`, tone: "red", title: `Upload a new ${d.type}`, detail: d.note ? `The office said: ${d.note}` : "The office didn't accept your copy.", tab: "documents", cta: "Replace" }));

    live.filter((x) => x.status === "Disbursed" && (!x.student_receipt_at || x.receipt_review_status === "Disapproved")).forEach((x) =>
      out.push({ id: `rcpt-${x.id}`, tone: x.receipt_review_status === "Disapproved" ? "red" : "amber",
        title: x.receipt_review_status === "Disapproved" ? `Re-enter your receipt number for ${peso(x.amount)}` : `Enter your receipt number for ${peso(x.amount)}`,
        detail: x.receipt_review_status === "Disapproved" ? x.receipt_review_note ?? undefined : "Type the reference number printed on the receipt you signed.", tab: "disbursement", cta: "Open" }));

    if (lastGrade?.status === "Disapproved") {
      out.push({ id: "grade", tone: "red", title: "Your grade update was not accepted", detail: lastGrade.review_note ?? undefined, tab: "profile", cta: "Fix it" });
    }

    if (completeness.missing.length > 0) {
      out.push({ id: "profile", tone: "amber", title: `Complete your profile (${completeness.percent}%)`, detail: `Still needed: ${completeness.missing.map((m) => m.label).join(", ")}.`, tab: "profile", cta: "Complete" });
    }
    const disapprovedTypes = new Set(p.docStatus.disapproved.map((d) => d.type));
    const gone = p.docStatus.missing.filter((m) => !disapprovedTypes.has(m));
    if (gone.length > 0 && approvedApps.length === 0) {
      out.push({ id: "docs", tone: "amber", title: `Upload ${gone.length} required document${gone.length === 1 ? "" : "s"}`, detail: gone.join(", "), tab: "documents", cta: "Upload" });
    }
    if (profile?.average_grade != null && !profile.grade_verified_at && !p.gradeUpdates.some((g) => g.status === "Pending" || g.status === "Disapproved")) {
      out.push({ id: "verify-grade", tone: "blue", title: "Get your grade verified", detail: "Submit your grade report in your profile. Programs and renewals check it.", tab: "profile", cta: "Verify" });
    }

    p.issues.filter((i) => i.status === "Open").forEach((i) =>
      out.push({ id: `issue-${i.id}`, tone: "blue", title: "Waiting for the office to reply to your payment report", tab: "disbursement", cta: "View" }));

    const order = { red: 0, amber: 1, blue: 2, green: 3 } as const;
    return out.sort((a, b) => order[a.tone] - order[b.tone]);
  }, [p.docStatus, p.gradeUpdates, p.issues, live, completeness, approvedApps.length, profile, yearApps]);

  // ── programs ──
  // Open programs first, so students see what they can apply for right now.
  const sortedPrograms = [...scholarships].sort((a, b) => Number(availabilityInfo(b).canApply) - Number(availabilityInfo(a).canApply));
  const shownPrograms = showAllPrograms ? sortedPrograms : sortedPrograms.slice(0, 3);
  const openCount = scholarships.filter((s) => availabilityInfo(s).canApply).length;
  const toApplyCount = scholarships.filter((s) => availabilityInfo(s).canApply && !appliedTo(s.id)).length;
  // While the student can still apply somewhere, the program list moves to the top of the dashboard.
  const promotePrograms = canApplyMore && toApplyCount > 0;
  // A renewal means this program approved the student in an earlier year.
  const programRenewal = !!program && applications.some((a) => a.status === "Approved" && a.scholarship_id === program.id && new Date(a.created_at).getUTCFullYear() < p.currentYear);
  const programGrade = program
    ? requirementLines(program, programRenewal ? settings.renewal_min_grade : settings.min_grade_requirement)
    : [];
  const programFailed = program
    ? programChecks(program, profile, {
        globalMinGrade: settings.min_grade_requirement, renewalMinGrade: settings.renewal_min_grade,
        renewalEnabled: settings.renewal_enabled, isRenewal: programRenewal,
      }).find((c) => !c.ok)
    : undefined;
  const programBlock = !program ? null
    : appliedTo(program.id) ? `You already applied to this program (${appliedTo(program.id)?.status.toLowerCase()}).`
    : applyBlocked ? applyBlocked
    : !availabilityInfo(program).canApply ? availabilityInfo(program).label
    : programFailed ? `Requirement not met: ${programFailed.label} (${programFailed.detail}). Update your profile first.`
    : null;

  const programsPanel = (
    <Panel className={promotePrograms ? "border-primary/40 ring-2 ring-primary/15" : ""}>
      <div className={`px-5 py-4 border-b border-border flex items-center justify-between gap-2 ${promotePrograms ? "bg-accent/60 rounded-t-2xl" : ""}`}>
        <div className="flex items-center gap-2">
          <SectionTitle>Available Scholarships</SectionTitle>
          {openCount > 0 && (
            <span className="-mt-3 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
              {openCount} open
            </span>
          )}
        </div>
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
            <div key={s.id} className={`p-5 hover:bg-muted/40 transition-colors ${av.canApply ? "border-l-4 border-l-primary" : "bg-muted/30"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground break-words">{s.name}</p>
                    {av.canApply && (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">Open</span>
                    )}
                  </div>
                  {s.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setProgram(s)}
                    className="inline-flex items-center gap-1 rounded-lg border border-primary/30 text-primary text-xs font-semibold px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer">
                    Details <ArrowRight className="h-3 w-3" />
                  </button>
                  {appliedTo(s.id) ? (
                    <button onClick={() => p.onViewApplication(appliedTo(s.id)!.id)} className="cursor-pointer" title="View your application">
                      <StatusBadge status={appliedTo(s.id)!.status} />
                    </button>
                  ) : av.canApply && canApplyMore && (
                    <button onClick={() => p.onApply(s.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary/90 transition-colors cursor-pointer">
                      Apply
                    </button>
                  )}
                </div>
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
  );

  const statusSub = !currentApp ? `No application for ${p.currentYear}`
    : approvedApps.length > 0 ? `${approvedApps.length} approved of ${yearApps.length} for ${p.currentYear}`
    : yearApps.length > 1 ? `${yearApps.length} applications for ${p.currentYear}`
    : currentApp.status === "Disapproved" ? "See the reason in your history"
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
            <p className="text-sm text-white mt-1">Welcome back, {firstName}! {actions.some((a) => a.tone !== "green" && a.tone !== "blue") ? "There are a few things that need your attention." : "Here's where things stand."}</p>
          </div>
          <div className="flex items-center gap-3 sm:shrink-0">
            <button onClick={() => p.onNavigate("application")}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-white text-primary text-sm font-semibold px-4 py-3 sm:py-2.5 hover:bg-white/90 transition-colors cursor-pointer shadow-sm">
              {promotePrograms || !currentApp ? <FileText className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {promotePrograms ? "Apply for Scholarship" : currentApp ? "View Applications" : applyBlocked ? "Applications unavailable" : "Apply for Scholarship"}
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

      {/* Action needed */}
      <Panel className="p-5">
        <SectionTitle>Action needed</SectionTitle>
        {actions.length === 0 ? (
          <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${toneCls.green}`}>
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>
              {currentApp && !promotePrograms ? "You're all set. Nothing needs your attention right now."
                : applyBlocked ? "You're all set. Applications aren't open right now."
                : "Your profile and documents are ready. Use the button above to apply for a scholarship."}
            </span>
          </div>
        ) : (
          <ul className="space-y-2">
            {actions.map((a) => (
              <li key={a.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl border px-4 py-3 ${toneCls[a.tone]}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{a.title}</p>
                  {a.detail && <p className="text-xs mt-0.5">{a.detail}</p>}
                </div>
                <Button size="sm" variant="outline" className="rounded-lg sm:shrink-0 bg-white/70 w-full sm:w-auto" onClick={() => p.onNavigate(a.tab)}>{a.cta}<ArrowRight className="ml-1 h-3 w-3" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {promotePrograms && programsPanel}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Application Status" value={approvedApps.length > 0 ? "Approved" : currentApp?.status || "None"} sub={statusSub}
          subTone={currentApp?.status === "Approved" ? "positive" : currentApp?.status === "Disapproved" ? "warning" : "neutral"}
          accent={currentApp?.status === "Approved"} onClick={() => p.onNavigate("application")} />
        <StatCard icon={Upload} label="Documents" value={`${p.docStatus.uploaded} / ${p.docStatus.required}`}
          sub={p.docStatus.disapproved.length > 0 ? `${p.docStatus.disapproved.length} need${p.docStatus.disapproved.length === 1 ? "s" : ""} a new copy` : p.docStatus.uploaded === p.docStatus.required ? "All complete" : `${p.docStatus.required - p.docStatus.uploaded} remaining`}
          subTone={p.docStatus.disapproved.length === 0 && p.docStatus.uploaded === p.docStatus.required ? "positive" : "warning"} onClick={() => p.onNavigate("documents")} />
        <StatCard icon={Banknote} label="Payouts" value={peso(disbursedTotal)}
          sub={nextPayment ? `Next: ${peso(nextPayment.amount)}${nextPayment.scheduled_date ? ` on ${short(nextPayment.scheduled_date)}` : ""}` : p.approvedTotal > 0 ? `of ${peso(p.approvedTotal)} approved` : "No payments yet"}
          onClick={() => p.onNavigate("disbursement")} />
        <StatCard icon={GraduationCap} label="Average Grade" value={profile?.average_grade ?? "—"}
          sub={profile?.average_grade == null ? "Not set yet" : profile.grade_verified_at ? `Verified${profile.grade_term ? ` · ${profile.grade_term}` : ""}` : "Self-declared · not verified"}
          subTone={profile?.grade_verified_at ? "positive" : "warning"} onClick={() => p.onNavigate("profile")} />
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
            </div>
          </Panel>

          {/* Application history */}
          <Panel>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
              <SectionTitle>My Applications</SectionTitle>
              {applications.length > 5 && (
                <button onClick={() => p.onNavigate("application")} className="text-xs text-primary font-semibold hover:text-primary/80 cursor-pointer -mt-3">
                  View all {applications.length}
                </button>
              )}
            </div>
            <ApplicationHistory applications={applications} onView={p.onViewApplication} onContact={() => p.onNavigate("help")} limit={5} />
          </Panel>

          {!promotePrograms && programsPanel}
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
                    {n.type === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : <Bell className={`h-4 w-4 ${n.type === "success" ? "text-emerald-700" : n.type === "warning" ? "text-amber-700" : "text-accent-foreground"}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground break-words">{n.title}</p>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{n.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>
                  </div>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Program details */}
      <Dialog open={!!program} onOpenChange={(o) => { if (!o) setProgram(null); }}>
        <DialogContent className="rounded-2xl">
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
