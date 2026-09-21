"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type Status = {
  cron_available: boolean; scheduled: boolean; schedule: string | null;
  last_run_at: string | null; last_ok_at: string | null; last_error: string | null; runs: number;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "never");

/** Whether the daily reminder job (deadlines, documents, receipts, cleanup) is scheduled and running. */
export default function ReminderJobsCard() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("notification_jobs_status");
    if (err) { setError(err.message); return; }
    setError(null);
    setStatus(data?.[0] ?? null);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    const { error: err } = await supabase.rpc("run_notification_jobs_now");
    setRunning(false);
    if (err) { toast.error("Could not run the reminders", { description: err.message }); return; }
    toast.success("Reminders ran");
    load();
  };

  const healthy = !!status && status.scheduled && !status.last_error && !!status.last_run_at;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily reminders</CardTitle>
        <CardDescription>Deadline, opening, document, profile, grade and receipt reminders, plus clean-up of old notifications.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">Couldn&apos;t read the status: {error}</p>}
        {status && (
          <>
            <div className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm ${healthy ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              {healthy ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
              <div>
                {!status.cron_available && <p><strong>The scheduler (pg_cron) isn&apos;t available</strong>, so reminders only go out when someone presses &quot;Run now&quot;. Enable the pg_cron extension in Supabase (Database → Extensions), then run the migration&apos;s schedule step again.</p>}
                {status.cron_available && !status.scheduled && <p><strong>Not scheduled.</strong> Run <code>SELECT cron.schedule(&apos;sbsj-reminders&apos;, &apos;0 1 * * *&apos;, &apos;SELECT public.send_scheduled_notifications()&apos;);</code> in the SQL editor.</p>}
                {status.scheduled && status.runs === 0 && <p>Scheduled ({status.schedule}), but it hasn&apos;t run yet. It runs daily at 9:00 AM Manila time.</p>}
                {status.scheduled && status.runs > 0 && !status.last_error && <p>Scheduled ({status.schedule}) and running normally.</p>}
                {status.last_error && <p><strong>The last run had errors:</strong> {status.last_error}</p>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Last run: {fmt(status.last_run_at)} · last clean run: {fmt(status.last_ok_at)} · {status.runs} run{status.runs === 1 ? "" : "s"} in total</p>
          </>
        )}
        <Button variant="outline" size="sm" onClick={runNow} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}Run now
        </Button>
        <p className="text-xs text-muted-foreground">Running it twice in a day won&apos;t duplicate anything: each reminder is sent at most once per period.</p>
      </CardContent>
    </Card>
  );
}
