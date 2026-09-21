"use client";

import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Bell, Check, Circle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Notification = Tables<"notifications">;

const CATEGORY_LABELS: Record<string, string> = {
  application: "Applications",
  verification: "Verification",
  payment: "Payments",
  program: "Programs",
  account: "Account",
  system: "System",
};

const PAGE_SIZE = 20;

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

const TYPE_STYLES: Record<string, { bg: string; fg: string }> = {
  success: { bg: "bg-emerald-100", fg: "text-emerald-600" },
  warning: { bg: "bg-amber-100", fg: "text-amber-600" },
  error: { bg: "bg-red-100", fg: "text-red-600" },
  info: { bg: "bg-accent", fg: "text-primary" },
};

export default function NotificationInbox({
  notifications,
  setNotifications,
  onNavigate,
}: {
  notifications: Notification[];
  setNotifications: Dispatch<SetStateAction<Notification[]>>;
  onNavigate: (link: string) => void;
}) {
  const supabase = createClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const categories = useMemo(() => [...new Set(notifications.map((n) => n.category))].sort(), [notifications]);
  const filtered = useMemo(
    () => notifications.filter((n) => (!unreadOnly || !n.read) && (category === "all" || n.category === category)),
    [notifications, unreadOnly, category]
  );
  const unread = notifications.filter((n) => !n.read).length;
  const shown = filtered.slice(0, visible);

  const patchLocal = (ids: string[], patch: Partial<Notification>) =>
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, ...patch } : n)));

  const setRead = async (n: Notification, read: boolean) => {
    patchLocal([n.id], { read });
    const { error } = await supabase.from("notifications").update({ read }).eq("id", n.id);
    if (error) { patchLocal([n.id], { read: !read }); toast.error(error.message); }
  };

  const open = async (n: Notification) => {
    if (!n.read) await setRead(n, true);
    if (n.link) onNavigate(n.link);
  };

  const remove = async (n: Notification) => {
    const { error } = await supabase.from("notifications").delete().eq("id", n.id);
    if (error) { toast.error(error.message); return; }
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
  };

  const markAllRead = async () => {
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    patchLocal(ids, { read: true });
    const { error } = await supabase.from("notifications").update({ read: true }).in("id", ids);
    if (error) { patchLocal(ids, { read: false }); toast.error(error.message); }
  };

  const deleteRead = async () => {
    const ids = notifications.filter((n) => n.read).map((n) => n.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from("notifications").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    setNotifications((prev) => prev.filter((n) => !n.read));
    toast.success(`Deleted ${ids.length} read notification${ids.length === 1 ? "" : "s"}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {[{ label: "All", v: false }, { label: `Unread${unread ? ` (${unread})` : ""}`, v: true }].map((t) => (
              <button key={t.label} type="button" onClick={() => { setUnreadOnly(t.v); setVisible(PAGE_SIZE); }}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${unreadOnly === t.v ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}>{t.label}</button>
            ))}
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setVisible(PAGE_SIZE); }}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="text-xs" disabled={unread === 0} onClick={markAllRead}>Mark all read</Button>
          <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" disabled={!notifications.some((n) => n.read)} onClick={deleteRead}>Delete read</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {shown.length === 0 && (
            <div className="text-center py-12">
              <Bell className="h-8 w-8 text-border mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{notifications.length === 0 ? "No notifications yet." : "Nothing matches these filters."}</p>
            </div>
          )}
          {shown.map((n) => {
            const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
            return (
              <div key={n.id} className={`group flex items-start gap-3 px-5 py-4 transition-colors ${!n.read ? "bg-accent/60" : "hover:bg-muted/50"}`}>
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${style.bg}`}>
                  <Bell className={`h-4 w-4 ${style.fg}`} />
                </div>
                <button type="button" onClick={() => open(n)} className={`flex-1 min-w-0 text-left ${n.link ? "cursor-pointer" : "cursor-default"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{n.title}</p>
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">{CATEGORY_LABELS[n.category] ?? n.category}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                  {n.link && <p className="text-xs text-primary mt-1">Open →</p>}
                </button>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground" title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</span>
                  <div className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={n.read ? "Mark as unread" : "Mark as read"} onClick={() => setRead(n, !n.read)}>
                      {n.read ? <Circle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => remove(n)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {filtered.length > visible && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>Load more ({filtered.length - visible} left)</Button>
        </div>
      )}
    </div>
  );
}
