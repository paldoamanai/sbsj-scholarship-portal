"use client";

import { useEffect } from "react";
import type { Map as LeafletMap } from "leaflet";
import { Circle, CircleMarker, MapContainer, useMap, useMapEvents } from "react-leaflet";
import { BaseLayers, FullscreenFrame, KeepSized } from "@/components/maps/MapBase";
import { TOWN, type LatLng } from "@/lib/geo";

function ClickToPin({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Hands the Leaflet map to the parent (to read its centre or move it). */
function Expose({ onReady }: { onReady?: (m: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => { onReady?.(map); }, [map, onReady]);
  return null;
}

/**
 * The house map: the student taps their house, or moves the map under the crosshair and uses "Pin at
 * the centre" (which also works from the keyboard: arrow keys pan, + and − zoom). Only ever loaded in
 * the browser (next/dynamic, ssr: false).
 */
export default function HouseMap({ pin, onPick, onReady, start, accuracy, readOnly = false, crosshair = false, className = "h-72 sm:h-80" }: {
  pin: LatLng | null;
  onPick?: (p: LatLng) => void;
  onReady?: (m: LeafletMap) => void;
  /** Where to open when there's no pin yet (e.g. the student's barangay). */
  start?: LatLng | null;
  /** Metres, from the phone's location: drawn as a circle around the pin. */
  accuracy?: number | null;
  readOnly?: boolean;
  crosshair?: boolean;
  className?: string;
}) {
  return (
    <FullscreenFrame className={`${className} w-full`}>
      <MapContainer center={pin ?? start ?? TOWN} zoom={pin ? 18 : start ? 16 : 14} className="h-full w-full rounded-xl border z-0"
        scrollWheelZoom={!readOnly} keyboard>
        <BaseLayers />
        <KeepSized />
        <Expose onReady={onReady} />
        {!readOnly && onPick && <ClickToPin onPick={onPick} />}
        {pin && accuracy != null && accuracy > 0 && (
          <Circle center={pin} radius={accuracy} pathOptions={{ color: "#f97316", weight: 1, fillOpacity: 0.1 }} />
        )}
        {pin && <CircleMarker center={pin} radius={10} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#ea580c", fillOpacity: 1 }} />}
      </MapContainer>
      {crosshair && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <div className="relative h-8 w-8">
            <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute top-1/2 left-0 h-0.5 w-full -translate-y-1/2 bg-white shadow-[0_0_2px_#000]" />
          </div>
        </div>
      )}
    </FullscreenFrame>
  );
}
