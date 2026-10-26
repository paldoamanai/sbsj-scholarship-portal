"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { toast } from "sonner";
import { AppDialog, DialogField } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, MapPin, Search, Trash2 } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import {
  TOWN, barangayCenter, distanceKm, fmtDistance, placeAt, samePlaceName, searchPlaces, type LatLng, type Place,
} from "@/lib/geo";

const HouseMap = dynamic(() => import("@/components/student/HouseMap"), {
  ssr: false,
  loading: () => <div className="h-72 sm:h-80 w-full rounded-xl border bg-muted animate-pulse" />,
});

type Saved = { home_lat: number | null; home_lng: number | null; home_landmark: string | null };

const MIN_LANDMARK = 3;
// Farther than this from the town centre is probably a mis-tap or a laptop's rough location.
const FAR_KM = 30;
// A phone fix less precise than this may be the wrong house.
const ROUGH_M = 100;
// Farther than this from the barangay's centre is probably another barangay.
const BARANGAY_KM = 3;
// A house photo taken farther than this from the pin is worth a second look.
const PHOTO_KM = 0.3;

function locationError(e: GeolocationPositionError) {
  if (e.code === e.PERMISSION_DENIED) return "Location access is blocked. Allow it for this site in your browser settings, or tap your house on the map.";
  if (e.code === e.TIMEOUT) return "Finding your location took too long. Try again outside or near a window, or tap your house on the map.";
  return "Your location isn't available right now. Turn on your phone's location (GPS), or tap your house on the map.";
}

/** Pins the student's house on a map with a nearby landmark (profiles.home_*, migrations 071 and 076). */
export default function HouseLocationDialog({ open, onOpenChange, userId, saved, barangay, municipality, photoSpot, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  saved: Saved | null;
  /** From the profile: where the map opens, and what the pin is checked against. */
  barangay?: string | null;
  municipality?: string | null;
  /** Where the house photo was taken, when the phone kept that in the photo. */
  photoSpot?: LatLng | null;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [place, setPlace] = useState<{ barangay: string | null; town: string | null } | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const onReady = useCallback((m: LeafletMap) => { mapRef.current = m; }, []);
  const goTo = (p: LatLng, zoom = 18) => mapRef.current?.setView(p, Math.max(mapRef.current.getZoom(), zoom));

  // Start from what's saved each time the dialog opens; not on later profile refreshes, which would
  // throw away a pin the student is still placing. Without a pin, open on their barangay.
  useEffect(() => {
    if (!open) return;
    const s = savedRef.current;
    const p = s?.home_lat != null && s.home_lng != null ? { lat: s.home_lat, lng: s.home_lng } : null;
    setPin(p);
    setLandmark(s?.home_landmark ?? "");
    setAccuracy(null);
    setResults(null);
    setQuery("");
    let live = true;
    void barangayCenter(barangay, municipality).then((c) => {
      if (!live) return;
      setCenter(c);
      if (c && !p) setTimeout(() => mapRef.current?.setView(c, 16), 300);
    });
    return () => { live = false; };
  }, [open, barangay, municipality]);

  // What OpenStreetMap calls the place under the pin, looked up once the pin settles.
  useEffect(() => {
    setPlace(null);
    if (!pin) return;
    let live = true;
    const t = setTimeout(() => { void placeAt(pin).then((r) => { if (live) setPlace(r); }).catch(() => {}); }, 900);
    return () => { live = false; clearTimeout(t); };
  }, [pin]);

  const pick = (p: LatLng) => { setPin(p); setAccuracy(null); };

  const useMyLocation = () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      toast.error("This browser can't share your location. Tap your house on the map instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPin(p);
        setAccuracy(Math.round(pos.coords.accuracy));
        goTo(p);
      },
      (e) => { setLocating(false); toast.error(locationError(e)); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const found = await searchPlaces(query, municipality?.trim() || "San Jose");
      setResults(found);
      if (found.length === 1) { goTo(found[0], 17); setResults(null); }
    } catch {
      toast.error("Search isn't working right now. Move the map to your house instead.");
    } finally {
      setSearching(false);
    }
  };

  const pinAtCentre = () => {
    const c = mapRef.current?.getCenter();
    if (c) pick({ lat: c.lat, lng: c.lng });
  };

  // ── Checks (warnings only: the office decides) ──
  const far = pin ? distanceKm(pin, TOWN) > FAR_KM : false;
  const rough = accuracy != null && accuracy > ROUGH_M;
  const fromBarangay = pin && center ? distanceKm(pin, center) : null;
  const otherBarangay = !!place?.barangay && !!barangay && !samePlaceName(place.barangay, barangay);
  const otherTown = !!place?.town && !!municipality && !samePlaceName(place.town, municipality);
  const fromPhoto = pin && photoSpot ? distanceKm(pin, photoSpot) : null;
  const warnings = [
    far && "This pin is far from San Jose. Check that it's on your house, and move it if not.",
    !far && otherTown && `This pin looks like it's in ${place!.town}, but your profile says ${municipality}.`,
    !far && !otherTown && otherBarangay && `This pin looks like it's in ${place!.barangay}, but your profile says barangay ${barangay}.`,
    !far && !otherBarangay && fromBarangay != null && fromBarangay > BARANGAY_KM && `This pin is ${fmtDistance(fromBarangay)} from the centre of barangay ${barangay}. Check that it's on your house.`,
    fromPhoto != null && fromPhoto > PHOTO_KM && `Your house photo was taken ${fmtDistance(fromPhoto)} from this pin. If the photo was taken at home, move the pin there.`,
    rough && "Your phone's location is rough here. Zoom in and tap your exact house to be sure.",
  ].filter((w): w is string => !!w);
  const landmarkOk = landmark.trim().length >= MIN_LANDMARK;

  const write = async (values: Saved) => {
    const { data, error } = await createClient().from("profiles").update(values).eq("id", userId).select("id");
    if (error) {
      const missing = /home_(lat|lng|landmark)/.test(error.message) && /column|schema cache/i.test(error.message);
      toast.error("Couldn't save your house location", {
        description: missing ? "House locations aren't switched on yet. Please try again later or contact the office." : error.message,
      });
      return false;
    }
    if (!data?.length) { toast.error("Couldn't save your house location", { description: "Please log in again and retry." }); return false; }
    return true;
  };

  const save = async () => {
    if (!pin || !landmarkOk) return;
    setSaving(true);
    const ok = await write({ home_lat: pin.lat, home_lng: pin.lng, home_landmark: landmark.trim() });
    setSaving(false);
    if (!ok) return;
    toast.success("House location saved");
    onOpenChange(false);
    onSaved();
  };

  const remove = async () => {
    setSaving(true);
    const ok = await write({ home_lat: null, home_lng: null, home_landmark: null });
    setSaving(false);
    if (!ok) return;
    toast.success("House pin removed");
    onOpenChange(false);
    onSaved();
  };

  const hasSaved = saved?.home_lat != null;

  return (
    <AppDialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }} size="lg" className="rounded-2xl"
      title="Pin your house on the map"
      description="Find your house on the satellite map and tap its roof, or use your phone's location while you're at home. The office uses this to find your house for the home visit."
      footer={<>
        {hasSaved && (
          <Button variant="ghost" className="rounded-xl mr-auto text-red-600 hover:text-red-700" disabled={saving} onClick={remove}>
            <Trash2 className="mr-2 h-4 w-4" />Remove pin
          </Button>
        )}
        <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="rounded-xl" disabled={!pin || !landmarkOk || saving} onClick={save}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save location
        </Button>
      </>}>
      <form onSubmit={search} className="flex gap-2">
        <Input value={query} onChange={(e) => { setQuery(e.target.value); setResults(null); }} placeholder="Search a place, e.g. a school, chapel or purok"
          aria-label="Search the map" className="rounded-xl" />
        <Button type="submit" variant="outline" className="rounded-xl shrink-0" disabled={searching || query.trim().length < 2}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}<span className="sr-only sm:not-sr-only sm:ml-2">Search</span>
        </Button>
      </form>
      {results && (
        results.length === 0 ? <p className="text-xs text-muted-foreground">Nothing found. Try another name, or move the map yourself.</p> : (
          <ul className="max-h-40 overflow-y-auto rounded-xl border divide-y text-sm">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { goTo(r, 17); setResults(null); }}>{r.name}</button>
              </li>
            ))}
          </ul>
        )
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled={locating} onClick={useMyLocation}>
          {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
          {locating ? "Finding you…" : "Use my location"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={pinAtCentre}>Pin at the centre (+)</Button>
        {photoSpot && (
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => { pick(photoSpot); goTo(photoSpot); }}>
            Use where the house photo was taken
          </Button>
        )}
      </div>

      {open && <HouseMap pin={pin} onPick={pick} onReady={onReady} start={center} accuracy={accuracy} crosshair />}
      <p className="text-xs text-muted-foreground">
        {pin
          ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${accuracy != null ? ` (accurate to about ${accuracy} m)` : ""}${place?.barangay ? ` · looks like ${place.barangay}` : ""}. Tap the map to move it.`
          : "No pin yet. Zoom in until you can see your roof, then tap it, or put it under the + and use “Pin at the centre”."}
        {" "}Switch between satellite and street map from the map&apos;s corner.
      </p>
      {warnings.length > 0 && (
        <div className="space-y-1.5">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w}
            </p>
          ))}
        </div>
      )}
      <DialogField label="Nearby landmark *" htmlFor="house-landmark" hint="Something the office can look for, e.g. “Blue gate across the chapel, Purok 3”.">
        <Input id="house-landmark" value={landmark} maxLength={200} onChange={(e) => setLandmark(e.target.value)} className="rounded-xl" />
      </DialogField>
    </AppDialog>
  );
}
