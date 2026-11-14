// Space Inspector: labels each room of a Matterport scan from its 360° photos (Matterport's unsolved problem #1:
// commercial room types) and pins the built-in features it sees. Output matches `inspect` in data/demo.json.

import { downloadPanos, getModel, pickFloorplan, type Vec2 } from "./matterport";
import { buildRooms, M2_TO_SQFT, toPx, type Room } from "./geometry";
import { askVisionJSON } from "./vision";

export const ROOM_LABELS = {
  reception: "Reception",
  waiting: "Waiting area",
  exam_room: "Exam room",
  procedure: "Procedure room",
  office: "Private office",
  conference: "Conference room",
  open_workspace: "Open workspace",
  break_room: "Break room / kitchen",
  restroom: "Restroom",
  storage: "Storage",
  lab: "Lab",
  server_utility: "Server / utility room",
  hallway: "Hallway",
  retail_floor: "Sales floor",
  other: "Other",
} as const;
export const FEATURES = [
  "sink", "cabinets", "exam_table", "reception_desk", "medical_gas", "kitchen_hood", "appliances",
  "glass_partition", "server_rack", "lab_counter", "desks", "conference_table", "toilet", "grab_bars",
] as const;

type Label = keyof typeof ROOM_LABELS;
type Feature = (typeof FEATURES)[number];
type PanoAnswer = { label: string; confidence: number; features: { type: string; view: number }[]; evidence: string };

export type InspectRoom = {
  id: string;
  label: Label;
  display: string;
  confidence: number;
  area_sqft: number;
  polygon: [number, number][];
  features: { type: Feature; x: number; y: number; pano_url: string }[];
  evidence: string[];
  scanned_inside: boolean;
  zones?: { label: Label; display: string; confidence: number; x: number; y: number }[];
};

const PROMPT = `These are the 4 horizontal views (front, right, back, left) of ONE 360° photo taken inside a commercial suite.
Decide what kind of space the camera is standing in, and list built-in or installed features you can actually see.
Reply as JSON only:
{"label": one of [${Object.keys(ROOM_LABELS).join(", ")}],
 "confidence": number from 0 to 1,
 "features": [{"type": one of [${FEATURES.join(", ")}], "view": 1-4}],
 "evidence": one short sentence naming what you saw}
Use "other" and a low confidence if you are unsure. Only list features that are clearly visible.`;

const asLabel = (s: string): Label => (s in ROOM_LABELS ? (s as Label) : "other");
const asFeature = (s: string): Feature | null => ((FEATURES as readonly string[]).includes(s) ? (s as Feature) : null);
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number(n) || 0));

/** Labels every photo inside a room, then combines them into room labels and feature pins. */
export async function inspectModel(modelId: string, onProgress: (msg: string) => void = () => {}) {
  const model = await getModel(modelId);
  const fp = pickFloorplan(model);
  if (!fp) throw new Error(`No photo floor plan for ${modelId}`);
  const rooms = buildRooms(model);
  const panoPos = new Map<string, Vec2>(model.panoLocations.map((p) => [p.id, p.position]));

  const wanted = rooms.flatMap((r) => r.panoIds);
  onProgress(`Downloading ${wanted.length} photos`);
  const files = await downloadPanos(modelId, wanted);

  // Ask Gemini about each photo (cached, so re-runs are free).
  const answers = new Map<string, PanoAnswer>();
  let n = 0;
  for (const id of wanted) {
    n++;
    if (!files[id]?.length) continue;
    onProgress(`Labeling photo ${n} of ${wanted.length}`);
    try {
      answers.set(id, await askVisionJSON<PanoAnswer>(files[id], PROMPT));
    } catch (e) {
      onProgress(`  skipped photo ${id.slice(0, 6)}: ${(e as Error).message}`);
    }
  }

  const out: InspectRoom[] = rooms.map((room) => summarizeRoom(room, answers, panoPos, fp));
  const counts: Record<string, number> = {};
  for (const r of out) {
    if (!r.scanned_inside) continue;
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
      source: "Matterport scan, rooms labeled by Gemini from 360° photos",
    },
  };
}

function summarizeRoom(
  room: Room,
  answers: Map<string, PanoAnswer>,
  panoPos: Map<string, Vec2>,
  fp: NonNullable<ReturnType<typeof pickFloorplan>>,
): InspectRoom {
  const polygon = room.outline.map((p) => toPx(p, fp));
  const area_sqft = Math.round(room.areaM2 * M2_TO_SQFT);
  const labeled = room.panoIds.filter((id) => answers.has(id));

  if (!labeled.length) {
    return {
      id: room.id, label: "other", display: `Room not scanned inside (${area_sqft} sq ft)`, confidence: 0,
      area_sqft, polygon, features: [], evidence: ["No 360° photo was taken inside this room."], scanned_inside: false,
    };
  }

  // Room label = the label with the most total confidence across its photos.
  const score = new Map<Label, number>();
  for (const id of labeled) {
    const a = answers.get(id)!;
    const l = asLabel(a.label);
    score.set(l, (score.get(l) ?? 0) + clamp01(a.confidence));
  }
  const [label, total] = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = Math.round((total / labeled.length) * 100) / 100;

  // One pin per feature type per photo, placed at that photo's scan position.
  const features: InspectRoom["features"] = [];
  for (const id of labeled) {
    const [x, y] = toPx(panoPos.get(id)!, fp);
    const seen = new Set<Feature>();
    for (const f of answers.get(id)!.features ?? []) {
      const t = asFeature(f.type);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      features.push({ type: t, x: x + seen.size * 18, y, pano_url: "" });
    }
  }

  // Big open rooms get one zone per photo, so the plan can show what each part of the room is used for.
  const zones =
    room.areaM2 > 60 && labeled.length >= 3
      ? labeled.map((id) => {
          const a = answers.get(id)!;
          const [x, y] = toPx(panoPos.get(id)!, fp);
          const l = asLabel(a.label);
          return { label: l, display: ROOM_LABELS[l], confidence: clamp01(a.confidence), x, y };
        })
      : undefined;

  const zoneNames = zones ? [...new Set(zones.map((z) => z.display.toLowerCase()))] : [];
  return {
    id: room.id,
    label,
    display: zones ? `Open area: ${zoneNames.join(", ")}` : ROOM_LABELS[label],
    confidence,
    area_sqft,
    polygon,
    features,
    evidence: labeled.map((id) => answers.get(id)!.evidence).filter(Boolean).slice(0, 3),
    scanned_inside: true,
    ...(zones ? { zones } : {}),
  };
}
