// Map helpers that don't need Leaflet, so pages can use them without loading the map library.

export type LatLng = { lat: number; lng: number };

// San Jose, Occidental Mindoro: where the house map opens before a pin is placed.
export const TOWN: LatLng = { lat: 12.3528, lng: 121.0676 };

/** Straight-line distance in km. */
export function distanceKm(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const googleMapsLink = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
