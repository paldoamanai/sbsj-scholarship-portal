// One place for money and date formatting (the student pages used to define their own copies).

/** ₱1,234.50: thousands separators and always two decimals. */
export const pesoFixed = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ₱8.15M / ₱850K / ₱9,500: short enough for a stat card (pesoFixed gives the exact amount). */
export const pesoCompact = (n: number) =>
  Math.abs(n) >= 10_000
    ? `₱${new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`
    : `₱${Math.round(n).toLocaleString("en-PH")}`;

/** Like pesoFixed, but "—" when there is no amount. */
export const peso = (n: number | null | undefined) => (n == null ? "—" : pesoFixed(n));

/** "Mar 3, 2026" from a date ("2026-03-03") or a timestamp; `fallback` when empty. */
export function formatDate(d: string | null | undefined, fallback = "—"): string {
  if (!d) return fallback;
  return new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/** Whole days from now until the end of the given date (negative once it has passed). */
export const daysUntil = (d: string) => Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86_400_000);
