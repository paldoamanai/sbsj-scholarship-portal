"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";
import { needsHomeVisit, needsHousePin } from "@/lib/office-requirements";
import { directionsLink, googleMapsLink } from "@/lib/geo";
import { personName } from "@/lib/reports";
import type { VisitPoint } from "@/components/maps/VisitsMap";

const VisitsMap = dynamic(() => import("@/components/maps/VisitsMap"), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full rounded-xl border bg-muted animate-pulse" />,
});

type App = Tables<"applications"> & { scholarships: { name: string } | null; profiles?: Tables<"profiles"> | null };

const fmt = (at: string) => new Date(at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
const STATUS_LABEL: Record<VisitPoint["status"], string> = { none: "Not scheduled", scheduled: "Scheduled", done: "Done" };
const DOT: Record<VisitPoint["status"], string> = { none: "bg-orange-600", scheduled: "bg-blue-600", done: "bg-green-600" };

/** Applications in review that need a home visit or a house pin, on one map, for planning the visits. */
export default function HomeVisitsPanel({ applications, scholarships, onOpen }: {
  applications: App[];
  scholarships: { id: string; office?: string | null }[];
  onOpen: (app: App) => void;
}) {
  const [barangay, setBarangay] = useState("all");
  const [status, setStatus] = useState<"all" | VisitPoint["status"]>("all");

  const rows = useMemo(() => applications
    .filter((a) => a.status === "Pending" || a.status === "Waitlisted")
    .filter((a) => { const office = scholarships.find((s) => s.id === a.scholarship_id)?.office; return needsHomeVisit(office) || needsHousePin(office); })
    .map((a) => {
      const p = a.profiles;
      const pin = p?.home_lat != null && p?.home_lng != null ? { lat: p.home_lat, lng: p.home_lng } : null;
      const visit: VisitPoint["status"] = a.home_visit_done_at ? "done" : a.home_visit_at ? "scheduled" : "none";
      return { a, p, pin, visit, barangay: p?.barangay?.trim() || "No barangay" };
    })
    .sort((x, y) => (x.a.home_visit_at ?? "9999").localeCompare(y.a.home_visit_at ?? "9999") || x.barangay.localeCompare(y.barangay)),
  [applications, scholarships]);

  const barangays = [...new Set(rows.map((r) => r.barangay))].sort();
  const shown = rows.filter((r) => (barangay === "all" || r.barangay === barangay) && (status === "all" || r.visit === status));
  const points: VisitPoint[] = shown.filter((r) => r.pin).map((r) => ({
    ...r.pin!, id: r.a.id, name: personName(r.p), status: r.visit,
    detail: [r.a.scholarships?.name, r.barangay, r.p?.home_landmark, r.a.home_visit_at ? `Visit ${fmt(r.a.home_visit_at)}` : "Visit not scheduled"].filter(Boolean).join(" · "),
  }));
  const unpinned = shown.filter((r) => !r.pin).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Home visits</CardTitle>
        <CardDescription>
          Applicants in review whose program visits their home. Plan visits by barangay, then open an application to schedule or record its visit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={barangay} onValueChange={setBarangay}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Barangay" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All barangays</SelectItem>
              {barangays.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Visit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every visit status</SelectItem>
              {(["none", "scheduled", "done"] as const).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(["none", "scheduled", "done"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${DOT[s]}`} />{STATUS_LABEL[s]}</span>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applications in review need a home visit right now.</p>
        ) : (
          <>
            <VisitsMap points={points} onOpen={(id) => { const r = rows.find((x) => x.a.id === id); if (r) onOpen(r.a); }} />
            {unpinned > 0 && <p className="text-xs text-muted-foreground">{unpinned} applicant{unpinned === 1 ? " hasn't" : "s haven't"} pinned their house yet, so they&apos;re only in the list.</p>}
            <ul className="divide-y rounded-md border">
              {shown.map((r) => (
                <li key={r.a.id} className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium flex items-center gap-1.5"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[r.visit]}`} />{personName(r.p)}</p>
                    <p className="text-xs text-muted-foreground">
                      {[r.a.scholarships?.name, r.barangay, r.p?.home_landmark, r.a.home_visit_done_at ? `Visited ${fmt(r.a.home_visit_done_at)}` : r.a.home_visit_at ? `Visit ${fmt(r.a.home_visit_at)}` : "Not scheduled", r.pin ? null : "No house pin"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => onOpen(r.a)}>Open</Button>
                    {r.pin && <Button size="sm" variant="outline" asChild><a href={directionsLink(r.pin)} target="_blank" rel="noreferrer">Directions</a></Button>}
                    {r.pin && <Button size="sm" variant="ghost" asChild><a href={googleMapsLink(r.pin)} target="_blank" rel="noreferrer">Maps</a></Button>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
