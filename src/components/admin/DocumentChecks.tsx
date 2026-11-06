"use client";

// Reviewer tools for document checks (migration 087, lib/doc-checks):
//   RiskBadge / FlagBadges   what was flagged, at a glance
//   useAutoScan              reads each new document once in the reviewer's browser and saves the result
//   DocumentViewer           the document zoomable, next to a genuine sample or a matching upload, with
//                            every finding, the original-seen record and the AI detector

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { AppDialog, Detail, DetailGrid, DialogSection } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, ShieldCheck } from "@/components/icons";
import { FileView } from "@/components/FilePreview";
import {
  FLAG_INFO, HIGH_FLAGS, RISK_LABEL, RISK_TONE, SEVERITY_TONE, documentRisk, flagInfo, scanDocument,
  detectorImage, type Risk, type Sample, type ScanResult, type Signatory, type UploadChecks,
} from "@/lib/doc-checks";
import { cn } from "@/lib/utils";

type Supabase = ReturnType<typeof createClient>;
type DocRow = Tables<"documents">;
export type ScanProfile = Pick<Tables<"profiles">, "first_name" | "middle_name" | "last_name" | "dob" | "barangay" | "school_name" | "average_grade" | "home_lat" | "home_lng">;

// ── Signatories and samples, read once and shared ──
export type CheckRefs = { signatories: (Signatory & { id: string })[]; samples: Sample[] };
let refs: Promise<CheckRefs> | null = null;
export function loadCheckRefs(supabase: Supabase, force = false): Promise<CheckRefs> {
  if (!refs || force) {
    refs = Promise.all([
      supabase.from("document_signatories").select("*"),
      supabase.from("document_samples").select("*"),
    ]).then(([s, m]) => ({ signatories: (s.data ?? []) as CheckRefs["signatories"], samples: (m.data ?? []) as Sample[] }))
      .catch(() => ({ signatories: [], samples: [] }));
  }
  return refs;
}

// ── Badges ──
export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", RISK_TONE[risk], className)}>
      {risk === "none" ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{RISK_LABEL[risk]}
    </span>
  );
}

export function FlagBadges({ flags, className }: { flags: readonly string[] | null | undefined; className?: string }) {
  const list = [...(flags ?? [])].sort((a, b) => ["high", "medium", "low"].indexOf(flagInfo(a).severity) - ["high", "medium", "low"].indexOf(flagInfo(b).severity));
  if (!list.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {list.map((f) => (
        <span key={f} title={flagInfo(f).detail} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", SEVERITY_TONE[flagInfo(f).severity])}>
          {flagInfo(f).label}
        </span>
      ))}
    </div>
  );
}

/** The flags line under a document in a list: risk, flags, original status and a button to open the viewer. */
export function DocCheckLine({ row, scanning, onOpen }: { row: DocRow; scanning: boolean; onOpen: () => void }) {
  const flags = row.flags ?? [];
  const risk = documentRisk(flags);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {scanning ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Checking…</span>
      ) : row.scanned_at || flags.length ? <RiskBadge risk={risk} /> : (
        <span className="text-[11px] text-muted-foreground">Not checked yet</span>
      )}
      {row.needs_original && (
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold",
          row.original_seen_at ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>
          {row.original_seen_at ? "Original seen" : "Needs original"}
        </span>
      )}
      <FlagBadges flags={flags} />
      <button type="button" onClick={onOpen} className="ml-auto text-[11px] font-medium text-primary hover:underline">Check details</button>
    </div>
  );
}

// ── Scanning ──
/** Reads one stored document and saves what was found. Returns the updated row, or an error. */
export async function scanAndSave(supabase: Supabase, row: DocRow, url: string, ctx: { profile: ScanProfile | null; academicYear: string | null }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't download the document");
  const raw = await res.blob();
  const blob = raw.type === row.mime_type || !row.mime_type ? raw : new Blob([raw], { type: row.mime_type });
  const { signatories, samples } = await loadCheckRefs(supabase);
  const p = ctx.profile;
  const result = await scanDocument(blob, {
    docType: row.document_type,
    profile: { first_name: p?.first_name, middle_name: p?.middle_name, last_name: p?.last_name, dob: p?.dob, barangay: p?.barangay,
      school_name: p?.school_name, average_grade: p?.average_grade, home_lat: p?.home_lat, home_lng: p?.home_lng },
    signatories, samples, uploadChecks: (row.checks as unknown as UploadChecks) ?? null,
    uploadedAt: new Date(row.uploaded_at), academicYear: ctx.academicYear,
  });
  const { error } = await supabase.rpc("record_document_scan", {
    _id: row.id, _scan: result.scan as unknown as Json, _sha256: result.sha256, _phash: result.phash, _control_no: result.controlNo,
  });
  if (error) throw new Error(error.message);
  const { data } = await supabase.from("documents").select("*").eq("id", row.id).single();
  return data as DocRow;
}

// Each document is read automatically at most once per page load (a failure isn't retried in a loop).
const attempted = new Set<string>();

/**
 * Reads documents that haven't been checked yet, one at a time, and reports each updated row.
 * Only for reviewers; stops quietly if the database doesn't have the checks yet (migration 087 not run).
 */
export function useAutoScan(
  docs: { row: DocRow; url: string }[], enabled: boolean,
  ctxFor: (row: DocRow) => { profile: ScanProfile | null; academicYear: string | null }, onUpdated: (row: DocRow) => void,
) {
  const supabase = useMemo(() => createClient(), []);
  const [current, setCurrent] = useState<string | null>(null);
  const [queue, setQueue] = useState(0);
  const ctxRef = useRef(ctxFor);
  ctxRef.current = ctxFor;
  const updatedRef = useRef(onUpdated);
  updatedRef.current = onUpdated;
  const pending = docs.filter((d) => d.row && !d.row.scanned_at && !attempted.has(d.row.id));
  const key = pending.map((d) => d.row.id).join(",");

  useEffect(() => {
    if (!enabled || !pending.length) return;
    let cancelled = false;
    (async () => {
      const list = [...pending];
      setQueue(list.length);
      for (const d of list) {
        if (cancelled || attempted.has(d.row.id)) continue;
        attempted.add(d.row.id);
        setCurrent(d.row.id);
        try {
          const row = await scanAndSave(supabase, d.row, d.url, ctxRef.current(d.row));
          if (!cancelled && row) updatedRef.current(row);
        } catch (e) {
          // Without migration 087 every check fails the same way: stop trying.
          if (/record_document_scan|schema cache|function/i.test(String(e))) { list.forEach((x) => attempted.add(x.row.id)); break; }
        }
        setQueue((n) => Math.max(0, n - 1));
      }
      if (!cancelled) { setCurrent(null); setQueue(0); }
    })();
    return () => { cancelled = true; setCurrent(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { scanningId: current, remaining: queue };
}

// ── Viewer ──
type Compare = { label: string; url: string; mime: string | null } | null;

const fmtKind: Record<string, string> = {
  same_file: "Same file", same_control_no: "Same control number", similar_image: "Looks nearly identical", earlier_year: "Their own, earlier year",
};

function Zoomable({ url, mime, label }: { url: string; mime: string | null; label: string }) {
  return <FileView url={url} mime={mime} title={label} height="h-[60vh]" />;
}

export function DocumentViewer({
  doc, profile, academicYear, canReview, onClose, onUpdated,
}: {
  doc: { row: DocRow; url: string; studentName: string } | null;
  profile: ScanProfile | null; academicYear: string | null; canReview: boolean;
  onClose: () => void; onUpdated: (row: DocRow) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const row = doc?.row ?? null;
  const [matches, setMatches] = useState<{ kind: string; other_id: string; student_name: string | null; document_type: string; uploaded_at: string; distance: number | null; same_office: boolean }[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [compare, setCompare] = useState<Compare>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seenNote, setSeenNote] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [askWaive, setAskWaive] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    setMatches([]); setCompare(null); setSeenNote(""); setWaiveReason(""); setAskWaive(false);
    if (!row) return;
    supabase.rpc("document_matches", { _id: row.id }).then(({ data }) => setMatches(data ?? []));
    loadCheckRefs(supabase).then((r) => setSamples(r.samples.filter((s) => s.document_type === row.document_type)));
    fetch("/api/documents/ai-check").then((r) => r.json()).then((j) => setAiEnabled(!!j.enabled)).catch(() => setAiEnabled(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  // Open the best-matching sample, if the scan found one.
  const scan = (row?.scan ?? null) as unknown as ScanResult | null;
  useEffect(() => {
    if (!scan?.layout || compare) return;
    const s = samples.find((x) => x.id === scan.layout?.sampleId);
    if (s) showSample(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, scan?.layout?.sampleId]);

  if (!doc || !row) return null;
  const checks = (row.checks ?? null) as unknown as UploadChecks | null;
  const flags = row.flags ?? [];
  const high = flags.filter((f) => HIGH_FLAGS.includes(f));

  const refresh = async () => {
    const { data } = await supabase.from("documents").select("*").eq("id", row.id).single();
    if (data) onUpdated(data);
  };
  const act = async (name: string, fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
    setBusy(name);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast.error(error.message); return false; }
    toast.success(ok);
    await refresh();
    return true;
  };

  const showSample = async (s: Sample) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(s.storage_path, 3600);
    if (data?.signedUrl) setCompare({ label: `Genuine sample${s.place ? ` · ${s.place}` : ""}${s.label ? ` · ${s.label}` : ""}`, url: data.signedUrl, mime: s.mime_type ?? null });
  };
  const showMatch = async (m: (typeof matches)[number]) => {
    const { data: other } = await supabase.from("documents").select("storage_path, file_url, mime_type").eq("id", m.other_id).maybeSingle();
    const path = other?.storage_path ?? other?.file_url;
    if (!path) { toast.error("That document belongs to another office's applicant, so you can't open it here."); return; }
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    if (data?.signedUrl) setCompare({ label: `${m.student_name ?? "Another student"} · ${m.document_type}`, url: data.signedUrl, mime: other?.mime_type ?? null });
  };

  const rescan = async () => {
    setBusy("scan");
    try {
      const updated = await scanAndSave(supabase, row, doc.url, { profile, academicYear });
      if (updated) onUpdated(updated);
      toast.success("Checked again");
      supabase.rpc("document_matches", { _id: row.id }).then(({ data }) => setMatches(data ?? []));
    } catch (e) {
      toast.error("Couldn't check the document", { description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };

  const runAi = async () => {
    setBusy("ai");
    try {
      const raw = await (await fetch(doc.url)).blob();
      const img = await detectorImage(row.mime_type && raw.type !== row.mime_type ? new Blob([raw], { type: row.mime_type }) : raw);
      if (!img) throw new Error("Couldn't prepare the image");
      const form = new FormData();
      form.append("documentId", row.id);
      form.append("image", img, "document.jpg");
      const res = await fetch("/api/documents/ai-check", { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The detector failed");
      toast.success(`AI detector: ${Math.round(j.score * 100)}% likely AI`);
      await refresh();
    } catch (e) {
      toast.error("AI check failed", { description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };

  const t = scan?.text;
  const yesNo = (v: string | undefined, good: string) => (v ? (v === good ? <span className="text-emerald-700">{v.replace(/_/g, " ")}</span> : <span className="text-amber-700">{v.replace(/_/g, " ")}</span>) : "—");

  return (
    <AppDialog open onOpenChange={(o) => { if (!o) onClose(); }} size="2xl"
      title={`${row.document_type} · ${doc.studentName}`}
      description={`${row.file_name} · uploaded ${new Date(row.uploaded_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} · ${row.status}`}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge risk={documentRisk(flags)} />
          {!row.scanned_at && <span className="text-xs text-muted-foreground">Not checked yet</span>}
          {row.scanned_at && <span className="text-xs text-muted-foreground">Checked {new Date(row.scanned_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span>}
          {canReview && (
            <Button size="sm" variant="outline" className="ml-auto h-8" disabled={!!busy} onClick={rescan}>
              {busy === "scan" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Check again
            </Button>
          )}
          {canReview && aiEnabled && row.mime_type !== null && (
            <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={runAi}>
              {busy === "ai" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}AI detector{row.ai_score != null ? ` (${Math.round(Number(row.ai_score) * 100)}%)` : ""}
            </Button>
          )}
        </div>

        <div className={cn("grid gap-3", compare && "lg:grid-cols-2")}>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">This upload</p>
            <Zoomable url={doc.url} mime={row.mime_type} label={row.document_type} />
          </div>
          {compare && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold text-muted-foreground">{compare.label}</p>
                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setCompare(null)}>Hide</button>
              </div>
              <Zoomable url={compare.url} mime={compare.mime} label={compare.label} />
            </div>
          )}
        </div>

        {(samples.length > 0 || matches.length > 0) && (
          <DialogSection title="Compare with">
            <div className="flex flex-wrap gap-1.5">
              {samples.map((s) => (
                <Button key={s.id} size="sm" variant="outline" className="h-7 text-xs" onClick={() => showSample(s)}>
                  Sample{s.place ? ` · ${s.place}` : ""}{s.label ? ` · ${s.label}` : ""}
                </Button>
              ))}
              {matches.map((m) => (
                <Button key={m.other_id + m.kind} size="sm" variant="outline" className="h-7 border-red-200 text-xs text-red-700" onClick={() => showMatch(m)}>
                  {fmtKind[m.kind] ?? m.kind}: {m.student_name ?? "another student"}{!m.same_office ? " (other office)" : ""}
                </Button>
              ))}
            </div>
          </DialogSection>
        )}

        <DialogSection title={flags.length ? `Flags (${flags.length})` : "Flags"}>
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">{row.scanned_at ? "Nothing was flagged." : "The document hasn't been checked yet."}</p>
          ) : (
            <ul className="space-y-1.5">
              {flags.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span className={cn("mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", SEVERITY_TONE[flagInfo(f).severity])}>{flagInfo(f).severity}</span>
                  <span><span className="font-medium">{flagInfo(f).label}.</span> <span className="text-muted-foreground">{flagInfo(f).detail}</span></span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Flags point at things to look at closely. None of them proves a document is fake: confirm with the original or with whoever issued it.</p>
        </DialogSection>

        <DialogSection title="Original document">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">Ask for the original</p>
                <p className="text-xs text-muted-foreground">
                  {high.length ? "Turned on automatically because of a serious flag. " : ""}While on, the document can&apos;t be verified until someone records seeing the original.
                </p>
              </div>
              <Switch checked={row.needs_original} disabled={!canReview || !!busy}
                onCheckedChange={(on) => {
                  if (!on && high.length) { setAskWaive(true); return; }
                  act("needs", async () => supabase.rpc("set_needs_original", { _id: row.id, _needs: on }), on ? "The original is now required" : "The original is no longer required");
                }} />
            </div>
            {askWaive && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-900">This document has serious flags. Say why the original isn&apos;t needed (it is recorded in the audit log).</p>
                <Textarea rows={2} maxLength={500} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="For example: confirmed by phone with the barangay secretary" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!waiveReason.trim() || !!busy} onClick={async () => {
                    if (await act("needs", async () => supabase.rpc("set_needs_original", { _id: row.id, _needs: false, _reason: waiveReason.trim() }), "The original is no longer required")) setAskWaive(false);
                  }}>Don&apos;t require it</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAskWaive(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {row.original_seen_at ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <ShieldCheck className="h-4 w-4" />
                Original seen {new Date(row.original_seen_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}{row.original_note ? ` · ${row.original_note}` : ""}
                {canReview && <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={!!busy}
                  onClick={() => act("seen", async () => supabase.rpc("mark_original_seen", { _id: row.id, _seen: false }), "Original record removed")}>Undo</Button>}
              </div>
            ) : canReview && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={seenNote} maxLength={500} onChange={(e) => setSeenNote(e.target.value)} placeholder="Note (optional), e.g. matches, dry seal present" />
                <Button size="sm" variant="outline" className="shrink-0" disabled={!!busy}
                  onClick={() => act("seen", async () => supabase.rpc("mark_original_seen", { _id: row.id, _seen: true, _note: seenNote.trim() || null }), "Recorded: original seen")}>
                  I&apos;ve seen the original
                </Button>
              </div>
            )}
          </div>
        </DialogSection>

        {t && (
          <DialogSection title="Text on the document">
            <DetailGrid>
              {t.name && <Detail label="Student's name">{yesNo(t.name, "found")}</Detail>}
              {t.birthdate && <Detail label="Birthdate">{yesNo(t.birthdate, "match")}</Detail>}
              {t.school && <Detail label="School">{yesNo(t.school, "match")}</Detail>}
              {t.barangay && <Detail label="Barangay">{t.barangay.found.length ? t.barangay.found.join(", ") : "—"}{t.barangay.match === false && <span className="text-amber-700"> (not the student&apos;s)</span>}</Detail>}
              {t.grade !== undefined && <Detail label="Average">{t.grade ? `${t.grade.value} (${t.grade.scale})` : "Not found"}</Detail>}
              {t.issued !== undefined && <Detail label="Issued">{t.issued ?? "Not found"}</Detail>}
              {t.schoolYears && <Detail label="School year">{t.schoolYears.length ? t.schoolYears.join(", ") : "Not found"}</Detail>}
              {t.signatory && <Detail label="Signatory">{t.signatory.status === "on_file" ? <span className="text-emerald-700">{t.signatory.name} (on file)</span> : t.signatory.status === "former" ? <span className="text-red-700">{t.signatory.name} (former)</span> : <span className="text-amber-700">None on file found</span>}</Detail>}
              {t.controlNo && <Detail label="Control no.">{t.controlNo}</Detail>}
              {t.misspelled?.length ? <Detail label="Misspelled">{t.misspelled.join(", ")}</Detail> : null}
              <Detail label="Read quality">{t.confidence}% · {t.chars} characters</Detail>
            </DetailGrid>
            {scan?.excerpt && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Text that was read</summary>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">{scan.excerpt}</p>
              </details>
            )}
          </DialogSection>
        )}

        <DialogSection title="The file">
          <DetailGrid>
            <Detail label="Camera">{[checks?.meta?.make, checks?.meta?.model].filter(Boolean).join(" ") || (checks ? "None" : "—")}</Detail>
            <Detail label="Software">{checks?.meta?.software ?? scan?.meta?.software ?? "—"}</Detail>
            {(checks?.meta?.pdf ?? scan?.meta?.pdf) && (
              <Detail label="PDF made by" wide>
                {[(checks?.meta?.pdf ?? scan?.meta?.pdf)?.creator, (checks?.meta?.pdf ?? scan?.meta?.pdf)?.producer].filter(Boolean).join(" · ") || "—"}
                {(checks?.meta?.pdf ?? scan?.meta?.pdf)?.signed ? " · digitally signed" : ""}
              </Detail>
            )}
            {(checks?.meta?.aiLabel ?? scan?.meta?.aiLabel) && <Detail label="AI label" wide><span className="text-red-700">{checks?.meta?.aiLabel ?? scan?.meta?.aiLabel}</span></Detail>}
            {(checks?.meta?.width || scan?.meta?.width) && <Detail label="Original size">{checks?.meta?.width ? `${checks.meta.width} × ${checks.meta.height}` : `${scan?.meta?.width} × ${scan?.meta?.height} (stored copy)`}</Detail>}
            {checks?.meta?.taken && <Detail label="Taken">{checks.meta.taken}</Detail>}
            {scan?.quality?.blur != null && <Detail label="Blur">{Math.round(scan.quality.blur * 100)}%{scan.quality.blur > 0.2 ? " (blurry)" : " (sharp enough)"}</Detail>}
            {scan?.layout && <Detail label="Layout vs sample">{Math.round(scan.layout.similarity * 100)}% alike</Detail>}
            {scan?.location && <Detail label="Photo taken" wide>{scan.location.town ?? "Unknown place"}{scan.location.distanceKm != null ? ` · ${scan.location.distanceKm} km from the house pin` : ""}</Detail>}
            {row.ai_score != null && <Detail label="AI detector">{Math.round(Number(row.ai_score) * 100)}% likely AI</Detail>}
          </DetailGrid>
          {!checks && <p className="mt-2 text-xs text-muted-foreground">Uploaded before upload checks existed (or from another device): camera and editing details aren&apos;t available.</p>}
        </DialogSection>
        <p className="text-[11px] text-muted-foreground">Flags explained: {Object.keys(FLAG_INFO).length} checks run in the browser and the database. A high flag requires the original before the document can be verified.</p>
      </div>
    </AppDialog>
  );
}
