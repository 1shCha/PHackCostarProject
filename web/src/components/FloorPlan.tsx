"use client";

import { useState } from "react";
import type { Inspect, Room } from "@/lib/types";

const PIN_ICON: Record<string, string> = {
  sink: "💧", cabinets: "🗄️", reception_desk: "🛎️", medical_gas: "🫧", kitchen_hood: "🍳",
};

/** Floor plan image with room outlines and feature pins drawn on top (coordinates = image pixels). */
export function FloorPlan({ data }: { data: Inspect }) {
  const [active, setActive] = useState<Room | null>(null);
  const { width, height, url } = data.floorplan;

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
        <svg viewBox={`0 0 ${width} ${height}`} className="block w-full">
          {url && <image href={url} width={width} height={height} />}
          {data.rooms.map((room) => {
            const pts = room.polygon.map(([x, y]) => `${x},${y}`).join(" ");
            const cx = room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length;
            const cy = room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length;
            const isActive = active?.id === room.id;
            return (
              <g key={room.id} onMouseEnter={() => setActive(room)} className="cursor-pointer">
                <polygon
                  points={pts}
                  className={isActive ? "fill-emerald-400/35 stroke-emerald-700" : "fill-emerald-300/15 stroke-emerald-600/70"}
                  strokeWidth={2}
                />
                <text x={cx} y={cy} textAnchor="middle" className="fill-stone-800 text-[14px] font-semibold">
                  {room.display}
                </text>
                <text x={cx} y={cy + 16} textAnchor="middle" className="fill-stone-500 text-[11px]">
                  {Math.round(room.confidence * 100)}% sure
                </text>
              </g>
            );
          })}
          {data.rooms.flatMap((room) =>
            room.features.map((f, i) => (
              <g key={`${room.id}-${i}`}>
                <circle cx={f.x} cy={f.y} r={12} className="fill-white stroke-sky-600" strokeWidth={2} />
                <text x={f.x} y={f.y + 5} textAnchor="middle" className="text-[13px]">{PIN_ICON[f.type] ?? "📍"}</text>
              </g>
            )),
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600">
        {Object.entries(data.counts).map(([k, v]) => (
          <span key={k} className="rounded-full bg-stone-100 px-2 py-1">
            {v} × {k.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      {active && (
        <p className="mt-2 text-sm text-stone-600">
          <b>{active.display}</b>: {active.features.length ? active.features.map((f) => f.type.replace(/_/g, " ")).join(", ") : "no features pinned"}
        </p>
      )}
    </div>
  );
}
