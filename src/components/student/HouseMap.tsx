"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { TOWN, type LatLng } from "@/lib/geo";

function ClickToPin({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/**
 * Leaflet measures its container once. Inside a dialog that opens with a zoom animation it measures
 * mid-animation, which leaves grey tiles and an off-centre pin, so it re-measures whenever the
 * container's size changes.
 */
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const fit = () => map.invalidateSize();
    const t = setTimeout(fit, 250);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [map]);
  return null;
}

/** Moves the view to the pin when `focus` changes (opening, "Use my location"), not on every tap. */
function FocusPin({ pin, focus }: { pin: LatLng | null; focus: number }) {
  const map = useMap();
  useEffect(() => {
    if (pin) map.setView(pin, Math.max(map.getZoom(), 17));
    // Only `focus` decides when to move; following every tap would make the map jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus]);
  return null;
}

/** A map the student taps to pin their house. Only ever loaded in the browser (next/dynamic, ssr: false). */
export default function HouseMap({ pin, onPick, focus = 0, accuracy, readOnly = false, className = "h-64" }: {
  pin: LatLng | null;
  onPick?: (p: LatLng) => void;
  /** Bump to move the view to the pin. */
  focus?: number;
  /** Metres, from the phone's location: drawn as a circle around the pin. */
  accuracy?: number | null;
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <MapContainer center={pin ?? TOWN} zoom={pin ? 17 : 14} className={`${className} w-full rounded-xl border z-0`}
      scrollWheelZoom={!readOnly} dragging touchZoom doubleClickZoom={!readOnly}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      <KeepSized />
      {!readOnly && onPick && <ClickToPin onPick={onPick} />}
      <FocusPin pin={pin} focus={focus} />
      {pin && accuracy != null && accuracy > 0 && (
        <Circle center={pin} radius={accuracy} pathOptions={{ color: "#f97316", weight: 1, fillOpacity: 0.1 }} />
      )}
      {pin && <CircleMarker center={pin} radius={10} pathOptions={{ color: "#c2410c", weight: 3, fillColor: "#f97316", fillOpacity: 0.9 }} />}
    </MapContainer>
  );
}
