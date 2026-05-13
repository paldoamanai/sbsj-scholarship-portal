"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import ScholarshipCard from "@/components/ScholarshipCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  GraduationCap, ArrowRight, Zap, BarChart3, Wallet, Bell,
  UserPlus, FileText, Search, CheckCircle2, Send, Mail, Phone, MapPin, ChevronDown,
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
        "transition-all duration-700 ease-out",
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

const scholarships = [
  { name: "Academic Excellence Scholarship", description: "Full scholarship for students maintaining outstanding academic performance throughout their college education.", eligibility: "Must maintain a GPA of 90+ and be a resident of San Jose, Occidental Mindoro", deadline: "June 30, 2026" },
  { name: "Financial Assistance Grant", description: "Financial support for underprivileged but deserving students pursuing higher education.", eligibility: "Household income below ₱150,000/year, minimum 85 average grade", deadline: "July 15, 2026" },
  { name: "STEM Leadership Scholarship", description: "Scholarship for students enrolled in Science, Technology, Engineering, and Mathematics programs.", eligibility: "Enrolled in STEM course, minimum 88 average grade", deadline: "August 1, 2026" },
  { name: "Community Service Award", description: "Recognition and support for students who demonstrate exceptional community involvement.", eligibility: "100+ hours community service, minimum 85 average grade", deadline: "July 31, 2026" },
];

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

const contactItems = [
  { icon: Mail,  label: "Email",  value: "scholarship@sbom.gov.ph" },
  { icon: Phone, label: "Phone",  value: "(043) 123-4567" },
  { icon: MapPin, label: "Office", value: "Sangguniang Bayan, San Jose, Occidental Mindoro" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();

  return (
    <Layout>

      {/* ── Hero ──────────────────────────────────────── */}
      <section className="relative h-screen min-h-[640px] flex items-center overflow-hidden -mt-16 pt-16">
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
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-[1.05] tracking-tight drop-shadow-xl">
              Ang Kabataan<br />
              ang Pag-asa ng<br />
              <span className="text-orange-400">Bayan</span>
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
        <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-background to-transparent" />

        {/* Scroll hint */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/40 pointer-events-none animate-scroll-bounce"
          aria-hidden
        >
          <ChevronDown className="h-5 w-5" />
        </div>
      </section>

      {/* ── Features ──────────────────────────────────── */}
      <section className="py-20 lg:py-28 bg-background">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Our Platform</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
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
      <section id="scholarships" className="py-20 lg:py-28 bg-orange-50/50 scroll-mt-20">
        <div className="container">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Scholarships</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
              Available <span className="text-gradient-primary">Programs</span>
            </h2>
            <p className="text-muted-foreground">
              Browse and apply for scholarships that match your qualifications and goals.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {scholarships.map((s, i) => (
              <Reveal key={i} delay={i * 80}>
                <ScholarshipCard {...s} onApply={() => router.push("/register")} />
              </Reveal>
            ))}
          </div>

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
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
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
                <div className="text-[10px] font-bold text-primary mb-1 tracking-[0.2em]">STEP {i + 1}</div>
                <h3 className="text-sm font-display font-bold text-foreground mb-1">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact ───────────────────────────────────── */}
      <section id="contact" className="py-20 lg:py-28 bg-background scroll-mt-20">
        <div className="container max-w-5xl">
          <Reveal className="text-center max-w-xl mx-auto mb-14">
            <SectionLabel>Contact Us</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
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
                <CardContent className="p-7 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="Your full name" maxLength={100} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@example.com" maxLength={255} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea id="message" placeholder="How can we help?" rows={4} maxLength={1000} />
                  </div>
                  <Button className="w-full h-11 bg-gradient-primary shadow-primary cursor-pointer">
                    Send Message <Send className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      <LandingFooter />
    </Layout>
  );
}
