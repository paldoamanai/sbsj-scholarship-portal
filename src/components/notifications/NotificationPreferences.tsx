"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";

type Category = { key: "application" | "verification" | "payment" | "program"; label: string; hint: string };
type Pref = { in_app: boolean; email: boolean };

export default function NotificationPreferences({ userId, categories }: { userId: string; categories: Category[] }) {
  const supabase = createClient();
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase.from("notification_preferences").select("*").eq("user_id", userId).then(({ data }) => {
      const next: Record<string, Pref> = {};
      (data ?? []).forEach((r) => { next[r.category] = { in_app: r.in_app, email: r.email }; });
      setPrefs(next);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const get = (key: string): Pref => prefs[key] ?? { in_app: true, email: true };

  const update = async (key: string, patch: Partial<Pref>) => {
    const next = { ...get(key), ...patch };
    setPrefs((p) => ({ ...p, [key]: next }));
    const { error } = await supabase.from("notification_preferences").upsert({ user_id: userId, category: key, ...next });
    if (error) {
      setPrefs((p) => ({ ...p, [key]: get(key) }));
      toast.error("Could not save preference", { description: error.message });
    }
  };

  return (
    <div>
      <div className="grid grid-cols-[1fr_64px_64px] gap-3 pb-2 text-xs font-medium text-muted-foreground border-b border-border">
        <span>Notify me about</span><span className="text-center">In-app</span><span className="text-center">Email</span>
      </div>
      {categories.map((c) => (
        <div key={c.key} className="grid grid-cols-[1fr_64px_64px] gap-3 items-center py-3 border-b border-border last:border-0">
          <div><p className="text-sm font-medium">{c.label}</p><p className="text-xs text-muted-foreground">{c.hint}</p></div>
          <div className="flex justify-center"><Switch disabled={!loaded} checked={get(c.key).in_app} onCheckedChange={(v) => update(c.key, { in_app: v })} /></div>
          <div className="flex justify-center"><Switch disabled={!loaded} checked={get(c.key).email} onCheckedChange={(v) => update(c.key, { email: v })} /></div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground pt-3">Account and system notices are always delivered.</p>
    </div>
  );
}
