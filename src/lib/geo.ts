// Map helpers that don't need Leaflet, so pages can use them without loading the map library.

export type LatLng = { lat: number; lng: number };

// San Jose, Occidental Mindoro: where the house map opens before a pin is placed.
export const TOWN: LatLng = { lat: 12.3528, lng: 121.0676 };
const PROVINCE = "Occidental Mindoro, Philippines";
// Search results are kept to Occidental Mindoro and the islands around it (lon/lat box).
const VIEWBOX = "120.2,13.6,121.6,11.8";

/** Straight-line distance in km. */
export function distanceKm(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const fmtDistance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

const at = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
export const googleMapsLink = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${at(p)}`;
/** Turn-by-turn directions from wherever the phone is. */
export const directionsLink = (p: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${at(p)}`;
export const streetViewLink = (p: LatLng) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at(p)}`;
/** Google Earth's 3D view looking down at an angle, where Google has 3D imagery. */
export const earthLink = (p: LatLng) => `https://earth.google.com/web/@${at(p)},60a,400d,35y,0h,55t,0r`;

// ── OpenStreetMap's Nominatim: place search and "what's here". Its usage policy allows light use from
// a browser (no search-as-you-type), so callers search on request and look up a pin once it settles.
type NominatimPlace = { lat: string; lon: string; display_name: string; address?: Record<string, string> };

export type Place = LatLng & { name: string };

export async function searchPlaces(query: string, near?: string): Promise<Place[]> {
  const q = [query.trim(), near, PROVINCE].filter(Boolean).join(", ");
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ph&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const rows = (await res.json()) as NominatimPlace[];
  return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), name: r.display_name }));
}

/** The barangay (village) and town a point is in, as OpenStreetMap knows them. */
export async function placeAt(p: LatLng): Promise<{ barangay: string | null; town: string | null } | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${p.lat}&lon=${p.lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const a = ((await res.json()) as NominatimPlace).address ?? {};
  return {
    barangay: a.village ?? a.quarter ?? a.suburb ?? a.hamlet ?? a.neighbourhood ?? null,
    town: a.town ?? a.city ?? a.municipality ?? null,
  };
}

const CENTER_CACHE = "sbsj-barangay-centers";
/** Where a barangay is, from OpenStreetMap, remembered in this browser. null if it can't be found. */
export async function barangayCenter(barangay: string | null | undefined, municipality: string | null | undefined): Promise<LatLng | null> {
  const b = barangay?.trim();
  if (!b) return null;
  const key = `${b}|${municipality ?? ""}`.toLowerCase();
  let cache: Record<string, LatLng | null> = {};
  try { cache = JSON.parse(localStorage.getItem(CENTER_CACHE) ?? "{}"); } catch { /* storage blocked */ }
  if (key in cache) return cache[key];
  try {
    const [hit] = await searchPlaces(b, municipality?.trim() || "San Jose");
    cache[key] = hit ? { lat: hit.lat, lng: hit.lng } : null;
    try { localStorage.setItem(CENTER_CACHE, JSON.stringify(cache)); } catch { /* storage blocked */ }
    return cache[key];
  } catch {
    return null;
  }
}

/** "Brgy. San Roque" and "San Roque" are the same barangay. */
export function samePlaceName(a: string | null | undefined, b: string | null | undefined) {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(barangay|brgy|bgy|poblacion|pob)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
  if (!a || !b) return true; // nothing to compare
  const x = norm(a), y = norm(b);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
}
