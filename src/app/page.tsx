"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import ScholarshipCard from "@/components/ScholarshipCard";
import { applyHref, peso, type PublicScholarship } from "@/lib/scholarships";
import { formatDate } from "@/lib/format";
import { applicationsBlockedReason } from "@/lib/settings";
import FloatingActions from "@/components/FloatingActions";
import ContactForm from "@/components/ContactForm";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useSignedIn } from "@/hooks/use-signed-in";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  GraduationCap, ArrowRight, Zap, BarChart3, Wallet, Bell,
  UserPlus, FileText, Search, CheckCircle2, Mail, Phone, MapPin, ChevronDown, Clock,
  CalendarDays, Users, Banknote, Layers, ClipboardCheck, ShieldCheck,
} from "lucide-react";

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
  const color = light ? "bg-orange-400/50 text-orange-300" : "bg-primary/35 text-primary";
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

// ─── Data ─────────────────────────────────────────────────────────────────────


const features = [
  { icon: Zap,      title: "Easy Application",     desc: "Apply in minutes with guided step-by-step forms — no confusion, no paperwork hassle." },
  { icon: BarChart3, title: "Real-Time Tracking",   desc: "Monitor every stage of your application and payment status from your personal dashboard." },
  { icon: Wallet,   title: "Secure Disbursement",   desc: "Funds are released transparently with full audit trails and real-time notifications." },
  { icon: Bell,     title: "Instant Notifications", desc: "Stay informed at every milestone with timely in-app and email alerts." },
];

const steps = [
  { icon: UserPlus,     title: "Register",     desc: "Create your account in under 2 minutes." },
  { icon: FileText,     title: "Apply",        desc: "Fill guided forms and upload documents." },
  { icon: Search,       title: "Review",       desc: "Admins verify your submission." },
  { icon: CheckCircle2, title: "Get Approved", desc: "Receive your official approval." },
  { icon: Wallet,       title: "Receive Funds", desc: "Funds released transparently." },
];


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const signedIn = useSignedIn();
  const { settings } = useSystemSettings();
  const [scholarships, setScholarships] = useState<PublicScholarship[]>([]);
  const [scholarshipsLoading, setScholarshipsLoading] = useState(true);
  const [stats, setStats] = useState<{ scholars: number; active_programs: number; total_disbursed: number } | null>(null);

  useEffect(() => {
    createClient()
      .rpc("public_stats")
      .then(({ data }) => { if (data?.[0]) setStats(data[0]); });
  }, []);

  useEffect(() => {
    const fetchScholarships = () =>
      fetch("/api/scholarships")
        .then((r) => r.json())
        .then((data) => setScholarships(Array.isArray(data) ? data : []))
        .catch(() => {});

    fetchScholarships().finally(() => setScholarshipsLoading(false));

    // Live updates: reflect admin create/edit/delete/toggle-active instantly.
    const supabase = createClient();
    const channel = supabase
      .channel("landing-scholarships")
      .on("postgres_changes", { event: "*", schema: "public", table: "scholarships" }, () => {
        fetchScholarships();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const featuredScholarships = [...scholarships]
    .sort((a, b) => {
      const rank = (x: PublicScholarship) => (x.availability === "open" ? 0 : x.availability === "upcoming" ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    })
    .slice(0, 4);

  const contactItems = [
    { icon: Mail,   label: "Email",  value: settings.contact_email },
    { icon: Phone,  label: "Phone",  value: settings.contact_phone },
    { icon: MapPin, label: "Office", value: settings.contact_address },
    { icon: Clock,  label: "Office Hours", value: settings.office_hours },
  ].filter((c) => c.value);

  // Key dates: the application window plus the soonest program deadlines, all from live data.
  const blocked = applicationsBlockedReason(settings);
  const upcomingDeadlines = scholarships
    .filter((x) => x.deadline && x.availability !== "closed")
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
    .slice(0, 3);
  const windowText = blocked
    ?? (settings.application_close_date
      ? `Applications are open until ${formatDate(settings.application_close_date)}.`
      : "Applications are open.");

  const statItems = stats && (stats.scholars > 0 || stats.total_disbursed > 0)
    ? [
        { icon: Users,    value: stats.scholars.toLocaleString(), label: "Scholars supported" },
        { icon: Layers,   value: stats.active_programs.toLocaleString(), label: "Active programs" },
        { icon: Banknote, value: peso(stats.total_disbursed), label: "Disbursed to students" },
      ]
    : [];

  const docs = settings.required_documents;
  const faqs: { q: string; a: string }[] = [
    {
      q: "Who can apply?",
      a: `Students of San Jose, Occidental Mindoro who meet a general average of at least ${settings.min_grade_requirement}. Each program may add its own conditions, such as year level or residency, which are listed on its card above.`,
    },
    {
      q: "What documents do I need?",
      a: docs.length ? `Prepare: ${docs.join(", ")}. Upload them in your dashboard when you apply.` : "The required documents are listed in your dashboard when you apply.",
    },
    {
      q: "When can I apply?",
      a: `${windowText} Individual programs also show their own opening dates and deadlines.`,
    },
    {
      q: "How many scholarships can I apply for?",
      a: `Up to ${settings.max_scholarships_per_student} ${settings.max_scholarships_per_student === 1 ? "application" : "applications"} per academic year.`,
    },
    {
      q: "How do I track my application?",
      a: "Sign in and open your dashboard. Every stage of your application, and your payout status, is shown there, and you are notified in the portal and by email when something changes.",
    },
    {
      q: "How are funds released?",
      a: `Payouts are made by ${settings.payment_methods.join(" or ").toLowerCase()}.${settings.payment_pickup_location ? ` Claim at: ${settings.payment_pickup_location}.` : ""} ${settings.payment_pickup_instructions}`.trim(),
    },
    ...(settings.renewal_enabled
      ? [{
          q: "Can I renew my scholarship?",
          a: `Yes. Scholars who keep a general average of at least ${settings.renewal_min_grade} can renew, up to ${settings.max_renewals} ${settings.max_renewals === 1 ? "time" : "times"}.`,
        }]
      : []),
    {
      q: "Who do I contact for help?",
      a: `Email ${settings.contact_email}${settings.contact_phone ? ` or call ${settings.contact_phone}` : ""}${settings.office_hours ? ` (${settings.office_hours})` : ""}, or use the contact form below.`,
    },
  ];

  return (
    <Layout>

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
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white backdrop-blur-md">
              <GraduationCap className="h-4 w-4 text-orange-400" />
              Sangguniang Bayan ng San Jose
            </div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-[1.05] tracking-tight drop-shadow-xl text-balance">
              LGU Scholarship<br />
              <span className="text-orange-400">Program</span>
            </h1>
            <p className="text-lg md:text-xl text-white/80 max-w-xl leading-relaxed">
              Apply, track, and receive scholarships with full transparency — built for the students of San Jose, Occidental Mindoro.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Button
                size="lg"
                onClick={() => router.push("/register")}
                className="h-12 px-7 text-base bg-primary hover:bg-primary/90 text-white font-semibold shadow-primary cursor-pointer"
              >
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => router.push("/login")}
                className="h-12 px-7 text-base border-white/30 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm cursor-pointer"
              >
                Sign In
              </Button>
            </div>
          </div>
        </div>

        {/* Fade to next section */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent" />

        {/* Scroll hint */}
        <div
          className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2 animate-scroll-bounce"
        >
          <a
            href="#platform"
            aria-label="Scroll to learn more"
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
                  <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", blocked ? "bg-muted text-muted-foreground" : "bg-orange-100 text-orange-600")}>
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{blocked ? "Applications" : "Application period"}</p>
                    <p className="text-sm text-muted-foreground">{windowText}</p>
                  </div>
                </div>
                {upcomingDeadlines.length > 0 && (
                  <ul className="md:w-1/2 space-y-1.5 md:border-l md:pl-6 text-sm">
                    {upcomingDeadlines.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-foreground">{d.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {d.availability === "upcoming" ? `Opens ${formatDate(d.open_date ?? d.deadline!)}` : `Due ${formatDate(d.deadline!)}`}
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

      {/* ── Features ──────────────────────────────────── */}
      <section id="platform" className="py-20 lg:py-28 bg-background">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Our Platform</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
              Everything You Need,{" "}
              <span className="text-gradient-primary">In One Place</span>
            </h2>
            <p className="text-muted-foreground">
              Built to make scholarship management seamless for students and administrators alike.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <Reveal key={i} delay={i * 80}>
                <Card className="card-glow border-border/60 h-full group cursor-default">
                  <CardContent className="p-7 space-y-4">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-100 to-orange-50 text-orange-600 transition-all duration-300 group-hover:from-primary group-hover:to-orange-400 group-hover:text-white">
                      <f.icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-display font-bold text-foreground">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Scholarships ──────────────────────────────── */}
      <section id="scholarships" className="py-20 lg:py-28 bg-orange-100/40">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Scholarships</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
              Available <span className="text-gradient-primary">Programs</span>
            </h2>
            <p className="text-muted-foreground">
              Browse and apply for scholarships that match your qualifications and goals.
            </p>
          </Reveal>

          {scholarshipsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {[1, 2].map((i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-48 rounded-xl" />
                </div>
              ))}
            </div>
          ) : featuredScholarships.length === 0 ? (
            <Reveal className="text-center py-12 text-muted-foreground max-w-md mx-auto">
              <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-display font-semibold text-foreground">No scholarships available right now</p>
              <p className="text-sm mt-1">Check back soon — new programs will be posted here.</p>
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
              View All Scholarships <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Reveal>
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────── */}
      <section className="py-20 lg:py-28 bg-background">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-16">
            <SectionLabel>Process</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
              From Application to{" "}
              <span className="text-gradient-primary">Disbursement</span>
            </h2>
            <p className="text-muted-foreground">Five simple steps — fully transparent, start to finish.</p>
          </Reveal>

          <div className="relative grid grid-cols-2 md:grid-cols-5 gap-6">
            {/* Connector line */}
            <div className="absolute top-7 left-[10%] right-[10%] hidden md:block pointer-events-none" aria-hidden>
              <div className="h-px bg-gradient-to-r from-transparent via-orange-300 to-transparent" />
            </div>

            {steps.map((s, i) => (
              <Reveal key={i} delay={i * 90} className="relative text-center">
                <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-white shadow-primary z-10 transition-transform duration-300 hover:scale-110 cursor-default">
                  <s.icon className="h-6 w-6" />
                </div>
                <div className="text-xs font-bold text-primary mb-1 tracking-[0.2em]">STEP {i + 1}</div>
                <h3 className="text-base font-display font-bold text-foreground mb-1">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Requirements ──────────────────────────────── */}
      <section id="requirements" className="py-20 lg:py-28 bg-orange-100/40">
        <div className="container max-w-5xl">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Requirements</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
              Before You <span className="text-gradient-primary">Apply</span>
            </h2>
            <p className="text-muted-foreground">
              What you need, and what makes you eligible. Individual programs may add their own conditions.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal direction="left">
              <Card className="h-full border-border/60">
                <CardContent className="p-7 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><ShieldCheck className="h-5 w-5" /></div>
                    <h3 className="text-lg font-display font-bold text-foreground">Eligibility</h3>
                  </div>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    <li className="flex gap-2.5"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />General average of at least {settings.min_grade_requirement}</li>
                    <li className="flex gap-2.5"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />Up to {settings.max_scholarships_per_student} {settings.max_scholarships_per_student === 1 ? "application" : "applications"} per academic year</li>
                    {settings.renewal_enabled && (
                      <li className="flex gap-2.5"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />Renewable while you keep an average of {settings.renewal_min_grade}+ (up to {settings.max_renewals} {settings.max_renewals === 1 ? "time" : "times"})</li>
                    )}
                    <li className="flex gap-2.5"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />Year level, residency and other conditions are shown on each program card</li>
                  </ul>
                </CardContent>
              </Card>
            </Reveal>

            <Reveal direction="right">
              <Card className="h-full border-border/60">
                <CardContent className="p-7 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><ClipboardCheck className="h-5 w-5" /></div>
                    <h3 className="text-lg font-display font-bold text-foreground">Documents to prepare</h3>
                  </div>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {docs.map((d) => (
                      <li key={d} className="flex gap-2.5"><FileText className="h-4 w-4 mt-0.5 shrink-0 text-primary" />{d}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">Upload clear photos or scans. Files up to {settings.max_upload_mb} MB each.</p>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────── */}
      <section id="faq" className="py-20 lg:py-28 bg-background">
        <div className="container max-w-3xl">
          <Reveal className="text-center max-w-xl mx-auto mb-12">
            <SectionLabel>FAQ</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
              Frequently Asked <span className="text-gradient-primary">Questions</span>
            </h2>
          </Reveal>
          <Reveal>
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((f, i) => (
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
      <section className="pb-16 bg-background">
        <div className="container max-w-3xl">
          <Reveal>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 rounded-2xl border border-border/60 bg-card px-6 py-5 text-center sm:text-left">
              <Image src="/municipal-logo.png" alt="Municipality of San Jose seal" width={56} height={56} className="h-14 w-14" />
              <div>
                <p className="text-xs font-bold tracking-[0.2em] uppercase text-primary">Offered by</p>
                <p className="font-display font-bold text-foreground">Sangguniang Bayan ng San Jose</p>
                <p className="text-sm text-muted-foreground">Local Government Unit of San Jose, Occidental Mindoro</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Contact ───────────────────────────────────── */}
      <section id="contact" className="py-20 lg:py-28 bg-background">
        <div className="container max-w-5xl">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Contact Us</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3 text-balance">
              We&apos;d Love to{" "}
              <span className="text-gradient-primary">Hear from You</span>
            </h2>
            <p className="text-muted-foreground">
              Have questions? Reach out and we&apos;ll get back to you within 1-2 business days.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
            <Reveal direction="left" className="space-y-3">
              {contactItems.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-4 p-4 rounded-xl hover:bg-orange-50/60 transition-colors duration-200"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                    <c.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{c.label}</p>
                    <p className="text-sm text-muted-foreground">{c.value}</p>
                  </div>
                </div>
              ))}
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

      <LandingFooter />
      <FloatingActions />
    </Layout>
  );
}
