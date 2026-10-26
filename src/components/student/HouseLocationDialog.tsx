"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppDialog, DialogField } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import type { LatLng } from "@/components/student/HouseMap";

const HouseMap = dynamic(() => import("@/components/student/HouseMap"), {
  ssr: false,
  loading: () => <div className="h-64 w-full rounded-xl border bg-muted animate-pulse" />,
});

type Saved = { home_lat: number | null; home_lng: number | null; home_landmark: string | null };

/** Pins the student's house on a map with a nearby landmark (profiles.home_*, migration 071). */
export default function HouseLocationDialog({ open, onOpenChange, userId, saved, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  saved: Saved | null;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState<LatLng | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin(saved?.home_lat != null && saved.home_lng != null ? { lat: saved.home_lat, lng: saved.home_lng } : null);
    setLandmark(saved?.home_landmark ?? "");
  }, [open, saved]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error("This browser can't share your location. Tap your house on the map instead."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { setLocating(false); toast.error("Couldn't get your location. Allow location access, or tap your house on the map."); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async () => {
    if (!pin) return;
    setSaving(true);
    const { error } = await createClient().from("profiles")
      .update({ home_lat: pin.lat, home_lng: pin.lng, home_landmark: landmark.trim() || null }).eq("id", userId);
    setSaving(false);
    if (error) { toast.error("Couldn't save your house location", { description: error.message }); return; }
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
        <Button className="rounded-xl" disabled={!pin || saving} onClick={save}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save location
        </Button>
      </>}>
      <Button type="button" variant="outline" className="rounded-xl w-full sm:w-auto" disabled={locating} onClick={useMyLocation}>
        {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}Use my location
      </Button>
      {open && <HouseMap pin={pin} onPick={setPin} />}
      <p className="text-xs text-muted-foreground">{pin ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}. Tap again to move it.` : "No pin yet."}</p>
      <DialogField label="Nearby landmark" htmlFor="house-landmark" hint="Something the office can look for, e.g. “Blue gate across the chapel, Purok 3”.">
        <Input id="house-landmark" value={landmark} maxLength={200} onChange={(e) => setLandmark(e.target.value)} className="rounded-xl" />
      </DialogField>
    </AppDialog>
  );
}
