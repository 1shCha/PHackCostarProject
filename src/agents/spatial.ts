// ROLE 2 · Matterport + Vexcel
// Replace each function body with real API calls (keys go in .env).
// Return the SAME shape as the sample in data/demo.json.

import demo from "../../data/demo.json";
import type { Card } from "./index";

export async function inspect(id: string): Promise<Card["inspect"]> {
  return demo.inspect; // TODO: labeled rooms + feature pins from the 3D scan
}

export async function fit(id: string): Promise<Card["fit"]> {
  return demo.fit; // TODO: does the layout fit the business
}

export async function site(id: string): Promise<Card["site"]> {
  return demo.site; // TODO: aerial image, parking count
}
