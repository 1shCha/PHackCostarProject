import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceReference } from "../tools/costar";

export type SpatialSource = "matterport" | "vexcel";
export class SpatialError extends Error {
  constructor(public readonly source: SpatialSource, public readonly code: "NOT_CONFIGURED" | "UNAVAILABLE" | "INVALID_RESPONSE", message: string) {
    super(message); this.name = "SpatialError";
  }
}
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const cacheDirectory = () => path.resolve(process.env.SPATIAL_CACHE_DIR || "cache/spatial-tools");
export function sourceReference(source: SpatialSource, record_id: string, details: Partial<SourceReference> = {}): SourceReference {
  return { dataset: source, source_line: null, source_file: source === "matterport" ? "https://api.matterport.com/api/models/graph" : "https://api.vexcelgroup.com/v2/ortho/extract",
    record_id, field_path: null, source_type: source, retrieved_at: new Date().toISOString(), captured_at: null, ...details };
}
export async function cachedJSON<T>(key: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path.join(cacheDirectory(), `${hash(key)}.json`), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function saveJSON(key: string, value: unknown) {
  await mkdir(cacheDirectory(), { recursive: true });
  await writeFile(path.join(cacheDirectory(), `${hash(key)}.json`), JSON.stringify(value));
}
export interface EvidenceImage { id: string; mime_type: "image/jpeg" | "image/png"; bytes: Buffer; file: string }
export async function saveImage(bytes: Uint8Array, mime_type: EvidenceImage["mime_type"]): Promise<EvidenceImage> {
  const id = hash(bytes);
  const file = path.join(cacheDirectory(), `${id}.${mime_type === "image/png" ? "png" : "jpg"}`);
  await mkdir(cacheDirectory(), { recursive: true });
  await writeFile(file, bytes);
  return { id, mime_type, bytes: Buffer.from(bytes), file };
}

// Bound network and memory use, and never include provider bodies or signed URLs
// in errors. Credentials are sent only by the vendor-specific clients.
export async function request(source: SpatialSource, url: string, init: RequestInit = {}, signal?: AbortSignal) {
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]) });
    if (!response.ok && response.status !== 404) throw new SpatialError(source, "UNAVAILABLE", `${source} returned HTTP ${response.status}.`);
    return response;
  } catch (error) {
    if (error instanceof SpatialError) throw error;
    throw new SpatialError(source, "UNAVAILABLE", `${source} request failed or timed out.`);
  }
}
export async function readBytes(response: Response, source: SpatialSource, limit = 16 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new SpatialError(source, "INVALID_RESPONSE", `${source} returned no body.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new SpatialError(source, "INVALID_RESPONSE", `${source} response is too large.`); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
export async function readJSON<T>(response: Response, source: SpatialSource): Promise<T> {
  try { return JSON.parse((await readBytes(response, source)).toString("utf8")) as T; }
  catch (error) { if (error instanceof SpatialError) throw error; throw new SpatialError(source, "INVALID_RESPONSE", `${source} returned invalid JSON.`); }
}
