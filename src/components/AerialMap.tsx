"use client";

// Live, draggable Vexcel aerial map (tiles come through /api/aerial so the key stays on the server).
// "orbit" slowly circles a point; "pins" flies to fit the given buildings and marks them.

import { useEffect, useRef } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type AerialPin = { id: string; lat: number; lon: number; label: string; sub?: string; best?: boolean };

// Houston Medical Plaza, 6655 Travis St (from the CoStar property record).
export const SUITE_900 = { lat: 29.709464, lon: -95.4037013 };

export default function AerialMap({
  center = SUITE_900,
  zoom = 16.5,
  pins = [],
  orbit = true,
  pitch = 55,
  onPick,
  className = "",
}: {
  center?: { lat: number; lon: number };
  zoom?: number;
  pins?: AerialPin[];
  orbit?: boolean;
  pitch?: number;
  onPick?: (id: string) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const orbiting = useRef(orbit);
  const idleTimer = useRef<number | undefined>(undefined);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    (async () => {
      const ml = (await import("maplibre-gl")).default;
      if (cancelled || !box.current) return;
      const m = new ml.Map({
        container: box.current,
        style: {
          version: 8,
          sources: {
            vexcel: { type: "raster", tiles: ["/api/aerial/{z}/{x}/{y}"], tileSize: 256, minzoom: 3, maxzoom: 20, attribution: "Imagery © Vexcel" },
          },
          layers: [{ id: "vexcel", type: "raster", source: "vexcel", paint: { "raster-fade-duration": 250 } }],
        },
        center: [center.lon, center.lat],
        zoom,
        pitch,
        bearing: -20,
        maxPitch: 70,
        // Ctrl/Cmd + scroll (or pinch) zooms; plain scroll keeps scrolling the page. Shows a hint when needed.
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.current = m;
      if (process.env.NODE_ENV !== "production") (window as unknown as { slMaps?: MlMap[] }).slMaps = [...((window as unknown as { slMaps?: MlMap[] }).slMaps ?? []), m];

      // Slow orbit; pause while someone drags, resume after a quiet moment.
      let last = performance.now();
      const spin = (t: number) => {
        const dt = t - last;
        last = t;
        if (orbiting.current && map.current && !map.current.isMoving()) map.current.setBearing(map.current.getBearing() + dt * 0.004);
        frame = requestAnimationFrame(spin);
      };
      frame = requestAnimationFrame(spin);
      const pause = () => {
        orbiting.current = false;
        window.clearTimeout(idleTimer.current);
      };
      const resume = () => {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(() => (orbiting.current = orbit), 6000);
      };
      m.on("dragstart", pause);
      m.on("rotatestart", pause);
      m.on("zoomstart", (e) => e.originalEvent && pause());
      m.on("dragend", resume);
      m.on("rotateend", resume);
      m.on("zoomend", resume);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer.current);
      markers.current.forEach((mk) => mk.remove());
      map.current?.remove();
      map.current = null;
    };
    // Created once; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins: mark each building, then fly so they all fit (or to the single one).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ml = (await import("maplibre-gl")).default;
      for (let i = 0; i < 40 && !map.current && !cancelled; i++) await new Promise((r) => setTimeout(r, 100));
      const m = map.current;
      if (!m || cancelled) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = pins.map((p, i) => {
        const el = document.createElement("button");
        el.className = `aerial-pin${p.best ? " best" : ""}`;
        el.innerHTML = `<span class="aerial-pin-dot">${i + 1}</span><span class="aerial-pin-label"><b></b><em></em></span>`;
        el.querySelector("b")!.textContent = p.label;
        el.querySelector("em")!.textContent = p.sub ?? "";
        el.onclick = (e) => {
          e.stopPropagation();
          onPickRef.current?.(p.id);
        };
        return new ml.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lon, p.lat]).addTo(m);
      });
      if (pins.length > 1) {
        const b = new ml.LngLatBounds();
        pins.forEach((p) => b.extend([p.lon, p.lat]));
        m.fitBounds(b, { padding: { top: 90, bottom: 90, left: 80, right: 80 }, pitch: 45, duration: 3000, maxZoom: 15.5 });
      } else if (pins.length === 1) {
        m.flyTo({ center: [pins[0].lon, pins[0].lat], zoom: 17, pitch: 55, duration: 3000 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pins]);

  // New center (e.g. a different suite): fly there.
  useEffect(() => {
    const m = map.current;
    if (!m || pins.length) return;
    m.flyTo({ center: [center.lon, center.lat], zoom, pitch, duration: 2500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lon]);

  return <div ref={box} className={`aerial-map ${className}`} />;
}
