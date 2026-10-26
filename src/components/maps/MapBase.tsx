"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { LayerGroup, LayersControl, TileLayer, useMap } from "react-leaflet";

// Satellite first: many barangay houses aren't drawn on the street map, but their roofs show from above.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_CREDIT = "Imagery &copy; Esri, Maxar, Earthstar Geographics";
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Satellite (with place names and roads) or street map, switchable from the map's corner. */
export function BaseLayers() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Satellite">
        <LayerGroup>
          {/* Imagery stops at about zoom 18 here; Leaflet stretches it for the last levels. */}
          <TileLayer url={`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={18} maxZoom={20} attribution={ESRI_CREDIT} />
          <TileLayer url={`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={18} maxZoom={20} opacity={0.7} />
          <TileLayer url={`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={18} maxZoom={20} />
        </LayerGroup>
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Street map">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={20} attribution={OSM_CREDIT} />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

/**
 * Leaflet measures its container once. Inside a dialog that opens with a zoom animation it measures
 * mid-animation, which leaves grey tiles and an off-centre pin, so it re-measures whenever the
 * container's size changes (also on entering and leaving full screen).
 */
export function KeepSized() {
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

/** A wrapper whose map can go full screen (where the browser allows it, e.g. not iPhone Safari). */
export function FullscreenFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(typeof document !== "undefined" && !!document.fullscreenEnabled);
    const on = () => setFull(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen();
  };
  return (
    <div ref={ref} className={`relative ${full ? "bg-background" : ""} ${className ?? ""}`}>
      {children}
      {can && (
        <button type="button" onClick={toggle}
          className="absolute bottom-6 right-2 z-[1000] rounded-md border bg-white/95 px-2.5 py-1 text-xs font-semibold text-gray-800 shadow hover:bg-white">
          {full ? "Exit full screen" : "Full screen"}
        </button>
      )}
    </div>
  );
}
