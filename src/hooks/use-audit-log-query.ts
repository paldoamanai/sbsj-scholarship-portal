import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/integrations/supabase/types";

export type AuditFilters = {
  search: string; action: string; entity: string; user: string;
  /** yyyy-mm-dd, local time; "" for no bound. */
  from: string; to: string;
};

// Exports page through every matching entry; stop here so a huge range can't hang the browser.
export const AUDIT_EXPORT_CAP = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function applyFilters<Q extends {
  eq: (c: string, v: string) => Q; gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q; or: (f: string) => Q;
}>(q: Q, f: AuditFilters): Q {
  if (f.action !== "all") q = q.eq("action", f.action);
  if (f.entity !== "all") q = q.eq("entity_type", f.entity);
  if (f.user !== "all") q = q.eq("user_id", f.user);
  if (f.from) q = q.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) q = q.lte("created_at", new Date(`${f.to}T23:59:59.999`).toISOString());
  const s = f.search.trim();
  if (UUID_RE.test(s)) {
    // An id: the record that was changed, or the person who changed it.
    q = q.or(`entity_id.eq.${s},user_id.eq.${s}`);
  } else if (s) {
    // Safe inside a PostgREST or() filter and a LIKE pattern.
    const term = s.replace(/[,()"]/g, "").replace(/[\\%_]/g, "\\$&");
    if (term) q = q.or(`user_email.ilike.*${term}*,action.ilike.*${term}*,entity_type.ilike.*${term}*`);
  }
  return q;
}

/**
 * One page of the audit log, filtered in the database, so the whole history can be browsed and
 * searched rather than only the entries the admin page loads up front.
 */
export function useAuditLogQuery(supabase: SupabaseClient<Database>, filters: AuditFilters, page: number, pageSize: number, enabled: boolean) {
  const [rows, setRows] = useState<Tables<"audit_logs">[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { search, action, entity, user, from, to } = filters;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    // Wait for typing to pause before searching.
    const timer = setTimeout(async () => {
      const start = (page - 1) * pageSize;
      const q = applyFilters(
        supabase.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }),
        { search, action, entity, user, from, to },
      ).range(start, start + pageSize - 1);
      const { data, count: total, error: err } = await q;
      if (cancelled) return;
      setError(err?.message ?? null);
      setRows(data ?? []);
      setCount(total ?? 0);
      setLoading(false);
    }, search ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [supabase, search, action, entity, user, from, to, page, pageSize, enabled]);

  /** Every matching entry (up to AUDIT_EXPORT_CAP), for exports. */
  const fetchAll = useCallback(async () => {
    const all: Tables<"audit_logs">[] = [];
    let truncated = false;
    for (let start = 0; ; start += 1000) {
      const { data, error: err } = await applyFilters(
        supabase.from("audit_logs").select("*").order("created_at", { ascending: false }),
        { search, action, entity, user, from, to },
      ).range(start, start + 999);
      if (err) throw new Error(err.message);
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
      if (all.length >= AUDIT_EXPORT_CAP) { truncated = true; break; }
    }
    return { rows: all, truncated };
  }, [supabase, search, action, entity, user, from, to]);

  return { rows, count, loading, error, fetchAll };
}
