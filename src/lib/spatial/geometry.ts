// Turns Matterport's wall graph into room outlines, and converts metres to floor-plan pixels.

import type { Floorplan, MpModel, Vec2 } from "./matterport";

export type Room = {
  id: string;
  label: string; // Matterport's own label ("Other", "Void", ...)
  confidence: number;
  areaM2: number;
  outline: Vec2[]; // metres, in walking order around the room
  holes: Vec2[][]; // walled-off areas inside the room (columns, closets), also in metres
  panoIds: string[]; // 360° photos taken inside this room
};

/** True when a point is inside the room's outline and not inside one of its holes. */
export function inRoom(p: Vec2, room: Pick<Room, "outline" | "holes">): boolean {
  return pointInPolygon(p, room.outline) && !room.holes.some((h) => pointInPolygon(p, h));
}

/** Rooms with outlines and the photos taken inside them. Skips "Void" scraps and tiny areas. */
export function buildRooms(model: MpModel, { minAreaM2 = 2 } = {}): Room[] {
  const verts = new Map<string, Vec2>();
  const edges = new Map<string, [string, string]>();
  for (const f of model.floors) {
    for (const v of f.vertices) verts.set(v.id, v.position);
    for (const e of f.edges) edges.set(e.id, [e.vertices[0].id, e.vertices[1].id]);
  }

  const rooms: Room[] = [];
  for (const r of model.rooms) {
    const top = r.classifications?.[0];
    if (top?.label === "Void") continue;
    const segs = (r.boundary?.edges ?? []).map((e) => edges.get(e.id)).filter(Boolean) as [string, string][];
    // A boundary can hold several loops: the outer wall plus walled-off areas inside the room.
    const rings = chainRings(segs)
      .map((ids) => ids.map((id) => verts.get(id)!).filter(Boolean))
      .filter((ring) => ring.length >= 3)
      .sort((a, b) => polygonArea(b) - polygonArea(a));
    if (!rings.length) continue;
    const [outline, ...holes] = rings;
    // Areas come from the outline in metres. (dimensionEstimates.area is in square feet for these keys.)
    const areaM2 = polygonArea(outline) - holes.reduce((s, h) => s + polygonArea(h), 0);
    if (areaM2 < minAreaM2) continue;
    const room = { outline, holes };
    rooms.push({
      id: r.id,
      label: top?.label ?? "Unknown",
      confidence: top?.confidence ?? 0,
      areaM2,
      outline,
      holes,
      panoIds: model.panoLocations.filter((p) => inRoom(p.position, room)).map((p) => p.id),
    });
  }
  return rooms.sort((a, b) => b.areaM2 - a.areaM2);
}

/** Splits a room's boundary edges into closed loops of vertex ids by walking edge to edge. */
function chainRings(segs: [string, string][]): string[][] {
  const left = [...segs];
  const rings: string[][] = [];
  while (left.length) {
    const loop = [...left.shift()!];
    for (;;) {
      const end = loop[loop.length - 1];
      const i = left.findIndex(([a, b]) => a === end || b === end);
      if (i < 0) break; // closed, or the boundary has a gap
      const [a, b] = left.splice(i, 1)[0];
      const next = a === end ? b : a;
      if (next === loop[0]) break;
      loop.push(next);
    }
    rings.push(loop);
  }
  return rings;
}

export function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function centroid(pts: Vec2[]): Vec2 {
  const n = pts.length;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Metres → pixels on the photo floor plan. The origin is the image's bottom-left corner; image y runs down. */
export function toPx(p: Vec2, fp: Floorplan): [number, number] {
  return [
    Math.round((p.x - fp.origin.x) * fp.resolution),
    Math.round(fp.height - (p.y - fp.origin.y) * fp.resolution),
  ];
}

export const M2_TO_SQFT = 10.7639;
