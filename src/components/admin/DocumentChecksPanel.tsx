"use client";

// Admin → Document Checks (migration 087): flagged documents to look at, random audits, the signatories
// and genuine samples scans compare against, and students barred from applying.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReasonDialog } from "@/components/AppDialog";
import { FileText, Loader2, RefreshCw, Trash2, Upload } from "@/components/icons";
import { BARANGAYS } from "@/lib/barangays";
import { safeFileName } from "@/lib/documents";
import { documentRisk, sampleSignature } from "@/lib/doc-checks";
import { FlagBadges, RiskBadge, loadCheckRefs } from "@/components/admin/DocumentChecks";

type App = { id: string; user_id: string; academic_year: string | null; status: string; scholarships?: { name: string } | null };
type Profile = Pick<Tables<"profiles">, "id" | "first_name" | "last_name" | "email">;

const personName = (p: Profile | undefined) => (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Student" : "Student");
const when = (d: string) => new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

export default function DocumentChecksPanel({
  applications, profiles, currentAY, documentTypes, canReview, canManage, onOpenApp, onBarredChange,
}: {
  applications: App[]; profiles: Profile[]; currentAY: string; documentTypes: string[];
  canReview: boolean; canManage: boolean; onOpenApp: (applicationId: string) => void; onBarredChange: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const appById = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications]);
  const [missing, setMissing] = useState(false);

  // ── Flagged documents ──
  type Flagged = Pick<Tables<"documents">, "id" | "user_id" | "application_id" | "document_type" | "status" | "flags" | "needs_original" | "original_seen_at" | "uploaded_at">;
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [flagStatus, setFlagStatus] = useState("Pending");
  const [flagRisk, setFlagRisk] = useState("medium");
  const [loadingFlags, setLoadingFlags] = useState(false);
  const loadFlagged = async () => {
    setLoadingFlags(true);
    let q = supabase.from("documents").select("id, user_id, application_id, document_type, status, flags, needs_original, original_seen_at, uploaded_at")
      .not("flags", "eq", "{}").order("uploaded_at", { ascending: false }).limit(500);
    if (flagStatus !== "all") q = q.eq("status", flagStatus);
    const { data, error } = await q;
    setLoadingFlags(false);
    if (error) { setMissing(/column|does not exist|schema cache/i.test(error.message)); return; }
    setFlagged(data ?? []);
  };
  useEffect(() => {
    loadFlagged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagStatus]);
  const shownFlagged = flagged.filter((d) => {
    const r = documentRisk(d.flags);
    return flagRisk === "all" || (flagRisk === "high" ? r === "high" : r === "high" || r === "medium");
  });

  // ── Audits ──
  const [audits, setAudits] = useState<Tables<"document_audits">[]>([]);
  const [auditYear, setAuditYear] = useState(currentAY);
  const [percent, setPercent] = useState("10");
  const [picking, setPicking] = useState(false);
  const loadAudits = async () => {
    const { data } = await supabase.from("document_audits").select("*").eq("academic_year", auditYear).order("selected_at", { ascending: false });
    setAudits(data ?? []);
  };
  useEffect(() => {
    loadAudits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditYear]);
  const pickAudits = async () => {
    setPicking(true);
    const { data, error } = await supabase.rpc("select_audit_sample", { _percent: Number(percent), _academic_year: auditYear });
    setPicking(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data ? `${data} scholar${data === 1 ? "" : "s"} picked and told to bring their originals` : "Already at that share for this year: nobody new was picked");
    loadAudits();
  };
  const approvedThisYear = applications.filter((a) => a.status === "Approved" && a.academic_year === auditYear).length;

  // ── Signatories ──
  const [signatories, setSignatories] = useState<Tables<"document_signatories">[]>([]);
  const [sig, setSig] = useState({ name: "", position: "", document_type: "any", place: "" });
  const loadSignatories = async () => {
    const { data } = await supabase.from("document_signatories").select("*").order("place").order("name");
    setSignatories(data ?? []);
  };
  const addSignatory = async () => {
    const { error } = await supabase.from("document_signatories").insert({
      name: sig.name.trim(), position: sig.position.trim() || null, place: sig.place.trim() || null,
      document_type: sig.document_type === "any" ? null : sig.document_type,
    });
    if (error) { toast.error(error.message); return; }
    setSig({ name: "", position: "", document_type: sig.document_type, place: sig.place });
    toast.success("Signatory added"); loadSignatories(); loadCheckRefs(supabase, true);
  };
  const toggleSignatory = async (s: Tables<"document_signatories">) => {
    const { error } = await supabase.from("document_signatories").update({ active: !s.active }).eq("id", s.id);
    if (error) toast.error(error.message); else { loadSignatories(); loadCheckRefs(supabase, true); }
  };
  const removeSignatory = async (id: string) => {
    const { error } = await supabase.from("document_signatories").delete().eq("id", id);
    if (error) toast.error(error.message); else { loadSignatories(); loadCheckRefs(supabase, true); }
  };

  // ── Samples ──
  const [samples, setSamples] = useState<(Tables<"document_samples"> & { url?: string })[]>([]);
  const [sample, setSample] = useState<{ document_type: string; place: string; label: string; file: File | null }>({ document_type: documentTypes[0] ?? "", place: "", label: "", file: null });
  const [savingSample, setSavingSample] = useState(false);
  const loadSamples = async () => {
    const { data } = await supabase.from("document_samples").select("*").order("document_type").order("created_at", { ascending: false });
    const rows = await Promise.all((data ?? []).map(async (s) => {
      const { data: signed } = await supabase.storage.from("documents").createSignedUrl(s.storage_path, 3600);
      return { ...s, url: signed?.signedUrl };
    }));
    setSamples(rows);
  };
  const addSample = async () => {
    if (!sample.file || !sample.document_type) return;
    setSavingSample(true);
    try {
      const sigData = await sampleSignature(sample.file);
      const path = `samples/${crypto.randomUUID()}-${safeFileName(sample.file.name)}`;
      const up = await supabase.storage.from("documents").upload(path, sample.file, { contentType: sample.file.type });
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase.from("document_samples").insert({
        document_type: sample.document_type, place: sample.place.trim() || null, label: sample.label.trim() || null,
        storage_path: path, mime_type: sample.file.type, phash: sigData.phash, layout: sigData.layout,
      });
      if (error) { await supabase.storage.from("documents").remove([path]); throw new Error(error.message); }
      toast.success("Sample added. New checks compare uploads with it.");
      setSample((s) => ({ ...s, label: "", file: null }));
      loadSamples(); loadCheckRefs(supabase, true);
    } catch (e) {
      toast.error("Couldn't add the sample", { description: e instanceof Error ? e.message : undefined });
    } finally { setSavingSample(false); }
  };
  const removeSample = async (s: Tables<"document_samples">) => {
    const { error } = await supabase.from("document_samples").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    await supabase.storage.from("documents").remove([s.storage_path]);
    loadSamples(); loadCheckRefs(supabase, true);
  };

  // ── Barred ──
  const [barredList, setBarredList] = useState<Tables<"barred_students">[]>([]);
  const [barSearch, setBarSearch] = useState("");
  const [barTarget, setBarTarget] = useState<Profile | null>(null);
  const [barReason, setBarReason] = useState("");
  const [barBusy, setBarBusy] = useState(false);
  const loadBarred = async () => {
    const { data } = await supabase.from("barred_students").select("*").order("barred_at", { ascending: false });
    setBarredList(data ?? []);
  };
  const setBar = async (userId: string, on: boolean) => {
    setBarBusy(true);
    const { error } = await supabase.rpc("set_student_barred", { _user: userId, _barred: on, _reason: on ? barReason.trim() : null });
    setBarBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(on ? "Barred from applying" : "They can apply again");
    setBarTarget(null); setBarReason(""); setBarSearch("");
    loadBarred(); onBarredChange();
  };
  const barMatches = barSearch.trim().length < 2 ? [] : profiles.filter((p) =>
    `${personName(p)} ${p.email ?? ""}`.toLowerCase().includes(barSearch.trim().toLowerCase()) && !barredList.some((b) => b.user_id === p.id)).slice(0, 8);

  useEffect(() => {
    loadSignatories(); loadSamples(); loadBarred();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (missing) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground">
        Document checks need database migration 087 (<code>supabase/migrations/087_document_checks.sql</code>). Run it in the Supabase SQL Editor, then reload this page.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h2 className="text-xl font-display font-bold">Document Checks</h2>
        <p className="text-sm text-muted-foreground">Flags point at documents worth a closer look. They never prove a document is fake: confirm with the original or whoever issued it.</p>
      </div>
      <Tabs defaultValue="flagged">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="flagged">Flagged</TabsTrigger>
          <TabsTrigger value="audits">Random audits</TabsTrigger>
          <TabsTrigger value="signatories">Signatories</TabsTrigger>
          <TabsTrigger value="samples">Genuine samples</TabsTrigger>
          <TabsTrigger value="barred">Barred students</TabsTrigger>
        </TabsList>

        <TabsContent value="flagged">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div><CardTitle className="text-base">Flagged documents</CardTitle><CardDescription>Newest first. Open one to see it next to a sample or the matching upload.</CardDescription></div>
              <div className="flex flex-wrap gap-2">
                <Select value={flagStatus} onValueChange={setFlagStatus}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Pending">Not reviewed</SelectItem><SelectItem value="Verified">Verified</SelectItem><SelectItem value="Disapproved">Disapproved</SelectItem><SelectItem value="all">Any status</SelectItem></SelectContent>
                </Select>
                <Select value={flagRisk} onValueChange={setFlagRisk}>
                  <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="high">High risk</SelectItem><SelectItem value="medium">Medium and high</SelectItem><SelectItem value="all">Any flag</SelectItem></SelectContent>
                </Select>
                <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Refresh" onClick={loadFlagged}>{loadingFlags ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
              </div>
            </CardHeader>
            <CardContent>
              {shownFlagged.length === 0 ? <p className="text-sm text-muted-foreground">{loadingFlags ? "Loading…" : "Nothing flagged here."}</p> : (
                <ul className="divide-y">
                  {shownFlagged.map((d) => {
                    const app = d.application_id ? appById.get(d.application_id) : undefined;
                    return (
                      <li key={d.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm"><span className="font-medium">{personName(profileById.get(d.user_id))}</span> · {d.document_type}
                            <span className="text-xs text-muted-foreground"> · {when(d.uploaded_at)} · {d.status}{app?.scholarships?.name ? ` · ${app.scholarships.name}` : ""}</span></p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <RiskBadge risk={documentRisk(d.flags)} />
                            {d.needs_original && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${d.original_seen_at ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{d.original_seen_at ? "Original seen" : "Needs original"}</span>}
                            <FlagBadges flags={d.flags} />
                          </div>
                        </div>
                        {app && <Button size="sm" variant="outline" className="shrink-0" onClick={() => onOpenApp(app.id)}>Open application</Button>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audits">
          <Card>
            <CardHeader><CardTitle className="text-base">Random audits</CardTitle>
              <CardDescription>Pick a random share of approved scholars for a full check: every original seen and the issuers confirmed. Picked scholars are told to bring their originals. Picking again tops up to the share.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {canReview && (
                <div className="flex flex-wrap items-end gap-2">
                  <div><Label className="text-xs">School year</Label><Input value={auditYear} onChange={(e) => setAuditYear(e.target.value)} className="h-9 w-32" /></div>
                  <div><Label className="text-xs">Share (%)</Label><Input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className="h-9 w-24" /></div>
                  <Button disabled={picking || !(Number(percent) > 0)} onClick={pickAudits}>{picking && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Pick scholars</Button>
                  <p className="w-full text-xs text-muted-foreground">{approvedThisYear} approved application{approvedThisYear === 1 ? "" : "s"} in {auditYear}; {audits.length} picked so far.</p>
                </div>
              )}
              {audits.length === 0 ? <p className="text-sm text-muted-foreground">Nobody picked for {auditYear} yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Scholar</TableHead><TableHead>Program</TableHead><TableHead>Picked</TableHead><TableHead>Result</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {audits.map((a) => {
                      const app = appById.get(a.application_id);
                      return (
                        <TableRow key={a.id}>
                          <TableCell>{personName(app ? profileById.get(app.user_id) : undefined)}</TableCell>
                          <TableCell className="text-xs">{app?.scholarships?.name ?? "—"}</TableCell>
                          <TableCell className="text-xs">{when(a.selected_at)}</TableCell>
                          <TableCell><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${a.status === "Passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : a.status === "Failed" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{a.status}</span>
                            {a.note && <span className="block text-[11px] text-muted-foreground">{a.note}</span>}</TableCell>
                          <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => onOpenApp(a.application_id)}>Open</Button></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signatories">
          <Card>
            <CardHeader><CardTitle className="text-base">Signatories on file</CardTitle>
              <CardDescription>The current barangay captains, registrars and other officials who sign documents. Checks flag a document that names none of them, or names a former one. Turn a person off when they leave office instead of deleting them.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {canReview && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Input placeholder="Full name" value={sig.name} maxLength={120} onChange={(e) => setSig({ ...sig, name: e.target.value })} />
                  <Input placeholder="Position (e.g. Punong Barangay)" value={sig.position} maxLength={120} onChange={(e) => setSig({ ...sig, position: e.target.value })} />
                  <Select value={sig.document_type} onValueChange={(v) => setSig({ ...sig, document_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="any">Any document</SelectItem>{documentTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="Barangay or school (optional)" list="doc-check-places" value={sig.place} maxLength={120} onChange={(e) => setSig({ ...sig, place: e.target.value })} />
                  <Button disabled={sig.name.trim().length < 3} onClick={addSignatory}>Add signatory</Button>
                </div>
              )}
              <datalist id="doc-check-places">{BARANGAYS.map((b) => <option key={b} value={b} />)}</datalist>
              {signatories.length === 0 ? <p className="text-sm text-muted-foreground">No signatories on file yet, so this check is off.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Position</TableHead><TableHead>Document</TableHead><TableHead>Place</TableHead><TableHead>Current</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {signatories.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs">{s.position ?? "—"}</TableCell>
                        <TableCell className="text-xs">{s.document_type ?? "Any"}</TableCell>
                        <TableCell className="text-xs">{s.place ?? "Anywhere"}</TableCell>
                        <TableCell><Switch checked={s.active} disabled={!canReview} onCheckedChange={() => toggleSignatory(s)} aria-label="Currently in office" /></TableCell>
                        <TableCell className="text-right">{canReview && <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => removeSignatory(s.id)}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="samples">
          <Card>
            <CardHeader><CardTitle className="text-base">Genuine samples</CardTitle>
              <CardDescription>One real copy of each common document, ideally for each barangay or school. Checks compare an upload&apos;s layout with the closest sample, and reviewers can view them side by side. Blank out personal details before uploading.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {canReview && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Select value={sample.document_type} onValueChange={(v) => setSample({ ...sample, document_type: v })}>
                    <SelectTrigger><SelectValue placeholder="Document" /></SelectTrigger>
                    <SelectContent>{documentTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="Barangay or school (optional)" list="doc-check-places" value={sample.place} maxLength={120} onChange={(e) => setSample({ ...sample, place: e.target.value })} />
                  <Input placeholder="Label (optional)" value={sample.label} maxLength={120} onChange={(e) => setSample({ ...sample, label: e.target.value })} />
                  <label className="flex h-10 cursor-pointer items-center gap-2 truncate rounded-md border px-3 text-sm text-muted-foreground">
                    <Upload className="h-4 w-4 shrink-0" /><span className="truncate">{sample.file?.name ?? "Choose file (JPG, PNG, PDF)"}</span>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(e) => setSample({ ...sample, file: e.target.files?.[0] ?? null })} />
                  </label>
                  <Button disabled={!sample.file || savingSample} onClick={addSample}>{savingSample && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Add sample</Button>
                </div>
              )}
              {samples.length === 0 ? <p className="text-sm text-muted-foreground">No samples yet, so the layout check is off.</p> : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {samples.map((s) => (
                    <div key={s.id} className="overflow-hidden rounded-lg border">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="block h-40 bg-muted/40">
                        {s.mime_type === "application/pdf" || !s.url
                          ? <div className="flex h-full items-center justify-center text-muted-foreground"><FileText className="h-8 w-8" /></div>
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={s.url} alt={s.document_type} className="h-full w-full object-contain" />}
                      </a>
                      <div className="flex items-start justify-between gap-2 p-2 text-xs">
                        <div className="min-w-0"><p className="truncate font-medium">{s.document_type}</p><p className="truncate text-muted-foreground">{[s.place, s.label].filter(Boolean).join(" · ") || "Any place"}</p></div>
                        {canReview && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Delete sample" onClick={() => removeSample(s)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="barred">
          <Card>
            <CardHeader><CardTitle className="text-base">Barred from applying</CardTitle>
              <CardDescription>Students caught with fake documents. They can still sign in but can&apos;t submit new applications. Only admins can change this.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {canManage && (
                <div className="space-y-2">
                  <Input placeholder="Find a student to bar (name or email)" value={barSearch} onChange={(e) => setBarSearch(e.target.value)} className="max-w-md" />
                  {barMatches.length > 0 && (
                    <ul className="max-w-md divide-y rounded-lg border">
                      {barMatches.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                          <span className="truncate">{personName(p)} <span className="text-xs text-muted-foreground">{p.email}</span></span>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setBarTarget(p)}>Bar</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {barredList.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is barred.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Reason</TableHead><TableHead>Since</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {barredList.map((b) => (
                      <TableRow key={b.user_id}>
                        <TableCell className="font-medium">{personName(profileById.get(b.user_id))}</TableCell>
                        <TableCell className="text-xs">{b.reason}</TableCell>
                        <TableCell className="text-xs">{when(b.barred_at)}</TableCell>
                        <TableCell className="text-right">{canManage && <Button size="sm" variant="outline" disabled={barBusy} onClick={() => setBar(b.user_id, false)}>Allow again</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ReasonDialog open={!!barTarget} onClose={() => setBarTarget(null)} title={`Bar ${personName(barTarget ?? undefined)} from applying?`}
        description="They won't be able to submit new applications. Current applications aren't changed. This is recorded in the audit log."
        value={barReason} onChange={setBarReason} maxLength={1000} placeholder="What was found"
        confirmLabel="Bar from applying" busy={barBusy} onConfirm={() => barTarget && setBar(barTarget.id, true)} />
    </div>
  );
}
