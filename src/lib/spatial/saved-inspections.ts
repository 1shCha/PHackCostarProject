// Room labels for a Matterport scan, wherever they were saved:
//  - data/spatial/inspect_<modelId>.json: labeled ahead of time by scripts/label-rooms.ts (shipped with the app)
//  - cache/inspect/<modelId>.json: labeled on demand by POST /api/label-scan/<modelId> (./cache locally, /tmp on Vercel)

import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cacheDir } from "../paths";

export const isModelId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9]{6,20}$/.test(id);

const shippedFile = (id: string) => path.join(process.cwd(), "data", "spatial", `inspect_${id}.json`);
const labeledFile = (id: string) => cacheDir("inspect", `${id}.json`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadInspection(modelId: string | null | undefined): any | null {
  if (!isModelId(modelId)) return null;
  for (const file of [shippedFile(modelId), labeledFile(modelId)]) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* unreadable file: try the next place */
    }
  }
  return null;
}

export function saveInspection(modelId: string, inspection: unknown) {
  if (!isModelId(modelId)) throw new Error("Bad model id");
  mkdirSync(cacheDir("inspect"), { recursive: true });
  writeFileSync(labeledFile(modelId), JSON.stringify(inspection));
}
