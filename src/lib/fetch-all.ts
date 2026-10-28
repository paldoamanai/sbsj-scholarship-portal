import type { PostgrestError } from "@supabase/supabase-js";

// Supabase returns at most 1000 rows per request, so a plain select quietly stops there.
const PAGE = 1000;

/** Every row of a query, fetched a page at a time. `page` builds the query for rows from..to (give it a stable order). */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
}
