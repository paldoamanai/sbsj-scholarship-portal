/**
 * Barangays of San Jose, Occidental Mindoro: students pick from this list, and programs can be limited
 * to some of them. VERIFY against the official PSGC list before relying on it; add or rename entries
 * here only (existing profile values that aren't on the list are kept and still shown).
 */
export const HOME_MUNICIPALITY = "San Jose";

export const BARANGAYS = [
  "Bagong Sikat",
  "Bubog",
  "Camburay",
  "Caminawit",
  "Catayungan",
  "Central",
  "Iling Proper",
  "Inasakan",
  "Ipil",
  "La Curva",
  "Labangan Iling",
  "Labangan Poblacion",
  "Mabini",
  "Magbay",
  "Mangarin",
  "Mapaya",
  "Monte Claro",
  "Murtha",
  "Natandol",
  "Pag-Asa",
  "Pawican",
  "Poblacion I",
  "Poblacion II",
  "Poblacion III",
  "Poblacion IV",
  "Poblacion V",
  "Poblacion VI",
  "Poblacion VII",
  "Poblacion VIII",
  "San Agustin",
  "San Isidro",
  "San Roque",
] as const;

/** Lowercased, "Brgy."/"Barangay" prefix and punctuation dropped. Same as public.normalize_barangay(). */
export function normalizeBarangay(v: string | null | undefined): string {
  return (v ?? "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^(brgy|bgy|barangay) /, "");
}

/** Whether a student's barangay is one of the program's (an empty list means any barangay). */
export function inBarangays(mine: string | null | undefined, list: readonly string[] | null | undefined): boolean {
  if (!list || list.length === 0) return true;
  const m = normalizeBarangay(mine);
  return m !== "" && list.some((b) => normalizeBarangay(b) === m);
}

/** Whether the profile's municipality is San Jose (so the barangay comes from the list above). */
export const isHomeMunicipality = (municipality: string | null | undefined) => {
  const t = (municipality ?? "").split(",")[0].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^(municipality|town) of /, "");
  return t === "" || t === "san jose";
};
