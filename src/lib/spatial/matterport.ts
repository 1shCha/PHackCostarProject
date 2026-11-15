// Matterport Model API client (GraphQL). Server-side only: it reads the API key and token.
// Every response is cached under cache/matterport so the demo never depends on the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = "https://api.matterport.com/api/models/graph";
const CACHE = path.join(process.cwd(), "cache", "matterport");

export type Vec2 = { x: number; y: number };
export type Vec3 = Vec2 & { z: number };

export type MpModel = {
  id: string;
  name: string;
  floors: {
    id: string;
    vertices: { id: string; position: Vec2 }[];
    edges: { id: string; type: string; thickness: number; vertices: { id: string }[] }[];
  }[];
  rooms: {
    id: string;
    floor: { id: string } | null;
    classifications: { label: string; confidence: number }[];
    dimensionEstimates: { area?: number; height?: number } | null;
    boundary: { edges: { id: string }[] } | null;
  }[];
  panoLocations: { id: string; label: string; position: Vec3; rotation?: { x: number; y: number; z: number; w: number } }[];
  assets: {
    floorplans: {
      format: string;
      flags: string[];
      url?: string;
      width?: number;
      height?: number;
      resolution?: number;
      origin?: Vec2;
    }[];
  };
};

export type Floorplan = { url: string; width: number; height: number; resolution: number; origin: Vec2 };

const MODEL_QUERY = `query Model($id: ID!) { model(id: $id) {
  id name
  floors { id vertices { id position { x y } } edges { id type thickness vertices { id } } }
  rooms { id floor { id } classifications { label confidence } dimensionEstimates { area height } boundary { edges { id } } }
  panoLocations { id label position { x y z } rotation { x y z w } }
  assets { floorplans(provider: "matterport") { format flags url width height resolution origin { x y } } }
} }`;

const PANOS_QUERY = `query Panos($id: ID!) { model(id: $id) {
  panoLocations { id skybox(resolution: "2k") { status children } }
} }`;

function auth(): string {
  const key = process.env.MATTERPORT_API_KEY;
  const token = process.env.MATTERPORT_API_TOKEN;
  if (!key || !token) throw new Error("Set MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in .env.local");
  return "Basic " + Buffer.from(`${key}:${token}`).toString("base64"); // key = user, token = password
}

export async function graph<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth() },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Matterport API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Matterport API: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

/** Rooms, walls, scan positions and floor plans for one model. Cached after the first call. */
export async function getModel(id: string, { refresh = false } = {}): Promise<MpModel> {
  const file = path.join(CACHE, `${id}.json`);
  if (!refresh && existsSync(file)) {
    const cached: MpModel = JSON.parse(readFileSync(file, "utf8"));
    if (cached.panoLocations.every((p) => p.rotation)) return cached; // older caches lack rotation: refetch
  }
  const data = await graph<{ model: MpModel }>(MODEL_QUERY, { id });
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(data.model, null, 1));
  return data.model;
}

/** The photo floor plan that the wall coordinates line up with (jpg, 100 px per metre). */
export function pickFloorplan(model: MpModel, { measurements = false } = {}): Floorplan | null {
  const fp = model.assets.floorplans.find(
    (f) =>
      f.format === "jpg" &&
      f.flags.includes("photogramy") &&
      f.flags.includes("measurements") === measurements &&
      f.resolution && f.origin && f.width && f.height,
  );
  return fp ? (fp as Floorplan) : null;
}

async function download(url: string, file: string) {
  if (existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url.split("?")[0]}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Saves the floor plan image locally. Image links expire, so this asks the API for a fresh one. */
export async function downloadFloorplan(id: string, { measurements = false } = {}): Promise<string> {
  const file = path.join(CACHE, id, measurements ? "floorplan_measurements.jpg" : "floorplan.jpg");
  if (existsSync(file)) return file;
  const fresh = await getModel(id, { refresh: true });
  const fp = pickFloorplan(fresh, { measurements });
  if (!fp?.url) throw new Error(`No photo floor plan for ${id}`);
  await download(fp.url, file);
  return file;
}

/**
 * Saves the horizontal views (cube faces 1-4) of each 360° photo.
 * Returns { panoId: [file paths] }. Pass panoIds to limit which photos are downloaded.
 */
export async function downloadPanos(id: string, panoIds?: string[]): Promise<Record<string, string[]>> {
  const data = await graph<{ model: { panoLocations: { id: string; skybox: { status: string; children: string[] } | null }[] } }>(
    PANOS_QUERY,
    { id },
  );
  const out: Record<string, string[]> = {};
  for (const p of data.model.panoLocations) {
    if (panoIds && !panoIds.includes(p.id)) continue;
    const urls = p.skybox?.children ?? [];
    const files: string[] = [];
    for (const face of [1, 2, 3, 4]) {
      if (!urls[face]) continue;
      const file = path.join(CACHE, id, "panos", `${p.id}_${face}.jpg`);
      await download(urls[face], file);
      files.push(file);
    }
    out[p.id] = files;
  }
  return out;
}
