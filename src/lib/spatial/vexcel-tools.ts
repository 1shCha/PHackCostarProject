import "server-only";
import { ToolValidationError } from "../tools/costar";
import { SpatialError, request, readJSON, readBytes, saveImage, sourceReference } from "./common";
import { analyzeImages } from "./visual-analysis";

interface Coverage { type: string; features: { properties: { collection?: string; "last-capture-date"?: string } }[] }
const endpoint = "https://api.vexcelgroup.com/v2";
const layers = "urban,urban-r,wide-area,urban-g";
export function validateCoordinates(latitude: unknown, longitude: unknown): asserts latitude is number {
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 85 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new ToolValidationError("Supply finite longitude (-180..180) and latitude (-85..85) coordinates.");
  }
}
export function vicinityWKT(latitude: number, longitude: number, halfWidth: number) {
  const dy = halfWidth / 111320, dx = halfWidth / (111320 * Math.cos(latitude * Math.PI / 180));
  const west = Math.max(-180, longitude - dx), east = Math.min(180, longitude + dx);
  return `POLYGON((${west} ${latitude-dy},${east} ${latitude-dy},${east} ${latitude+dy},${west} ${latitude+dy},${west} ${latitude-dy}))`;
}
export async function inspect_vexcel_site(input: { latitude: number; longitude: number; half_width_m?: number }, signal?: AbortSignal) {
  validateCoordinates(input?.latitude, input?.longitude);
  const size = input.half_width_m ?? 80;
  if (!Number.isFinite(size) || size < 20 || size > 150) throw new ToolValidationError("half_width_m must be between 20 and 150 metres.");
  const apiKey = process.env.VEXCEL_API_KEY?.trim();
  if (!apiKey) throw new SpatialError("vexcel", "NOT_CONFIGURED", "Configure VEXCEL_API_KEY.");
  const headers = { "X-API-KEY": apiKey };
  const url = new URL(`${endpoint}/ortho/collections`);
  for (const [key, value] of Object.entries({ wkt: `POINT(${input.longitude} ${input.latitude})`, srid: "4326", layer: layers, include: "collection,last-capture-date" })) url.searchParams.set(key, value);
  const coverageResponse = await request("vexcel", url.toString(), { headers }, signal);
  if (coverageResponse.status === 404) return { status: "no_coverage", latitude: input.latitude, longitude: input.longitude };
  const coverage = await readJSON<Coverage>(coverageResponse, "vexcel");
  if (!Array.isArray(coverage.features)) throw new SpatialError("vexcel", "INVALID_RESPONSE", "Vexcel coverage response is invalid.");
  const collections = coverage.features.map((f) => f.properties).filter((p) => typeof p?.collection === "string" && p.collection.length && !Number.isNaN(Date.parse(p["last-capture-date"] ?? "")))
    .sort((a, b) => Date.parse(b["last-capture-date"]!) - Date.parse(a["last-capture-date"]!) || a.collection!.localeCompare(b.collection!));
  if (!collections.length) return { status: "no_coverage", latitude: input.latitude, longitude: input.longitude };
  const selected = collections[0];
  const wkt = vicinityWKT(input.latitude, input.longitude, size);
  const response = await request("vexcel", `${endpoint}/ortho/extract`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ wkt, srid: 4326, layer: layers, collection: selected.collection, crop: "bounding_box", "image-format": "jpeg", zoom: 20 }) }, signal);
  if (response.status === 404) return { status: "no_coverage", collection: selected.collection };
  const type = response.headers.get("content-type")?.split(";")[0];
  if (type !== "image/jpeg" && type !== "image/png") throw new SpatialError("vexcel", "INVALID_RESPONSE", "Vexcel did not return an image.");
  const image = await saveImage(await readBytes(response, "vexcel"), type);
  let analysis;
  try { analysis = await analyzeImages([image], "Describe visible parking areas, marked stalls, loading areas and outdoor space in this aerial vicinity image. Counts, if defensible, apply only to visible marked stalls in this image, not building-owned or currently available spaces.", signal); }
  catch { throw new SpatialError("vexcel", "UNAVAILABLE", "Vexcel imagery was retrieved but visual analysis is unavailable."); }
  return { status: "ok", latitude: input.latitude, longitude: input.longitude, collection: selected.collection,
    captured_at: selected["last-capture-date"], scope: "coordinate_vicinity_not_verified_parcel", half_width_m: size, wkt, analysis,
    limitations: ["Coverage date is collection metadata; exact pixel capture time is not independently verified.", "The image covers a coordinate vicinity, not a verified property boundary. Parking ownership and current availability are unknown.", "Vehicles, shadows and trees may obscure stalls. Visual counts are approximate."],
    source_references: [sourceReference("vexcel", `${selected.collection}:${image.id}`, { image_id: image.id, asset_path: image.file,
      captured_at: selected["last-capture-date"]!, scope: "coordinate_vicinity" })] };
}
