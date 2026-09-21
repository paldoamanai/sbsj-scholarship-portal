"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

const AUDIENCES: Record<string, { label: string; hint: string }> = {
  all: { label: "All active students", hint: "Everyone with an active account" },
  scholars: { label: "Scholars", hint: "Students who have ever been approved" },
  applicants: { label: "Current applicants", hint: "Pending or waitlisted this year" },
  no_application: { label: "Not yet applied", hint: "No application this year" },
};

const LINKS: Record<string, string> = {
  none: "",
  application: "/student-dashboard?section=application",
  documents: "/student-dashboard?section=documents",
  profile: "/student-dashboard?section=profile",
  disbursement: "/student-dashboard?section=disbursement",
};
const LINK_LABELS: Record<string, string> = {
  none: "No link", application: "Application", documents: "Documents", profile: "Profile", disbursement: "Payments",
};

/** Send a message to a group of students (it arrives as a notification, and by email if they allow it). */
export default function AnnouncementsPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("all");
  const [link, setLink] = useState("none");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [recent, setRecent] = useState<Tables<"announcements">[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(8);
    setRecent(data ?? []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const valid = title.trim().length >= 3 && message.trim().length >= 3;

  const send = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("send_announcement", { _title: title, _message: message, _audience: audience, _link: LINKS[link] || null });
    setBusy(false);
    setConfirm(false);
    if (error) { toast.error("Could not send", { description: error.message }); return; }
    toast.success(`Sent to ${data} student${data === 1 ? "" : "s"}`);
    setTitle(""); setMessage(""); setLink("none");
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-4 w-4" />Send an announcement</CardTitle>
        <CardDescription>Students get it as a notification, and by email unless they turned those off.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Send to</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(AUDIENCES).map(([k, a]) => <SelectItem key={k} value={k}>{a.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{AUDIENCES[audience].hint}</p>
          </div>
          <div>
            <Label>Link the notification to</Label>
            <Select value={link} onValueChange={setLink}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(LINK_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Title</Label>
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Orientation moved to Friday" />
        </div>
        <div>
          <Label>Message</Label>
          <Textarea rows={4} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">{message.trim().length} / 1000</p>
        </div>
        <Button disabled={!valid || busy} onClick={() => setConfirm(true)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send announcement
        </Button>

        {recent.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Recently sent</p>
            <ul className="space-y-2">
              {recent.map((a) => (
                <li key={a.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium">{a.title}</span>
                    <span className="text-xs text-muted-foreground">{AUDIENCES[a.audience]?.label ?? a.audience} · {a.recipient_count} student{a.recipient_count === 1 ? "" : "s"} · {new Date(a.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{a.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes to <strong>{AUDIENCES[audience].label.toLowerCase()}</strong> straight away and can&apos;t be recalled. Students may also receive it by email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); send(); }}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
