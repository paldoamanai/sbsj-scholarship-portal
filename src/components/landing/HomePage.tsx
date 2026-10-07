"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import ScholarshipCard from "@/components/ScholarshipCard";
import { applyHref, type PublicScholarship } from "@/lib/scholarships";
import { formatDate } from "@/lib/format";
import { applicationsBlock, type AppSettings } from "@/lib/settings";
import { landingCopy, LANDING_LANGS, type LandingLang } from "@/lib/landing-copy";
import FloatingActions from "@/components/FloatingActions";
import ContactForm from "@/components/ContactForm";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useAccountLink } from "@/hooks/use-signed-in";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  GraduationCap, ArrowRight, Zap, BarChart3, Wallet, Bell,
  UserPlus, FileText, Search, CheckCircle2, Mail, Phone, MapPin, ChevronDown, Clock,
  CalendarDays, Users, Layers, ClipboardCheck, ShieldCheck, Megaphone, AlertCircle, RefreshCw,
  LayoutDashboard, Languages, ExternalLink,
} from "lucide-react";

export type PublicStats = { scholars: number; active_programs: number; applications_received: number };
export type PublicAnnouncement = { id: string; title: string; message: string; created_at: string };
export type ScholarsByYear = { academic_year: string; scholars: number };

export type HomePageData = {
  settings: AppSettings;
  /** null when the server couldn't load them; the page then tries again in the browser. */
  scholarships: PublicScholarship[] | null;
  stats: PublicStats | null;
  announcements: PublicAnnouncement[];
  scholarsByYear: ScholarsByYear[];
};

// ─── Scroll-reveal hook ───────────────────────────────────────────────────────

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.unobserve(el); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

// ─── Reveal component (scroll-triggered fade + translate) ─────────────────────

function Reveal({
  children, delay = 0, className, direction = "up",
}: {
  children: ReactNode; delay?: number; className?: string; direction?: "up" | "left" | "right";
}) {
  const { ref, inView } = useInView();
  const hidden =
    direction === "left" ? "-translate-x-6 opacity-0"
    : direction === "right" ? "translate-x-6 opacity-0"
    : "translate-y-8 opacity-0";
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:transform-none motion-reduce:opacity-100",
        inView ? "translate-x-0 translate-y-0 opacity-100" : hidden,
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// ─── Section label (line — LABEL — line) ─────────────────────────────────────

function SectionLabel({ children, light = false }: { children: string; light?: boolean }) {
  return (
    <div className="flex items-center gap-3 justify-center mb-5">
      <div className={cn("h-px w-10", light ? "bg-orange-400/30" : "bg-primary/25")} />
      <span className={cn("text-[11px] font-bold tracking-[0.25em] uppercase", light ? "text-orange-400" : "text-primary")}>
        {children}
      </span>
      <div className={cn("h-px w-10", light ? "bg-orange-400/30" : "bg-primary/25")} />
    </div>
  );
}

/** Section heading with the second part in the brand gradient. */
function SectionHeading({ parts }: { parts: string[] }) {
  return (
    <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
      {parts[0]}{" "}<span className="text-gradient-primary">{parts[1]}</span>
    </h2>
  );
}

// ─── Language (remembered per browser) ────────────────────────────────────────

const LANG_KEY = "landing-lang";

function useLandingLang(): [LandingLang, (l: LandingLang) => void] {
  const [lang, setLang] = useState<LandingLang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "fil") setLang(saved);
    } catch { /* storage unavailable */ }
  }, []);
  const choose = useCallback((l: LandingLang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* storage unavailable */ }
  }, []);
  return [lang, choose];
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const featureIcons = [Zap, BarChart3, Wallet, Bell];
const stepIcons = [UserPlus, FileText, Search, CheckCircle2, Wallet];

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const mapsHref = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage({ initial }: { initial: HomePageData }) {
  const router = useRouter();
  const { signedIn, dashboardHref } = useAccountLink();
  const { settings: liveSettings, loaded: settingsLoaded } = useSystemSettings();
  const settings = settingsLoaded ? liveSettings : initial.settings;
  const [lang, setLang] = useLandingLang();

  const [scholarships, setScholarships] = useState<PublicScholarship[]>(initial.scholarships ?? []);
  const [scholarshipsLoading, setScholarshipsLoading] = useState(initial.scholarships === null);
  const [scholarshipsError, setScholarshipsError] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(initial.stats);

  useEffect(() => {
    if (initial.stats) return;
    createClient()
      .rpc("public_stats")
      .then(({ data }) => { if (data?.[0]) setStats(data[0]); });
  }, [initial.stats]);

  const fetchScholarships = useCallback(async () => {
    try {
      const r = await fetch("/api/scholarships");
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      setScholarships(Array.isArray(data) ? data : []);
      setScholarshipsError(false);
    } catch {
      // Keep whatever is already shown; only an empty list turns into the error message.
      setScholarshipsError(true);
    }
  }, []);

  const retry = () => {
    setScholarshipsLoading(true);
    fetchScholarships().finally(() => setScholarshipsLoading(false));
  };

  useEffect(() => {
    if (initial.scholarships === null) fetchScholarships().finally(() => setScholarshipsLoading(false));

    // Live updates: reflect admin create/edit/delete/toggle-active instantly.
    const supabase = createClient();
    const channel = supabase
      .channel("landing-scholarships")
      .on("postgres_changes", { event: "*", schema: "public", table: "scholarships" }, () => {
        fetchScholarships();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchScholarships, initial.scholarships]);

  const featuredScholarships = [...scholarships]
    .sort((a, b) => {
      const rank = (x: PublicScholarship) => (x.availability === "open" ? 0 : x.availability === "upcoming" ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    })
    .slice(0, 4);

  const openCount = scholarships.filter((x) => x.availability === "open").length;

  const block = applicationsBlock(settings);
  const t = landingCopy(lang, settings, block);

  const contactItems = [
    { icon: Mail,   label: t.contact.email,  value: settings.contact_email,   href: settings.contact_email ? `mailto:${settings.contact_email}` : undefined },
    { icon: Phone,  label: t.contact.phone,  value: settings.contact_phone,   href: settings.contact_phone ? telHref(settings.contact_phone) : undefined },
    { icon: MapPin, label: t.contact.office, value: settings.contact_address, href: settings.contact_address ? mapsHref(settings.contact_address) : undefined, external: true },
    { icon: Clock,  label: t.contact.hours,  value: settings.office_hours },
  ].filter((c) => c.value);

  // Key dates: the soonest program deadlines, from live data.
  const upcomingDeadlines = scholarships
    .filter((x) => x.deadline && x.availability !== "closed")
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
    .slice(0, 3);

  const statItems = stats && stats.applications_received > 0
    ? [
        { icon: ClipboardCheck, value: stats.applications_received.toLocaleString(), label: t.stats.applications },
        { icon: Users,    value: stats.scholars.toLocaleString(), label: t.stats.scholars },
        { icon: Layers,   value: stats.active_programs.toLocaleString(), label: t.stats.programs },
      ]
    : [];

  // Only worth a chart once there are at least two school years to compare.
  const history = initial.scholarsByYear.length >= 2 ? initial.scholarsByYear : [];
  const historyMax = Math.max(1, ...history.map((h) => h.scholars));

  const docs = settings.required_documents;

  return (
    <Layout>
      <div lang={lang === "fil" ? "fil" : "en"}>

      {/* ── Hero ──────────────────────────────────────── */}
      <section className="relative min-h-[100svh] flex items-center overflow-hidden pt-28 pb-16">
        <div className="absolute inset-0">
          <Image src="/hero-bg.jpg" alt="San Jose, Occidental Mindoro" fill className="object-cover" priority />
          <div className="absolute inset-0 bg-gradient-to-tr from-black/80 via-black/50 to-black/10" />
        </div>

        {/* Decorative ambient glow */}
        <div
          className="absolute right-1/3 top-1/3 h-72 w-72 rounded-full bg-primary/20 blur-3xl pointer-events-none animate-pulse-glow"
          aria-hidden
        />

        <div className="container relative z-10">
          <div className="max-w-3xl space-y-7 animate-fade-in-up">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white backdrop-blur-md">
                <GraduationCap className="h-4 w-4 text-orange-400" />
                Sangguniang Bayan ng San Jose
              </div>
              <div
                role="group"
                aria-label={t.languageLabel}
                className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/20 p-1 text-xs text-white backdrop-blur-md"
              >
                <Languages className="ml-1.5 h-3.5 w-3.5 text-white/70" aria-hidden />
                {LANDING_LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    lang={l.code}
                    aria-pressed={lang === l.code}
                    onClick={() => setLang(l.code)}
                    className={cn(
                      "rounded-full px-3 py-1 font-medium transition-colors cursor-pointer",
                      lang === l.code ? "bg-white text-foreground" : "text-white/80 hover:bg-white/15"
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white leading-[1.05] tracking-tight drop-shadow-xl text-balance">
              {t.hero.title[0]}<br />
              <span className="text-orange-400">{t.hero.title[1]}</span>
            </h1>
            <p className="text-lg md:text-xl text-white/80 max-w-xl leading-relaxed">
              {t.hero.subtitle}
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              {signedIn ? (
                <Button
                  size="lg"
                  onClick={() => router.push(dashboardHref)}
                  className="h-12 px-7 text-base bg-primary hover:bg-primary/90 text-white font-semibold shadow-primary cursor-pointer"
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />{t.hero.dashboard}
                </Button>
              ) : (
                <>
                  <Button
                    size="lg"
                    onClick={() => router.push("/register")}
                    className="h-12 px-7 text-base bg-primary hover:bg-primary/90 text-white font-semibold shadow-primary cursor-pointer"
                  >
                    {block ? t.hero.registerClosed : t.hero.register} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => router.push("/login")}
                    className="h-12 px-7 text-base border-white/30 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm cursor-pointer"
                  >
                    {t.hero.signIn}
                  </Button>
                </>
              )}
            </div>
            {block ? (
              <div className="flex max-w-xl items-start gap-2.5 rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 py-3 text-sm text-white backdrop-blur-md">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p>
                  <span className="font-semibold">{t.dates.period}</span>
                  {!signedIn && <span className="text-white/80"> {t.hero.closedNote}</span>}
                </p>
              </div>
            ) : openCount > 0 && (
              <a
                href="#scholarships"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-500/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-md hover:bg-emerald-500/25 transition-colors"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                {t.hero.openNow(openCount)}
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Fade to next section */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent" />

        {/* Scroll hint */}
        <div
          className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2 animate-scroll-bounce"
        >
          <a
            href="#scholarships"
            aria-label={t.hero.scroll}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
          >
            <ChevronDown className="h-5 w-5" />
          </a>
        </div>
      </section>

      {/* ── Key dates ─────────────────────────────────── */}
      <section className="bg-background pb-4 -mt-10 relative z-10">
        <div className="container max-w-4xl">
          <Reveal>
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-5">
                <div className="flex items-start gap-3 md:w-1/2">
                  <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", block ? "bg-muted text-muted-foreground" : "bg-orange-100 text-orange-600")}>
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.dates.title}</p>
                    <p className="text-sm text-muted-foreground">{t.dates.period}</p>
                  </div>
                </div>
                {upcomingDeadlines.length > 0 && (
                  <ul className="md:w-1/2 space-y-1.5 md:border-l md:pl-6 text-sm">
                    {upcomingDeadlines.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-foreground">{d.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {d.availability === "upcoming" ? t.dates.opens(d.open_date ?? d.deadline!) : t.dates.due(d.deadline!)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </Reveal>

          {statItems.length > 0 && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {statItems.map((st, i) => (
                <Reveal key={st.label} delay={i * 80}>
                  <div className="rounded-2xl border border-border/60 bg-card p-5 text-center">
                    <st.icon className="h-5 w-5 mx-auto mb-2 text-primary" />
                    <p className="text-2xl font-display font-bold text-foreground">{st.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{st.label}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Announcements ─────────────────────────────── */}
      {initial.announcements.length > 0 && (
        <section id="news" className="pt-16 pb-16 bg-background scroll-mt-16">
          <div className="container max-w-4xl">
            <Reveal className="text-center max-w-xl mx-auto mb-8">
              <SectionLabel>{t.news.label}</SectionLabel>
              <SectionHeading parts={t.news.heading} />
            </Reveal>
            <div className="space-y-4">
              {initial.announcements.map((a, i) => (
                <Reveal key={a.id} delay={i * 80}>
                  <article className="flex gap-4 rounded-2xl border border-border/60 bg-card p-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                      <Megaphone className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <h3 className="font-display font-bold text-foreground">{a.title}</h3>
                        <time dateTime={a.created_at} className="text-xs text-muted-foreground">{formatDate(a.created_at)}</time>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{a.message}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Scholarships ──────────────────────────────── */}
      <section id="scholarships" className="py-20 lg:py-28 bg-orange-100/40 scroll-mt-16">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>{t.programs.label}</SectionLabel>
            <SectionHeading parts={t.programs.heading} />
            <p className="text-muted-foreground">{t.programs.desc(openCount)}</p>
          </Reveal>

          {scholarshipsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto" aria-busy>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : scholarshipsError && featuredScholarships.length === 0 ? (
            <div role="alert" className="text-center py-12 max-w-md mx-auto">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 text-destructive/60" />
              <p className="font-display font-semibold text-foreground">{t.programs.errorTitle}</p>
              <p className="text-sm text-muted-foreground mt-1">{t.programs.errorDesc}</p>
              <Button variant="outline" onClick={retry} className="mt-4 cursor-pointer">
                <RefreshCw className="mr-2 h-4 w-4" />{t.programs.retry}
              </Button>
            </div>
          ) : featuredScholarships.length === 0 ? (
            <Reveal className="text-center py-12 text-muted-foreground max-w-md mx-auto">
              <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-display font-semibold text-foreground">{t.programs.emptyTitle}</p>
              <p className="text-sm mt-1">{t.programs.emptyDesc}</p>
            </Reveal>
          ) : (
            <div className={cn("grid grid-cols-1 gap-6 mx-auto", featuredScholarships.length === 1 ? "max-w-md" : "md:grid-cols-2 max-w-4xl")}>
              {featuredScholarships.map((s, i) => (
                <Reveal key={s.id} delay={i * 80}>
                  <ScholarshipCard
                    program={s}
                    globalMinGrade={settings.min_grade_requirement}
                    onApply={() => router.push(applyHref(s.id, signedIn))}
                    hideAmount
                  />
                </Reveal>
              ))}
            </div>
          )}

          <Reveal className="mt-12 text-center">
            <Button
              size="lg"
              variant="outline"
              onClick={() => router.push("/scholarships")}
              className="h-12 px-8 border-primary text-primary hover:bg-orange-50 cursor-pointer"
            >
              {t.programs.viewAll} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Reveal>
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────── */}
      <section className="py-20 lg:py-28 bg-background">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-16">
            <SectionLabel>{t.process.label}</SectionLabel>
            <SectionHeading parts={t.process.heading} />
            <p className="text-muted-foreground">{t.process.desc}</p>
          </Reveal>

          <div className="relative grid grid-cols-2 md:grid-cols-5 gap-6">
            {/* Connector line */}
            <div className="absolute top-7 left-[10%] right-[10%] hidden md:block pointer-events-none" aria-hidden>
              <div className="h-px bg-gradient-to-r from-transparent via-orange-300 to-transparent" />
            </div>

            {t.process.steps.map((s, i) => {
              const Icon = stepIcons[i];
              return (
                <Reveal key={i} delay={i * 90} className="relative text-center">
                  <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-white shadow-primary z-10 transition-transform duration-300 hover:scale-110 cursor-default">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="text-xs font-bold text-primary mb-1 tracking-[0.2em]">{t.process.step} {i + 1}</div>
                  <h3 className="text-base font-display font-bold text-foreground mb-1">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Requirements ──────────────────────────────── */}
      <section id="requirements" className="py-20 lg:py-28 bg-orange-100/40">
        <div className="container max-w-5xl">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>{t.requirements.label}</SectionLabel>
            <SectionHeading parts={t.requirements.heading} />
            <p className="text-muted-foreground">{t.requirements.desc}</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal direction="left">
              <Card className="h-full border-border/60">
                <CardContent className="p-7 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><ShieldCheck className="h-5 w-5" /></div>
                    <h3 className="text-lg font-display font-bold text-foreground">{t.requirements.eligibility}</h3>
                  </div>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {t.requirements.eligibilityItems.map((item) => (
                      <li key={item} className="flex gap-2.5"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />{item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </Reveal>

            <Reveal direction="right">
              <Card className="h-full border-border/60">
                <CardContent className="p-7 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><ClipboardCheck className="h-5 w-5" /></div>
                    <h3 className="text-lg font-display font-bold text-foreground">{t.requirements.documents}</h3>
                  </div>
                  {docs.length > 0 ? (
                    <ul className="space-y-2.5 text-sm text-muted-foreground">
                      {docs.map((d) => (
                        <li key={d} className="flex gap-2.5"><FileText className="h-4 w-4 mt-0.5 shrink-0 text-primary" />{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t.requirements.noDocuments}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{t.requirements.uploadNote}</p>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Scholars through the years ────────────────── */}
      {history.length > 0 && (
        <section id="impact" className="py-20 lg:py-28 bg-background">
          <div className="container max-w-3xl">
            <Reveal className="text-center max-w-xl mx-auto mb-12">
              <SectionLabel>{t.history.label}</SectionLabel>
              <SectionHeading parts={t.history.heading} />
              <p className="text-muted-foreground">{t.history.desc}</p>
            </Reveal>
            <Reveal>
              <Card className="border-border/60">
                <CardContent className="p-6 md:p-7">
                  <ul className="space-y-4">
                    {history.map((h) => (
                      <li key={h.academic_year} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 sm:grid-cols-[6.5rem_1fr_6rem]">
                        <span className="text-sm font-semibold text-foreground tabular-nums">{h.academic_year}</span>
                        <div className="h-3 rounded-full bg-orange-100" aria-hidden>
                          <div
                            className="h-3 rounded-full bg-gradient-primary"
                            style={{ width: `${Math.max(4, (h.scholars / historyMax) * 100)}%` }}
                          />
                        </div>
                        <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm tabular-nums">
                          {t.history.scholars(h.scholars)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </section>
      )}

      {/* ── Features ──────────────────────────────────── */}
      <section id="platform" className={cn("py-20 lg:py-28", history.length > 0 ? "bg-orange-100/40" : "bg-background")}>
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>{t.features.label}</SectionLabel>
            <SectionHeading parts={t.features.heading} />
            <p className="text-muted-foreground">{t.features.desc}</p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {t.features.items.map((f, i) => {
              const Icon = featureIcons[i];
              return (
                <Reveal key={i} delay={i * 80}>
                  <Card className="card-glow border-border/60 h-full group cursor-default">
                    <CardContent className="p-7 space-y-4">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-100 to-orange-50 text-orange-600 transition-all duration-300 group-hover:from-primary group-hover:to-orange-400 group-hover:text-white">
                        <Icon className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-display font-bold text-foreground">{f.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────── */}
      <section id="faq" className={cn("py-20 lg:py-28", history.length > 0 ? "bg-background" : "bg-orange-100/40")}>
        <div className="container max-w-3xl">
          <Reveal className="text-center max-w-xl mx-auto mb-12">
            <SectionLabel>{t.faq.label}</SectionLabel>
            <SectionHeading parts={t.faq.heading} />
          </Reveal>
          <Reveal>
            <Accordion type="single" collapsible className="w-full">
              {t.faq.items.map((f, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left font-display font-semibold">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </section>

      {/* ── Offered by ────────────────────────────────── */}
      <section className="pt-16 pb-0 bg-background">
        <div className="container max-w-3xl">
          <Reveal>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 rounded-2xl border border-border/60 bg-card px-6 py-5 text-center sm:text-left">
              <Image src="/municipal-logo.png" alt="Municipality of San Jose seal" width={56} height={56} className="h-14 w-14" />
              <div>
                <p className="text-xs font-bold tracking-[0.2em] uppercase text-primary">{t.offeredBy.label}</p>
                <p className="font-display font-bold text-foreground">Sangguniang Bayan ng San Jose</p>
                <p className="text-sm text-muted-foreground">{t.offeredBy.sub}</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Contact ───────────────────────────────────── */}
      <section id="contact" className="py-20 lg:py-28 bg-background">
        <div className="container max-w-5xl">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>{t.contact.label}</SectionLabel>
            <SectionHeading parts={t.contact.heading} />
            <p className="text-muted-foreground">{t.contact.desc}</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
            <Reveal direction="left" className="space-y-3">
              {contactItems.map((c) => {
                const body = (
                  <>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                      <c.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{c.label}</p>
                      <p className="text-sm text-muted-foreground break-words">{c.value}</p>
                      {c.external && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary">
                          {t.contact.directions}<ExternalLink className="h-3 w-3" aria-hidden />
                        </p>
                      )}
                    </div>
                  </>
                );
                const className = "flex items-start gap-4 p-4 rounded-xl hover:bg-orange-50/60 transition-colors duration-200";
                return c.href ? (
                  <a
                    key={c.label}
                    href={c.href}
                    className={cn(className, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                    {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {body}
                  </a>
                ) : (
                  <div key={c.label} className={className}>{body}</div>
                );
              })}
            </Reveal>

            <Reveal direction="right">
              <Card className="border-border/60 shadow-md">
                <CardContent className="p-7">
                  <ContactForm />
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      </div>
      <LandingFooter />
      <FloatingActions />
    </Layout>
  );
}
