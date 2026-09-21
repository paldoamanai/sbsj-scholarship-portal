"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Bell, Check, Circle, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Notification = Tables<"notifications">;

/** How many notifications a page holds, for the parent's first load and each "load more". */
export const NOTIFICATION_PAGE = 50;
const UNDO_MS = 6000;

const CATEGORY_LABELS: Record<string, string> = {
  application: "Applications",
  verification: "Verification",
  payment: "Payments",
  program: "Programs",
  account: "Account",
  system: "System",
};

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

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function bucket(iso: string) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : days < 31 ? "This month" : "Earlier";
}

const byNewest = (a: Notification, b: Notification) => b.created_at.localeCompare(a.created_at);
const merge = (list: Notification[], add: Notification[]) => {
  const seen = new Set(list.map((n) => n.id));
  return [...list, ...add.filter((n) => !seen.has(n.id))].sort(byNewest);
};

export default function NotificationInbox({
  notifications,
  setNotifications,
  onNavigate,
  userId,
  unreadTotal,
  onUnreadChange,
}: {
  notifications: Notification[];
  setNotifications: Dispatch<SetStateAction<Notification[]>>;
  onNavigate: (link: string) => void;
  userId: string;
  /** The true number of unread notifications (the list above may hold only the latest page). */
  unreadTotal: number;
  /** Called after a change that affects the unread count so the parent can refresh it. */
  onUnreadChange: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState("all");
  const [visible, setVisible] = useState(NOTIFICATION_PAGE);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── search (server-side, so it also finds older notifications) ──
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Notification[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim().replace(/[,()%*\\]/g, " ").trim();
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.from("notifications").select("*").eq("user_id", userId).eq("muted", false)
        .or(`title.ilike.%${q}%,message.ilike.%${q}%`).order("created_at", { ascending: false }).limit(100);
      setResults(data ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, userId, supabase]);

  const source = results ?? notifications;
  const filtered = useMemo(
    () => source.filter((n) => (!unreadOnly || !n.read) && (category === "all" || n.category === category)),
    [source, unreadOnly, category]
  );
  const shown = filtered.slice(0, visible);
  const hasMore = results === null && !exhausted && notifications.length >= NOTIFICATION_PAGE;
  const groups = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    shown.forEach((n) => {
      const label = bucket(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n); else out.push({ label, items: [n] });
    });
    return out;
  }, [shown]);

  const patchLocal = (ids: string[], patch: Partial<Notification>) => {
    const apply = (list: Notification[]) => list.map((n) => (ids.includes(n.id) ? { ...n, ...patch } : n));
    setNotifications(apply);
    setResults((r) => (r ? apply(r) : r));
  };

  const loadMore = async () => {
    if (filtered.length > visible) { setVisible((v) => v + NOTIFICATION_PAGE); return; }
    const oldest = notifications[notifications.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    const { data, error } = await supabase.from("notifications").select("*").eq("user_id", userId).eq("muted", false)
      .lt("created_at", oldest.created_at).order("created_at", { ascending: false }).limit(NOTIFICATION_PAGE);
    setLoadingMore(false);
    if (error) { toast.error(error.message); return; }
    if ((data ?? []).length < NOTIFICATION_PAGE) setExhausted(true);
    setNotifications((prev) => merge(prev, data ?? []));
    setVisible((v) => v + NOTIFICATION_PAGE);
  };

  // ── read state ──
  const setRead = async (n: Notification, read: boolean) => {
    patchLocal([n.id], { read });
    const { error } = await supabase.from("notifications").update({ read }).eq("id", n.id);
    if (error) { patchLocal([n.id], { read: !read }); toast.error(error.message); return; }
    onUnreadChange();
  };

  const open = async (n: Notification) => {
    if (!n.read) await setRead(n, true);
    if (n.link) onNavigate(n.link);
  };

  const markAllRead = async () => {
    // Marks every unread notification, not just the ones loaded here.
    const loadedUnread = notifications.filter((n) => !n.read).map((n) => n.id);
    patchLocal(loadedUnread, { read: true });
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
    if (error) { patchLocal(loadedUnread, { read: false }); toast.error(error.message); return; }
    onUnreadChange();
  };

  // ── selection ──
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };

  const markSelected = async (read: boolean) => {
    const ids = [...selected];
    patchLocal(ids, { read });
    const { error } = await supabase.from("notifications").update({ read }).in("id", ids);
    if (error) { patchLocal(ids, { read: !read }); toast.error(error.message); return; }
    onUnreadChange();
    stopSelecting();
  };

  // ── delete: hidden at once, really deleted after a few seconds unless undone ──
  const pending = useRef(new Map<string, { items: Notification[]; timer: ReturnType<typeof setTimeout> }>());

  const commitDelete = async (key: string) => {
    const entry = pending.current.get(key);
    if (!entry) return;
    pending.current.delete(key);
    const { error } = await supabase.from("notifications").delete().in("id", entry.items.map((n) => n.id));
    if (error) {
      toast.error("Could not delete", { description: error.message });
      setNotifications((prev) => merge(prev, entry.items));
    }
    onUnreadChange();
  };

  const removeMany = (items: Notification[]) => {
    if (items.length === 0) return;
    const ids = new Set(items.map((n) => n.id));
    setNotifications((prev) => prev.filter((n) => !ids.has(n.id)));
    setResults((r) => (r ? r.filter((n) => !ids.has(n.id)) : r));
    const key = `${Date.now()}-${items[0].id}`;
    const timer = setTimeout(() => commitDelete(key), UNDO_MS);
    pending.current.set(key, { items, timer });
    toast(items.length === 1 ? "Notification deleted" : `${items.length} notifications deleted`, {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const entry = pending.current.get(key);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.current.delete(key);
          setNotifications((prev) => merge(prev, entry.items));
        },
      },
    });
    onUnreadChange();
  };

  // Leaving the page shouldn't cancel a delete that was still waiting.
  useEffect(() => {
    const map = pending.current;
    return () => { [...map.keys()].forEach((k) => { const e = map.get(k); if (e) { clearTimeout(e.timer); commitDelete(k); } }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [confirmRead, setConfirmRead] = useState(false);
  const readCount = notifications.filter((n) => n.read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setVisible(NOTIFICATION_PAGE); }} placeholder="Search notifications" className="h-8 w-52 pl-8 text-xs" aria-label="Search notifications" />
          </div>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {[{ label: "All", v: false }, { label: `Unread${unreadTotal ? ` (${unreadTotal})` : ""}`, v: true }].map((t) => (
              <button key={t.label} type="button" onClick={() => { setUnreadOnly(t.v); setVisible(NOTIFICATION_PAGE); }}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${unreadOnly === t.v ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}>{t.label}</button>
            ))}
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setVisible(NOTIFICATION_PAGE); }}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selecting ? (
            <>
              <span className="self-center text-xs text-muted-foreground">{selected.size} selected</span>
              <Button variant="ghost" size="sm" className="text-xs" disabled={selected.size === 0} onClick={() => markSelected(true)}>Mark read</Button>
              <Button variant="ghost" size="sm" className="text-xs" disabled={selected.size === 0} onClick={() => markSelected(false)}>Mark unread</Button>
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" disabled={selected.size === 0}
                onClick={() => { removeMany(source.filter((n) => selected.has(n.id))); stopSelecting(); }}>Delete</Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={stopSelecting}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelecting(true)} disabled={source.length === 0}>Select</Button>
              <Button variant="ghost" size="sm" className="text-xs" disabled={unreadTotal === 0} onClick={markAllRead}>Mark all read</Button>
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" disabled={readCount === 0} onClick={() => setConfirmRead(true)}>Delete read</Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {searching && <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching…</div>}
          {shown.length === 0 && !searching && (
            <div className="text-center py-12">
              <Bell className="h-8 w-8 text-border mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {results !== null ? "No notifications match your search." : notifications.length === 0 ? "No notifications yet." : "Nothing matches these filters."}
              </p>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40 border-y border-border first:border-t-0">{g.label}</p>
              <div className="divide-y divide-border">
                {g.items.map((n) => {
                  const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
                  return (
                    <div key={n.id} className={`group flex items-start gap-3 px-5 py-4 transition-colors ${!n.read ? "bg-accent/60" : "hover:bg-muted/50"}`}>
                      {selecting && <Checkbox className="mt-3" checked={selected.has(n.id)} onCheckedChange={() => toggle(n.id)} aria-label={`Select ${n.title}`} />}
                      <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${style.bg}`}>
                        <Bell className={`h-4 w-4 ${style.fg}`} />
                      </div>
                      <button type="button" onClick={() => (selecting ? toggle(n.id) : open(n))} className={`flex-1 min-w-0 text-left ${n.link || selecting ? "cursor-pointer" : "cursor-default"}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{n.title}</p>
                          {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unread" />}
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">{CATEGORY_LABELS[n.category] ?? n.category}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                        {n.link && !selecting && <p className="text-xs text-primary mt-1">Open →</p>}
                      </button>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground" title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</span>
                        {!selecting && (
                          <div className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                            <Button size="icon" variant="ghost" className="h-7 w-7" title={n.read ? "Mark as unread" : "Mark as read"} onClick={() => setRead(n, !n.read)}>
                              {n.read ? <Circle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => removeMany([n])}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {(filtered.length > visible || hasMore) && (
        <div className="text-center">
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {filtered.length > visible ? `Load more (${filtered.length - visible} left)` : "Load older notifications"}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmRead} onOpenChange={setConfirmRead}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all read notifications?</AlertDialogTitle>
            <AlertDialogDescription>{readCount} read notification{readCount === 1 ? "" : "s"} will be deleted. You&apos;ll have a few seconds to undo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeMany(notifications.filter((n) => n.read))}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
