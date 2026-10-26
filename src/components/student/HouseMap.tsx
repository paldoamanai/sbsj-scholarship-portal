"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";

export type LatLng = { lat: number; lng: number };

// San Jose, Occidental Mindoro: where the map opens before a pin is placed.
const TOWN: LatLng = { lat: 12.3528, lng: 121.0676 };

function ClickToPin({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Keeps the pin in view when it moves from outside (e.g. "Use my location"). */
function FollowPin({ pin }: { pin: LatLng | null }) {
  const map = useMap();
  useEffect(() => { if (pin) map.setView(pin, Math.max(map.getZoom(), 17)); }, [map, pin]);
  return null;
}

/** A map the student taps to pin their house. Only ever loaded in the browser (next/dynamic, ssr: false). */
export default function HouseMap({ pin, onPick, readOnly = false }: { pin: LatLng | null; onPick?: (p: LatLng) => void; readOnly?: boolean }) {
  return (
    <MapContainer center={pin ?? TOWN} zoom={pin ? 17 : 14} className="h-64 w-full rounded-xl border z-0" scrollWheelZoom={!readOnly}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      {!readOnly && onPick && <ClickToPin onPick={onPick} />}
      <FollowPin pin={pin} />
      {pin && <CircleMarker center={pin} radius={10} pathOptions={{ color: "#c2410c", fillColor: "#f97316", fillOpacity: 0.8 }} />}
    </MapContainer>
  );
}

export const googleMapsLink = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
