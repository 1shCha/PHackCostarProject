// ROLE 1 · CoStar data
// Replace each function body with real code that reads the CoStar kit (put the kit in data/kit/).
// Return the SAME shape as the sample in data/demo.json.

import demo from "../../data/demo.json";
import type { Card } from "./index";

export async function suite(id: string): Promise<Card["suite"]> {
  return demo.suite; // TODO: size, asking rent, listing notes
}

export async function history(id: string): Promise<Card["history"]> {
  return demo.history; // TODO: past tenants of this suite + likely build-out
}

export async function tenantMix(id: string): Promise<Card["tenant_mix"]> {
  return demo.tenant_mix; // TODO: who's in the building now, conflicts, complements
}

export async function pricing(id: string): Promise<Card["pricing"]> {
  return demo.pricing; // TODO: target rent from signed deals
}

export async function prospects(id: string): Promise<Card["prospects"]> {
  return demo.prospects; // TODO: companies whose leases end soon
}
