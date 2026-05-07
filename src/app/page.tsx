"use client";

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
import {
  GraduationCap, ArrowRight, Zap, BarChart3, Wallet, Bell,
  UserPlus, FileText, Search, CheckCircle2, Send, Mail, Phone, MapPin, Quote,
} from "lucide-react";

const scholarships = [
  { name: "Academic Excellence Scholarship", description: "Full scholarship for students maintaining outstanding academic performance throughout their college education.", eligibility: "Must maintain a GPA of 90+ and be a resident of San Jose, Occidental Mindoro", deadline: "June 30, 2026" },
  { name: "Financial Assistance Grant", description: "Financial support for underprivileged but deserving students pursuing higher education.", eligibility: "Household income below ₱150,000/year, minimum 85 average grade", deadline: "July 15, 2026" },
  { name: "STEM Leadership Scholarship", description: "Scholarship for students enrolled in Science, Technology, Engineering, and Mathematics programs.", eligibility: "Enrolled in STEM course, minimum 88 average grade", deadline: "August 1, 2026" },
  { name: "Community Service Award", description: "Recognition and support for students who demonstrate exceptional community involvement.", eligibility: "100+ hours community service, minimum 85 average grade", deadline: "July 31, 2026" },
];

const features = [
  { icon: Zap, title: "Easy Application", desc: "Apply in minutes with guided forms." },
  { icon: BarChart3, title: "Real-Time Tracking", desc: "Monitor application & payment status." },
  { icon: Wallet, title: "Secure Disbursement", desc: "Transparent and trackable fund release." },
  { icon: Bell, title: "Instant Notifications", desc: "Stay updated with timely alerts." },
];

const steps = [
  { icon: UserPlus, title: "Register", desc: "Create your account." },
  { icon: FileText, title: "Submit Application", desc: "Fill the form and upload documents." },
  { icon: Search, title: "Admin Review", desc: "Our team verifies your submission." },
  { icon: CheckCircle2, title: "Get Approved", desc: "Receive your approval notice." },
  { icon: Wallet, title: "Receive Funds", desc: "Funds disbursed transparently." },
];

const testimonials = [
  { quote: "This system made applying for scholarships so easy! I tracked everything in real-time.", name: "Maria Santos", role: "BS Education Scholar" },
  { quote: "Transparent, fast, and reliable. I knew exactly when my funds were released.", name: "Juan Dela Cruz", role: "BS Information Technology Scholar" },
  { quote: "The notifications kept me informed at every step. Highly recommended!", name: "Andrea Lim", role: "Senior High School Scholar" },
];

export default function HomePage() {
  const router = useRouter();

  return (
    <Layout>
      {/* Hero */}
      <section className="relative h-screen min-h-[600px] flex items-center overflow-hidden -mt-16 pt-16">
        <div className="absolute inset-0">
          <Image src="/hero-bg.jpg" alt="San Jose, Occidental Mindoro" fill className="object-cover" priority />
          <div className="absolute inset-0 bg-foreground/30" />
        </div>
        <div className="container relative z-10">
          <div className="max-w-3xl space-y-6 animate-fade-in-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/30 bg-primary-foreground/10 px-4 py-1.5 text-sm text-primary-foreground backdrop-blur-sm">
              <GraduationCap className="h-4 w-4" />
              Sangguniang Bayan ng San Jose
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-primary-foreground leading-tight drop-shadow-lg">
              Ang Kabataan ang Pag-asa ng Bayan
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/90 max-w-2xl drop-shadow">
              Apply, track, and receive scholarships transparently.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button size="lg" onClick={() => router.push("/register")} className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-primary">
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => router.push("/login")} className="border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 backdrop-blur-sm">
                Login
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 lg:py-24 bg-background">
        <div className="container">
          <div className="mb-12 text-center max-w-xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Why Choose Our System</h2>
            <p className="text-muted-foreground">Built to make scholarship management seamless for students and administrators.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <Card key={i} className="hover-lift border-border/50">
                <CardContent className="p-6 space-y-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <f.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-display font-semibold text-foreground">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Scholarships */}
      <section id="scholarships" className="py-16 lg:py-24 bg-muted/30 scroll-mt-20">
        <div className="container">
          <div className="mb-12 text-center max-w-xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Available Scholarships</h2>
            <p className="text-muted-foreground">Browse and apply for scholarships that match your qualifications and goals.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {scholarships.map((s, i) => (
              <div key={i} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.1}s` }}>
                <ScholarshipCard {...s} onApply={() => router.push("/register")} />
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button size="lg" variant="outline" onClick={() => router.push("/register")}>
              View All Scholarships <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 lg:py-24 bg-background">
        <div className="container">
          <div className="mb-12 text-center max-w-xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">How It Works</h2>
            <p className="text-muted-foreground">From application to disbursement in 5 simple steps.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            {steps.map((s, i) => (
              <div key={i} className="relative text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-primary">
                  <s.icon className="h-6 w-6" />
                </div>
                <div className="text-xs font-semibold text-primary mb-1">STEP {i + 1}</div>
                <h3 className="text-base font-display font-semibold text-foreground mb-1">{s.title}</h3>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 lg:py-24 bg-muted/30">
        <div className="container">
          <div className="mb-12 text-center max-w-xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">What Our Scholars Say</h2>
            <p className="text-muted-foreground">Real stories from students we&apos;ve supported.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <Card key={i} className="hover-lift border-border/50">
                <CardContent className="p-6 space-y-4">
                  <Quote className="h-8 w-8 text-primary/40" />
                  <p className="text-sm text-foreground leading-relaxed italic">&ldquo;{t.quote}&rdquo;</p>
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-16 lg:py-24 bg-background scroll-mt-20">
        <div className="container max-w-5xl">
          <div className="mb-12 text-center max-w-xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">Get In Touch</h2>
            <p className="text-muted-foreground">Have questions? Reach out and we&apos;ll get back to you.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Mail className="h-5 w-5" /></div>
                <div><p className="text-sm font-semibold text-foreground">Email</p><p className="text-sm text-muted-foreground">scholarship@sbom.gov.ph</p></div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Phone className="h-5 w-5" /></div>
                <div><p className="text-sm font-semibold text-foreground">Phone</p><p className="text-sm text-muted-foreground">(043) 123-4567</p></div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><MapPin className="h-5 w-5" /></div>
                <div><p className="text-sm font-semibold text-foreground">Office</p><p className="text-sm text-muted-foreground">Sangguniang Bayan, San Jose, Occidental Mindoro</p></div>
              </div>
            </div>
            <Card className="border-border/50">
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" placeholder="Your full name" maxLength={100} /></div>
                <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" placeholder="you@example.com" maxLength={255} /></div>
                <div className="space-y-2"><Label htmlFor="message">Message</Label><Textarea id="message" placeholder="How can we help?" rows={4} maxLength={1000} /></div>
                <Button className="w-full bg-gradient-primary shadow-primary">Send Message <Send className="ml-2 h-4 w-4" /></Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <LandingFooter />
    </Layout>
  );
}
