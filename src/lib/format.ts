// One place for money and date formatting (the student pages used to define their own copies).

/** ₱1,234.50: thousands separators and always two decimals. */
export const pesoFixed = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Like pesoFixed, but "—" when there is no amount. */
export const peso = (n: number | null | undefined) => (n == null ? "—" : pesoFixed(n));

/** "Mar 3, 2026" from a date ("2026-03-03") or a timestamp; `fallback` when empty. */
export function formatDate(d: string | null | undefined, fallback = "—"): string {
  if (!d) return fallback;
  return new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/** Whole days from now until the end of the given date (negative once it has passed). */
export const daysUntil = (d: string) => Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86_400_000);
