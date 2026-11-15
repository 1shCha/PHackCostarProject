// ROLE 2 · Matterport + Vexcel
// Returns the SAME shape as the sample in data/demo.json (plus extra fields).
// inspect() reads the labels saved by scripts/label-rooms.ts and falls back to the demo sample if they're missing.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import demo from "../../data/demo.json";
import type { Card } from "./index";
import { history } from "./costar";
import { fitFor } from "@/lib/spatial/buildout";
import { profileFor } from "@/lib/spatial/profiles";

// Suite key → Matterport model id. Add suites here as they get labeled.
const MODEL_FOR: Record<string, string> = {
  travis_900: "mXRDfAHA7iB",
};

function savedInspection(id: string) {
  const modelId = MODEL_FOR[id];
  const file = modelId && path.join(process.cwd(), "data", "spatial", `inspect_${modelId}.json`);
  return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export async function inspect(id: string): Promise<Card["inspect"]> {
  return savedInspection(id) ?? demo.inspect; // not labeled yet: run scripts/label-rooms.ts
}

/**
 * Does the space fit a business, and what would the build-out cost?
 * `business` is plain words ("nail salon", "law firm with 6 attorneys"). Defaults to a medical practice for the demo.
 */
export async function fit(id: string, business = "medical practice"): Promise<Card["fit"]> {
  const insp = savedInspection(id);
  if (!insp) return demo.fit;
  const [profile, h] = await Promise.all([profileFor(business), history(id)]);
  return fitFor(insp, profile, h.timeline) as unknown as Card["fit"];
}

export async function site(id: string): Promise<Card["site"]> {
  return demo.site; // TODO: aerial image, parking count
}
