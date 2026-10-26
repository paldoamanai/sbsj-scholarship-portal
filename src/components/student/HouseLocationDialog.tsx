"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppDialog, DialogField } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, MapPin } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { TOWN, distanceKm, type LatLng } from "@/lib/geo";

const HouseMap = dynamic(() => import("@/components/student/HouseMap"), {
  ssr: false,
  loading: () => <div className="h-64 w-full rounded-xl border bg-muted animate-pulse" />,
});

type Saved = { home_lat: number | null; home_lng: number | null; home_landmark: string | null };

const MIN_LANDMARK = 3;
// Farther than this from the town centre is probably a mis-tap or a laptop's rough location.
const FAR_KM = 30;
// A phone fix less precise than this may be the wrong house.
const ROUGH_M = 100;

function locationError(e: GeolocationPositionError) {
  if (e.code === e.PERMISSION_DENIED) return "Location access is blocked. Allow it for this site in your browser settings, or tap your house on the map.";
  if (e.code === e.TIMEOUT) return "Finding your location took too long. Try again outside or near a window, or tap your house on the map.";
  return "Your location isn't available right now. Turn on your phone's location (GPS), or tap your house on the map.";
}

/** Pins the student's house on a map with a nearby landmark (profiles.home_*, migration 071). */
export default function HouseLocationDialog({ open, onOpenChange, userId, saved, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  saved: Saved | null;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Start from what's saved each time the dialog opens. Not on later profile refreshes, which would
  // throw away a pin the student is still placing.
  useEffect(() => {
    if (!open) return;
    const s = savedRef.current;
    setPin(s?.home_lat != null && s.home_lng != null ? { lat: s.home_lat, lng: s.home_lng } : null);
    setLandmark(s?.home_landmark ?? "");
    setAccuracy(null);
    setFocus((f) => f + 1);
  }, [open]);

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
        setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAccuracy(Math.round(pos.coords.accuracy));
        setFocus((f) => f + 1);
      },
      (e) => { setLocating(false); toast.error(locationError(e)); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const far = pin ? distanceKm(pin, TOWN) > FAR_KM : false;
  const rough = accuracy != null && accuracy > ROUGH_M;
  const landmarkOk = landmark.trim().length >= MIN_LANDMARK;

  const save = async () => {
    if (!pin || !landmarkOk) return;
    setSaving(true);
    const { data, error } = await createClient().from("profiles")
      .update({ home_lat: pin.lat, home_lng: pin.lng, home_landmark: landmark.trim() })
      .eq("id", userId).select("id");
    setSaving(false);
    if (error) {
      const missing = /home_(lat|lng|landmark)/.test(error.message) && /column|schema cache/i.test(error.message);
      toast.error("Couldn't save your house location", {
        description: missing ? "House locations aren't switched on yet. Please try again later or contact the office." : error.message,
      });
      return;
    }
    if (!data?.length) { toast.error("Couldn't save your house location", { description: "Please log in again and retry." }); return; }
    toast.success("House location saved");
    onOpenChange(false);
    onSaved();
  };

  return (
    <AppDialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }} size="md" className="rounded-2xl"
      title="Pin your house on the map"
      description="Tap your house on the map, or use your phone's location while you're at home. The office uses this to find your house for the home visit."
      footer={<>
        <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="rounded-xl" disabled={!pin || !landmarkOk || saving} onClick={save}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save location
        </Button>
      </>}>
      <Button type="button" variant="outline" className="rounded-xl w-full sm:w-auto" disabled={locating} onClick={useMyLocation}>
        {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
        {locating ? "Finding you…" : "Use my location"}
      </Button>
      {open && <HouseMap pin={pin} onPick={pick} focus={focus} accuracy={accuracy} />}
      <p className="text-xs text-muted-foreground">
        {pin
          ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${accuracy != null ? ` (accurate to about ${accuracy} m)` : ""}. Tap the map to move it; pinch or use + and − to zoom.`
          : "No pin yet. Zoom in until you can see your street, then tap your house."}
      </p>
      {(far || rough) && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {far
            ? "This pin is far from San Jose. Check that it's on your house, and move it if not."
            : "Your phone's location is rough here. Zoom in and tap your exact house to be sure."}
        </p>
      )}
      <DialogField label="Nearby landmark *" htmlFor="house-landmark" hint="Something the office can look for, e.g. “Blue gate across the chapel, Purok 3”.">
        <Input id="house-landmark" value={landmark} maxLength={200} onChange={(e) => setLandmark(e.target.value)} className="rounded-xl" />
      </DialogField>
    </AppDialog>
  );
}
