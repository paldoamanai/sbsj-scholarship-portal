"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import LandingFooter from "@/components/LandingFooter";
import ScholarshipCard from "@/components/ScholarshipCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, Search, ArrowRight, SlidersHorizontal } from "lucide-react";

interface Scholarship {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  slots: number;
  is_active: boolean;
  deadline: string | null;
  eligibility: string | null;
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return "Open";
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return deadline;
  const now = new Date();
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Closed";
  if (diffDays === 0) return "Due today";
  if (diffDays <= 7) return `${diffDays}d left`;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export default function ScholarshipsPage() {
  const router = useRouter();
  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"deadline" | "amount" | "slots">("deadline");

  useEffect(() => {
    fetch("/api/scholarships")
      .then((r) => r.json())
      .then((data) => setScholarships(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = scholarships
    .filter((s) => {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        (s.eligibility ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "amount") return (b.amount ?? 0) - (a.amount ?? 0);
      if (sortBy === "slots") return (b.slots ?? 0) - (a.slots ?? 0);
      // deadline: nulls last, soonest first
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-orange-50/60 border-b py-16 lg:py-20">
        <div className="container text-center max-w-2xl mx-auto space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-4 py-1.5 text-sm font-semibold text-orange-700">
            <GraduationCap className="h-4 w-4" />
            Sangguniang Bayan ng San Jose
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight">
            Available Scholarships
          </h1>
          <p className="text-muted-foreground text-lg">
            Browse all active scholarship programs. No account needed to explore — just click <strong>Apply Now</strong> when you&apos;re ready.
          </p>

          {/* Search */}
          <div className="relative max-w-lg mx-auto pt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name, course, or eligibility…"
              className="pl-10 h-11"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Listing */}
      <section className="py-12 lg:py-16">
        <div className="container">
          {/* Toolbar */}
          {!loading && scholarships.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
              <p className="text-sm text-muted-foreground">
                {filtered.length === scholarships.length
                  ? `${scholarships.length} scholarship${scholarships.length !== 1 ? "s" : ""} available`
                  : `${filtered.length} of ${scholarships.length} matching`}
              </p>
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Sort:</span>
                {(["deadline", "amount", "slots"] as const).map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={sortBy === key ? "default" : "outline"}
                    className="capitalize h-8"
                    onClick={() => setSortBy(key)}
                  >
                    {key}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Cards */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-48 rounded-xl" />
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-4 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24 text-muted-foreground">
              <GraduationCap className="h-14 w-14 mx-auto mb-4 opacity-20" />
              <p className="text-xl font-display font-semibold text-foreground">
                {search ? "No matches found" : "No scholarships available"}
              </p>
              <p className="text-sm mt-2">
                {search ? "Try a different search term." : "Check back soon — new programs will be posted here."}
              </p>
              {search && (
                <Button variant="outline" className="mt-4" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((s, i) => (
                <div key={s.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                  <ScholarshipCard
                    name={s.name}
                    description={s.description ?? ""}
                    eligibility={s.eligibility ?? "Open to all qualified applicants"}
                    deadline={formatDeadline(s.deadline)}
                    onApply={() => router.push("/register")}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      {!loading && filtered.length > 0 && (
        <section className="bg-orange-50/60 border-t py-12">
          <div className="container text-center space-y-4 max-w-xl mx-auto">
            <h2 className="text-2xl font-display font-bold text-foreground">Ready to apply?</h2>
            <p className="text-muted-foreground">Create a free account to submit your application in minutes.</p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Link href="/register">
                <Button size="lg" className="bg-gradient-primary shadow-primary">
                  Create Account <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline">Already have an account? Login</Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      <LandingFooter />
    </Layout>
  );
}
