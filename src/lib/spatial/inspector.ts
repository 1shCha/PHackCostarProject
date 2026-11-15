// Space Inspector agent: walks a Matterport scan photo by photo, labels commercial room types
// (Matterport's unsolved problem #1), pins and counts built-in features (#2), and decides where to look next (#3):
//  - photos it isn't sure about get a second look from a nearby viewpoint
//  - rooms with no photo inside are inspected through the doorway view that faces them
//  - anything it still can't see is reported as unverified
// Output matches `inspect` in data/demo.json, plus extra fields (status, source, evidence, zones, measured, agent_log).

import { downloadPanos, getModel, pickFloorplan, type Floorplan, type MpModel, type Vec2 } from "./matterport";
import { buildRooms, centroid, M2_TO_SQFT, toPx, type Room } from "./geometry";
import { askVisionJSON, earlierAnswer } from "./vision";
import { asFeature, asLabel, FEATURES, ROOM_LABELS, type Feature, type Label } from "./vocabulary";

export { ROOM_LABELS, FEATURES };

type Answer = { label: string; confidence: number; features: { type: string; view: number; note?: string }[]; evidence: string };
type DoorwayAnswer = Answer & { visible: boolean };

export type InspectRoom = {
  id: string;
  label: Label;
  display: string;
  confidence: number;
  status: "confirmed" | "likely" | "unverified";
  source: "photos_inside" | "doorway_view" | "none";
  area_sqft: number;
  polygon: [number, number][];
  features: { type: Feature; x: number; y: number; pano_url: string; note: string; seen_in: number }[];
  evidence: string[];
  zones?: { label: Label; display: string; confidence: number; x: number; y: number; features: Feature[] }[];
};

const roomList = Object.keys(ROOM_LABELS).join(", ");
const featureList = Object.entries(FEATURES).map(([k, v]) => `  - ${k}: ${v}`).join("\n");
const ANSWER_SHAPE = `{"label": one of [${roomList}],
 "confidence": number from 0 to 1,
 "features": [{"type": one feature name, "view": 1-4, "note": a few words on what you saw}],
 "evidence": one short sentence naming what you saw}`;

const PHOTO_PROMPT = `These are the 4 horizontal views (front, right, back, left) of ONE 360° photo taken inside a commercial space (it could be any business: medical, salon, law office, restaurant, warehouse...).
Decide what kind of space the camera is standing in, and list built-in or installed features you can clearly see.
Feature names and what they mean:
${featureList}
If something does not match a definition, leave it out rather than picking the closest name.
List each physical object once, even if it appears in two views.
Reply as JSON only:
${ANSWER_SHAPE}
Use "other" and a low confidence if you are unsure.`;

const RECHECK_PROMPT = `These are views from TWO nearby 360° photos of the same area of a commercial suite
(views 1-4 from the first photo, then views 1-4 from the second). A first pass was unsure what this area is.
Look carefully and decide what kind of space it is and what built-in features are present.
Feature names and what they mean:
${featureList}
Reply as JSON only:
${ANSWER_SHAPE}`;

const doorwayPrompt = (areaM2: number) => `This is one view from a 360° photo taken just outside a separate small room (about ${Math.round(areaM2)} m²)
in a commercial suite. The camera is facing toward that room.
If you can see into the room (through a doorway, opening or glass), decide what kind of room it is and list features you can see inside it.
If you cannot see into a separate room in this view, set "visible" to false.
Feature names and what they mean:
${featureList}
Reply as JSON only:
{"visible": true or false, "label": one of [${roomList}], "confidence": number from 0 to 1,
 "features": [{"type": one feature name, "view": 1, "note": a few words}], "evidence": one short sentence}`;

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number(n) || 0));
const statusOf = (c: number, source: InspectRoom["source"]) =>
  source === "none" ? "unverified" : c >= 0.75 && source === "photos_inside" ? "confirmed" : c >= 0.5 ? "likely" : "unverified";

const RECHECK_BELOW = 0.6; // second look for photos the model wasn't sure about
const MERGE_WITHIN_M = 3; // same feature type seen from photos this close together = one object
const DOORWAY_MAX_M = 8; // only look into a room from photos this close to it

/**
 * Faces 1-4 of a Matterport skybox look front, right, back, left in the photo's own frame.
 * At zero rotation, front faces +y in model coordinates (z is up). Returns the faces ordered
 * by how directly they point at `target`, so the agent can try the best one first.
 */
function facesToward(from: Vec2, target: Vec2, rot?: { x: number; y: number; z: number; w: number }): number[] {
  const yaw = rot ? Math.atan2(2 * (rot.w * rot.z + rot.x * rot.y), 1 - 2 * (rot.y * rot.y + rot.z * rot.z)) : 0;
  const bearing = Math.atan2(target.y - from.y, target.x - from.x);
  const faceAngle = { 1: Math.PI / 2, 2: 0, 3: -Math.PI / 2, 4: Math.PI } as Record<number, number>;
  const diff = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  return [1, 2, 3, 4].sort((a, b) => diff(faceAngle[a] + yaw - bearing) - diff(faceAngle[b] + yaw - bearing));
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Runs the inspection. `log` receives one line per decision the agent makes. */
export async function inspectModel(modelId: string, log: (msg: string) => void = () => {}) {
  const model = await getModel(modelId);
  const fp = pickFloorplan(model);
  if (!fp) throw new Error(`No photo floor plan for ${modelId}`);
  const rooms = buildRooms(model);
  const pano = new Map(model.panoLocations.map((p) => [p.id, p]));
  const agentLog: string[] = [];
  const note = (m: string) => {
    agentLog.push(m);
    log(m);
  };

  // 1. Look at every photo taken inside a room.
  const inside = rooms.flatMap((r) => r.panoIds);
  note(`Plan: ${rooms.length} rooms, ${inside.length} photos inside them, ${rooms.filter((r) => !r.panoIds.length).length} rooms with no photo inside`);
  const files = await downloadPanos(modelId, inside);
  const answers = new Map<string, Answer>();
  for (const [i, id] of inside.entries()) {
    if (!files[id]?.length) continue;
    log(`Labeling photo ${i + 1} of ${inside.length}`);
    try {
      answers.set(id, await askVisionJSON<Answer>(files[id], PHOTO_PROMPT));
    } catch (e) {
      const prev = earlierAnswer<Answer>(files[id]);
      if (prev) {
        answers.set(id, prev);
        note(`Gemini unavailable for photo ${id.slice(0, 6)}; reused an earlier answer`);
      } else {
        note(`Skipped photo ${id.slice(0, 6)}: ${(e as Error).message.split("\n")[0].slice(0, 120)}`);
      }
    }
  }

  // 2. Second look where the first answer was unsure, using a nearby photo in the same room.
  for (const room of rooms) {
    for (const id of room.panoIds) {
      const first = answers.get(id);
      if (!first || clamp01(first.confidence) >= RECHECK_BELOW) continue;
      const here = pano.get(id)!.position;
      const neighbor = room.panoIds
        .filter((o) => o !== id && files[o]?.length)
        .sort((a, b) => dist(pano.get(a)!.position, here) - dist(pano.get(b)!.position, here))[0];
      if (!neighbor) continue;
      try {
        const second = await askVisionJSON<Answer>([...files[id], ...files[neighbor]], RECHECK_PROMPT);
        const better = clamp01(second.confidence) > clamp01(first.confidence);
        if (better) answers.set(id, second);
        note(`Second look at photo ${id.slice(0, 6)} (${Math.round(clamp01(first.confidence) * 100)}% sure): ` +
          (better ? `now ${asLabel(second.label)} at ${Math.round(clamp01(second.confidence) * 100)}%` : "kept first answer"));
      } catch (e) {
        note(`Second look failed for ${id.slice(0, 6)}: ${(e as Error).message}`);
      }
    }
  }

  // 3. Rooms with no photo inside: look in from the nearest photos, through the view facing the room.
  const doorway = new Map<string, { answer: DoorwayAnswer; panoId: string }>();
  for (const room of rooms.filter((r) => !r.panoIds.length)) {
    const c = centroid(room.outline);
    const candidates = model.panoLocations
      .filter((p) => dist(p.position, c) <= DOORWAY_MAX_M)
      .sort((a, b) => dist(a.position, c) - dist(b.position, c))
      .slice(0, 2);
    let found = false;
    for (const p of candidates) {
      const faces = facesToward(p.position, c, p.rotation).slice(0, 2); // best direction, then the next best
      const got = await downloadPanos(modelId, [p.id]);
      for (const face of faces) {
        const img = got[p.id]?.find((f) => f.endsWith(`_${face}.jpg`));
        if (!img) continue;
        try {
          const a = await askVisionJSON<DoorwayAnswer>([img], doorwayPrompt(room.areaM2));
          if (a.visible) {
            doorway.set(room.id, { answer: a, panoId: p.id });
            note(`Room ${room.id.slice(0, 6)} (${Math.round(room.areaM2)} m²): looked in from photo ${p.id.slice(0, 6)}, view ${face} → ${asLabel(a.label)} at ${Math.round(clamp01(a.confidence) * 100)}%`);
            found = true;
            break;
          }
        } catch (e) {
          note(`Doorway look failed for room ${room.id.slice(0, 6)}: ${(e as Error).message}`);
        }
      }
      if (found) break;
    }
    if (!found) note(`Room ${room.id.slice(0, 6)} (${Math.round(room.areaM2)} m²): no view into it, marked unverified`);
  }

  // 4. Combine into rooms, zones and de-duplicated feature pins.
  const out = rooms.map((room) => summarizeRoom(room, model, fp, answers, doorway.get(room.id)));
  const counts: Record<string, number> = {};
  for (const r of out) {
    if (r.status === "unverified") continue;
    counts[r.label] = (counts[r.label] ?? 0) + 1;
    for (const f of r.features) counts[f.type] = (counts[f.type] ?? 0) + 1;
  }

  return {
    floorplan: { url: `/api/floorplan/${modelId}`, width: fp.width, height: fp.height },
    rooms: out,
    counts,
    measured: {
      rooms: rooms.length,
      scans: model.panoLocations.length,
      area_sqft: Math.round(rooms.reduce((s, r) => s + r.areaM2, 0) * M2_TO_SQFT),
      source: "Matterport scan; rooms labeled by Gemini from 360° photos",
    },
    agent_log: agentLog,
  };
}

function summarizeRoom(
  room: Room,
  model: MpModel,
  fp: Floorplan,
  answers: Map<string, Answer>,
  door?: { answer: DoorwayAnswer; panoId: string },
): InspectRoom {
  const polygon = room.outline.map((p) => toPx(p, fp));
  const area_sqft = Math.round(room.areaM2 * M2_TO_SQFT);
  const posOf = (id: string) => model.panoLocations.find((p) => p.id === id)!.position;
  const labeled = room.panoIds.filter((id) => answers.has(id));

  // Room seen only through a doorway.
  if (!labeled.length && door) {
    const a = door.answer;
    const label = asLabel(a.label);
    const confidence = Math.round(clamp01(a.confidence) * 0.8 * 100) / 100; // a doorway view is weaker evidence
    const [x, y] = toPx(centroid(room.outline), fp);
    return {
      id: room.id, label, display: ROOM_LABELS[label], confidence, status: statusOf(confidence, "doorway_view"),
      source: "doorway_view", area_sqft, polygon,
      features: (a.features ?? []).flatMap((f) => {
        const t = asFeature(f.type);
        return t ? [{ type: t, x, y, pano_url: "", note: f.note ?? "", seen_in: 1 }] : [];
      }),
      evidence: [`Seen through the doorway: ${a.evidence}`],
    };
  }

  // Nothing could see into the room.
  if (!labeled.length) {
    return {
      id: room.id, label: "other", display: `Unverified room (${area_sqft} sq ft)`, confidence: 0, status: "unverified",
      source: "none", area_sqft, polygon, features: [], evidence: ["No photo shows the inside of this room."],
    };
  }

  // Room label = the label with the most total confidence across its photos.
  const score = new Map<Label, number>();
  for (const id of labeled) {
    const a = answers.get(id)!;
    score.set(asLabel(a.label), (score.get(asLabel(a.label)) ?? 0) + clamp01(a.confidence));
  }
  const [label, total] = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = Math.round((total / labeled.length) * 100) / 100;

  // Features: one sighting per type per photo, then merge sightings of the same type that are close together.
  const sightings: { type: Feature; at: Vec2; note: string }[] = [];
  for (const id of labeled) {
    const seen = new Set<Feature>();
    for (const f of answers.get(id)!.features ?? []) {
      const t = asFeature(f.type);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      sightings.push({ type: t, at: posOf(id), note: f.note ?? "" });
    }
  }
  const objects: { type: Feature; points: Vec2[]; note: string }[] = [];
  for (const s of sightings) {
    const match = objects.find((o) => o.type === s.type && o.points.some((p) => dist(p, s.at) <= MERGE_WITHIN_M));
    if (match) match.points.push(s.at);
    else objects.push({ type: s.type, points: [s.at], note: s.note });
  }
  const features = objects.map((o, i) => {
    const [x, y] = toPx(centroid(o.points), fp);
    return { type: o.type, x: x + (i % 3) * 16, y, pano_url: "", note: o.note, seen_in: o.points.length };
  });

  // Big open rooms get one zone per photo, so the plan can show what each part is used for.
  const zones =
    room.areaM2 > 60 && labeled.length >= 3
      ? labeled.map((id) => {
          const a = answers.get(id)!;
          const [x, y] = toPx(posOf(id), fp);
          const l = asLabel(a.label);
          const feats = [...new Set((a.features ?? []).map((f) => asFeature(f.type)).filter(Boolean))] as Feature[];
          return { label: l, display: ROOM_LABELS[l], confidence: clamp01(a.confidence), x, y, features: feats };
        })
      : undefined;
  const zoneNames = zones ? [...new Set(zones.map((z) => z.display.toLowerCase()))] : [];
  // A big open room holds several kinds of space, so judge it by how sure each zone label is, not by one winning label.
  const roomConfidence = zones
    ? Math.round((zones.reduce((s, z) => s + z.confidence, 0) / zones.length) * 100) / 100
    : confidence;

  return {
    id: room.id,
    label,
    display: zones ? `Open area: ${zoneNames.join(", ")}` : ROOM_LABELS[label],
    confidence: roomConfidence,
    status: statusOf(roomConfidence, "photos_inside"),
    source: "photos_inside",
    area_sqft,
    polygon,
    features,
    evidence: labeled.map((id) => answers.get(id)!.evidence).filter(Boolean).slice(0, 3),
    ...(zones ? { zones } : {}),
  };
}
