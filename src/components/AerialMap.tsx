"use client";

// Live, draggable Vexcel aerial (tiles come through /api/aerial so the key stays on the server).
// It never stops moving: it slowly circles the current view, pausing only while someone drags it.
// Change `viewKey` to fly to a new view: the given pins (fit them all) or the center point.

import { useEffect, useRef } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type AerialPin = { id: string; lat: number; lon: number; label: string; sub?: string; best?: boolean };

// Houston Medical Plaza, 6655 Travis St (from the CoStar property record).
export const SUITE_900 = { lat: 29.709464, lon: -95.4037013 };

type Props = {
  viewKey: string;
  center?: { lat: number; lon: number };
  zoom?: number;
  pitch?: number;
  pins?: AerialPin[];
  spin?: number; // degrees per second
  onPick?: (id: string) => void;
  className?: string;
};

export default function AerialMap({ viewKey, center = SUITE_900, zoom = 16, pitch = 58, pins = [], spin = 3, onPick, className = "" }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const ml = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const userBusy = useRef(false);
  const idle = useRef<number | undefined>(undefined);
  const spinRef = useRef(spin);
  const onPickRef = useRef(onPick);
  const viewRef = useRef({ center, zoom, pitch, pins });

  useEffect(() => {
    onPickRef.current = onPick;
    spinRef.current = spin;
    viewRef.current = { center, zoom, pitch, pins };
  });

  // Fly to the current view and (re)draw its pins.
  const applyView = (instant = false) => {
    const m = map.current;
    const lib = ml.current;
    if (!m || !lib) return;
    const { center: c, zoom: z, pitch: p, pins: ps } = viewRef.current;
    markers.current.forEach((mk) => mk.remove());
    markers.current = ps.map((pin, i) => {
      const el = document.createElement("button");
      el.className = `aerial-pin${pin.best ? " best" : ""}`;
      el.innerHTML = `<span class="aerial-pin-dot">${i + 1}</span><span class="aerial-pin-label"><b></b><em></em></span>`;
      el.querySelector("b")!.textContent = pin.label;
      el.querySelector("em")!.textContent = pin.sub ?? "";
      el.onclick = (e) => {
        e.stopPropagation();
        onPickRef.current?.(pin.id);
      };
      return new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([pin.lon, pin.lat]).addTo(m);
    });
    const duration = instant ? 0 : 3200;
    if (ps.length > 1) {
      const b = new lib.LngLatBounds();
      ps.forEach((pin) => b.extend([pin.lon, pin.lat]));
      // Keep the pins in the upper part of the screen, above the result cards.
      const h = m.getContainer().clientHeight;
      m.fitBounds(b, { padding: { top: Math.round(h * 0.2), bottom: Math.round(h * 0.42), left: 140, right: 140 }, pitch: p, duration, maxZoom: 15 });
    } else {
      const at = ps[0] ? { lat: ps[0].lat, lon: ps[0].lon } : c;
      m.flyTo({ center: [at.lon, at.lat], zoom: z, pitch: p, duration, essential: true });
    }
  };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    (async () => {
      const lib = (await import("maplibre-gl")).default as unknown as typeof import("maplibre-gl");
      if (cancelled || !box.current) return;
      ml.current = lib;
      const { center: c, zoom: z, pitch: p } = viewRef.current;
      const m = new lib.Map({
        container: box.current,
        style: {
          version: 8,
          sources: {
            vexcel: { type: "raster", tiles: ["/api/aerial/{z}/{x}/{y}"], tileSize: 256, minzoom: 3, maxzoom: 20, attribution: "Imagery © Vexcel" },
          },
          layers: [
            { id: "base", type: "background", paint: { "background-color": "#2a1a1e" } },
            { id: "vexcel", type: "raster", source: "vexcel", paint: { "raster-fade-duration": 300 } },
          ],
        },
        center: [c.lon, c.lat],
        zoom: z,
        pitch: p,
        bearing: -20,
        maxPitch: 70,
        cooperativeGestures: true, // Ctrl/Cmd + scroll (or pinch) zooms; plain scroll scrolls the page
        attributionControl: { compact: true },
      });
      m.addControl(new lib.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.current = m;
      if (process.env.NODE_ENV !== "production") (window as unknown as { slMap?: MlMap }).slMap = m;
      applyView(true); // the camera and pins can be set before the imagery finishes loading

      // Always moving: rotate a little every frame unless someone is dragging or a fly-to is running.
      let last = performance.now();
      const tick = (t: number) => {
        const dt = Math.min(64, t - last);
        last = t;
        if (!userBusy.current && map.current && !map.current.isEasing()) {
          map.current.setBearing(map.current.getBearing() + (dt / 1000) * spinRef.current);
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      const busy = () => {
        userBusy.current = true;
        window.clearTimeout(idle.current);
      };
      const free = () => {
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(() => (userBusy.current = false), 3500);
      };
      m.on("mousedown", busy);
      m.on("touchstart", busy);
      m.on("mouseup", free);
      m.on("touchend", free);
      m.on("dragend", free);
      m.on("rotateend", free);
      m.on("zoomend", (e) => e.originalEvent && free());
      m.on("wheel", () => {
        busy();
        free();
      });
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(idle.current);
      markers.current.forEach((mk) => mk.remove());
      map.current?.remove();
      map.current = null;
    };
    // Created once; view changes go through viewKey below.
     
  }, []);

  // New view (another page, new results, another suite): fly there.
  useEffect(() => {
    if (map.current) applyView();
     
  }, [viewKey]);

  return <div ref={box} className={`aerial-map ${className}`} />;
}
