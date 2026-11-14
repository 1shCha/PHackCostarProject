// ROLE 3 · Runs every agent and writes the letter (Claude on Bedrock goes here).

import demo from "../../data/demo.json";
import { suite, history, tenantMix, pricing, prospects } from "./costar";
import { inspect, fit, site } from "./spatial";

// The shape of everything comes from data/demo.json.
// Need a new field? Add it to demo.json first so everyone sees it.
export type Card = typeof demo;

export async function negotiate(id: string): Promise<Card["negotiate"]> {
  return demo.negotiate; // TODO Role 3: Claude writes the letter from the pricing numbers
}

export async function runAll(id: string): Promise<Card> {
  const [s, h, m, p, pr, n, i, f, si] = await Promise.all([
    suite(id), history(id), tenantMix(id), pricing(id), prospects(id), negotiate(id), inspect(id), fit(id), site(id),
  ]);
  return { suite: s, history: h, tenant_mix: m, pricing: p, prospects: pr, negotiate: n, inspect: i, fit: f, site: si };
}
