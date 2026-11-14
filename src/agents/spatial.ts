// ROLE 2 · Matterport + Vexcel
// Returns the SAME shape as the sample in data/demo.json.
// inspect() reads the labels saved by scripts/label-rooms.ts and falls back to the demo sample if they're missing.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import demo from "../../data/demo.json";
import type { Card } from "./index";

// Suite key → Matterport model id. Add suites here as they get labeled.
const MODEL_FOR: Record<string, string> = {
  travis_900: "mXRDfAHA7iB",
};

export async function inspect(id: string): Promise<Card["inspect"]> {
  const modelId = MODEL_FOR[id];
  const file = modelId && path.join(process.cwd(), "data", "spatial", `inspect_${modelId}.json`);
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return demo.inspect; // not labeled yet: run scripts/label-rooms.ts
}

export async function fit(id: string): Promise<Card["fit"]> {
  return demo.fit; // TODO: does the layout fit the business
}

export async function site(id: string): Promise<Card["site"]> {
  return demo.site; // TODO: aerial image, parking count
}
