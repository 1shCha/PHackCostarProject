import "server-only";
import { ToolValidationError } from "../tools/costar";
import { buildRooms } from "./geometry";
import type { MpModel } from "./matterport";
import { SpatialError, cachedJSON, saveJSON, request, readJSON, readBytes, saveImage, sourceReference } from "./common";
import { analyzeImages } from "./visual-analysis";

const endpoint = "https://api.matterport.com/api/models/graph";
export function validateModelId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{6,20}$/.test(value)) throw new ToolValidationError("model_id must be a Matterport model identifier.");
}
export async function matterportGraph<T>(query: string, modelId: string, signal?: AbortSignal): Promise<T> {
  const key = process.env.MATTERPORT_API_KEY, token = process.env.MATTERPORT_API_TOKEN;
  if (!key || !token) throw new SpatialError("matterport", "NOT_CONFIGURED", "Configure Matterport API key and token.");
  const response = await request("matterport", endpoint, { method: "POST", headers: {
    "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${key}:${token}`).toString("base64")}`,
  }, body: JSON.stringify({ query, variables: { id: modelId } }) }, signal);
  if (response.status === 404) throw new SpatialError("matterport", "UNAVAILABLE", "Matterport model is unavailable.");
  const data = await readJSON<{ data?: T; errors?: unknown[] }>(response, "matterport");
  if (data.errors?.length || !data.data) throw new SpatialError("matterport", "UNAVAILABLE", "Matterport did not return accessible model data.");
  return data.data;
}
const query = `query Model($id:ID!){ model(id:$id){ id name
  floors{id vertices{id position{x y}} edges{id type thickness vertices{id}}}
  rooms{id floor{id} classifications{label confidence} dimensionEstimates{area height} boundary{edges{id}}}
  panoLocations{id label position{x y z}}
  assets{floorplans(provider:"matterport"){format flags url width height resolution origin{x y}}}
}}`;
export async function modelSnapshot(modelId: string, signal?: AbortSignal) {
  const key = `mp-metadata-v1:${modelId}`;
  const cached = await cachedJSON<{ model: MpModel; retrieved_at: string }>(key);
  if (cached) return cached;
  const { model } = await matterportGraph<{ model: MpModel | null }>(query, modelId, signal);
  if (!model || model.id !== modelId || !Array.isArray(model.rooms) || !Array.isArray(model.floors) || !Array.isArray(model.panoLocations)) {
    throw new SpatialError("matterport", "INVALID_RESPONSE", "Matterport returned an invalid model.");
  }
  const snapshot = { model, retrieved_at: new Date().toISOString() };
  await saveJSON(key, snapshot); return snapshot;
}
export async function get_matterport_rooms(input: { model_id: string }, signal?: AbortSignal) {
  validateModelId(input?.model_id);
  const { model, retrieved_at } = await modelSnapshot(input.model_id, signal);
  const rooms = buildRooms(model);
  return { status: "ok", model_id: model.id, model_name: model.name, scope: "scan_extent_unverified_for_suite",
    captured_at: null, retrieved_at, room_count: rooms.length, panorama_count: model.panoLocations.length,
    rooms: rooms.map((room) => ({ room_id: room.id, matterport_label: room.label, confidence: room.confidence,
      approximate_area_sqft: Math.round(room.areaM2 * 10.7639), panorama_ids: model.floors.length === 1 ? room.panoIds : [] })),
    limitations: ["Scan capture date and suite extent are not verified.", "Room count excludes Void classifications, areas below 2 square metres and rooms without usable boundaries.", "Panorama-to-room assignment is not verified across multiple floors; room panorama lists are omitted for multi-floor models."],
    source_references: [sourceReference("matterport", model.id, { retrieved_at, scope: "model" })],
  };
}
export async function inspect_matterport_features(input: { model_id: string; room_id?: string; max_panoramas?: number }, signal?: AbortSignal) {
  validateModelId(input?.model_id);
  const max = input.max_panoramas ?? 1;
  if (!Number.isInteger(max) || max < 1 || max > 2) throw new ToolValidationError("max_panoramas must be 1 or 2.");
  if (input.room_id !== undefined && (typeof input.room_id !== "string" || !input.room_id.trim())) throw new ToolValidationError("room_id must be a nonempty identifier.");
  const { model } = await modelSnapshot(input.model_id, signal);
  if (input.room_id !== undefined && model.floors.length !== 1) throw new ToolValidationError("Room-targeted inspection requires a single-floor model; use a whole-scan sample when floor association is unverified.");
  const rooms = buildRooms(model);
  const room = input.room_id === undefined ? undefined : rooms.find((r) => r.id === input.room_id);
  if (input.room_id !== undefined && !room) return { status: "not_found", model_id: model.id, room_id: input.room_id };
  const available = room ? room.panoIds : model.panoLocations.map((pano) => pano.id);
  if (!available.length) return { status: "no_images", model_id: model.id, room_id: input.room_id ?? null };
  const selected = [...available].sort().slice(0, max);
  const images = [];
  const refs = [];
  const data = await matterportGraph<{ model: { panoLocations: { id: string; skybox: { children: string[] } | null }[] } }>(
    `query Panos($id:ID!){model(id:$id){panoLocations{id skybox(resolution:"2k"){children}}}}`, model.id, signal);
  for (const panoId of selected) {
    const pano = data.model?.panoLocations?.find((p) => p.id === panoId);
    for (const face of [1, 2, 3, 4]) {
      const link = pano?.skybox?.children?.[face];
      if (!link) continue;
      const url = new URL(link);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".matterport.com")) throw new SpatialError("matterport", "INVALID_RESPONSE", "Unexpected Matterport image host.");
      const response = await request("matterport", url.toString(), {}, signal);
      if (response.status === 404) continue;
      const type = response.headers.get("content-type")?.split(";")[0];
      if (type !== "image/jpeg" && type !== "image/png") throw new SpatialError("matterport", "INVALID_RESPONSE", "Matterport returned a non-image asset.");
      const image = await saveImage(await readBytes(response, "matterport"), type);
      images.push(image);
      refs.push(sourceReference("matterport", `${model.id}:${panoId}:face-${face}`, { model_id: model.id, image_id: image.id,
        asset_path: image.file, scope: "panorama_view" }));
    }
  }
  if (!images.length) return { status: "no_images", model_id: model.id };
  let analysis;
  try { analysis = await analyzeImages(images, "Describe visible room use and installed sinks, cabinets or other interior features. Do not infer current tenancy or a verified suite identity.", signal); }
  catch { throw new SpatialError("matterport", "UNAVAILABLE", "Matterport images were retrieved but visual analysis is unavailable."); }
  return { status: "ok", model_id: model.id, room_id: room?.id ?? null, scope: "scan_extent_unverified_for_suite", captured_at: null,
    coverage: { sampled_panorama_ids: selected, available_panoramas: available.length, image_count: images.length,
      exhaustive: false }, analysis,
    limitations: ["This is a bounded sample, not a complete scan inventory.", "Repeated views can show the same object; do not sum counts across views.", "Not observed does not mean absent. Scan date and suite extent remain unverified."],
    source_references: refs };
}
