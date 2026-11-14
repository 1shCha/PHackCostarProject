// Every SecondLife agent is one function here.
// Right now each returns sample data from data/demo.json.
// To build yours: replace the body with real code, but return the SAME shape as the sample.

import demo from "../data/demo.json";

// The shape of everything is taken straight from data/demo.json.
// Want a new field? Add it to demo.json first, so everyone sees it.
export type Card = typeof demo;

// ---------- Role 1: CoStar data ----------
export async function suite(id: string): Promise<Card["suite"]> {
  return demo.suite; // TODO Role 1: size, asking rent, listing notes from the CoStar kit
}

export async function history(id: string): Promise<Card["history"]> {
  return demo.history; // TODO Role 1: past tenants of this suite + likely build-out
}

export async function tenantMix(id: string): Promise<Card["tenant_mix"]> {
  return demo.tenant_mix; // TODO Role 1: who's in the building now, conflicts, complements
}

export async function pricing(id: string): Promise<Card["pricing"]> {
  return demo.pricing; // TODO Role 1: target rent from signed deals
}

export async function prospects(id: string): Promise<Card["prospects"]> {
  return demo.prospects; // TODO Role 1: companies whose leases end soon
}

export async function negotiate(id: string): Promise<Card["negotiate"]> {
  return demo.negotiate; // TODO Role 1 / Role 3: letter written by Claude from the pricing numbers
}

// ---------- Role 2: Matterport + Vexcel ----------
export async function inspect(id: string): Promise<Card["inspect"]> {
  return demo.inspect; // TODO Role 2: labeled rooms + pins from the 3D scan
}

export async function fit(id: string): Promise<Card["fit"]> {
  return demo.fit; // TODO Role 2: does the layout fit the business
}

export async function site(id: string): Promise<Card["site"]> {
  return demo.site; // TODO Role 2: aerial image, parking
}

// ---------- Role 3: runs everything ----------
export async function runAll(id: string): Promise<Card> {
  const [s, h, m, p, pr, n, i, f, si] = await Promise.all([
    suite(id), history(id), tenantMix(id), pricing(id), prospects(id), negotiate(id), inspect(id), fit(id), site(id),
  ]);
  return { suite: s, history: h, tenant_mix: m, pricing: p, prospects: pr, negotiate: n, inspect: i, fit: f, site: si };
}
