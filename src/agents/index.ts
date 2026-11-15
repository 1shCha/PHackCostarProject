// ROLE 3 · Runs every agent.

import type demo from "../../data/demo.json";
import { blankCard } from "./blank";
import { suite, history, tenantMix, pricing, prospects } from "./costar";
import { inspect, fit, site } from "./spatial";

// The SHAPE of everything comes from data/demo.json (its values are never shown).
// Need a new field? Add it to demo.json and blank.ts.
export type Card = typeof demo;

export async function negotiate(id: string): Promise<Card["negotiate"]> {
  return blankCard().negotiate; // the offer screen writes the letter from the real suite numbers
}

export async function runAll(id: string): Promise<Card> {
  const [s, h, m, p, pr, n, i, f, si] = await Promise.all([
    suite(id), history(id), tenantMix(id), pricing(id), prospects(id), negotiate(id), inspect(id), fit(id), site(id),
  ]);
  return { suite: s, history: h, tenant_mix: m, pricing: p, prospects: pr, negotiate: n, inspect: i, fit: f, site: si };
}
