"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, useMap } from "react-leaflet";
import { BaseLayers, FullscreenFrame, KeepSized } from "@/components/maps/MapBase";
import { TOWN, directionsLink, type LatLng } from "@/lib/geo";

export type VisitPoint = LatLng & { id: string; name: string; detail: string; status: "done" | "scheduled" | "none" };

const COLOR: Record<VisitPoint["status"], string> = { done: "#16a34a", scheduled: "#2563eb", none: "#ea580c" };

function FitAll({ points }: { points: VisitPoint[] }) {
  const map = useMap();
  const key = points.map((p) => p.id).join(",");
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 16);
    else if (points.length > 1) map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [30, 30], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Every pinned applicant's house, coloured by home visit status. Browser only (next/dynamic). */
export default function VisitsMap({ points, onOpen }: { points: VisitPoint[]; onOpen: (id: string) => void }) {
  return (
    <FullscreenFrame className="h-[28rem] w-full">
      <MapContainer center={TOWN} zoom={12} className="h-full w-full rounded-xl border z-0">
        <BaseLayers />
        <KeepSized />
        <FitAll points={points} />
        {points.map((p) => (
          <CircleMarker key={p.id} center={p} radius={9} pathOptions={{ color: "#ffffff", weight: 2, fillColor: COLOR[p.status], fillOpacity: 1 }}>
            <Popup>
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs">{p.detail}</p>
              <p className="mt-1 flex gap-3 text-xs">
                <button type="button" className="font-semibold text-blue-700 underline" onClick={() => onOpen(p.id)}>Open application</button>
                <a href={directionsLink(p)} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Directions</a>
              </p>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </FullscreenFrame>
  );
}
