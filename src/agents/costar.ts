// ROLE 1 · CoStar data
// Real suite data reaches the app through the search (src/lib/search.ts → hosted database) and the chat tools.
// These return empty values (never sample data) until a per-suite database route replaces them.

import { blankCard } from "./blank";
import type { Card } from "./index";

export async function suite(_id: string): Promise<Card["suite"]> {
  return blankCard().suite;
}

export async function history(_id: string): Promise<Card["history"]> {
  return blankCard().history;
}

export async function tenantMix(_id: string): Promise<Card["tenant_mix"]> {
  return blankCard().tenant_mix; // real source: tenants_current for the property (needs a backend route)
}

export async function pricing(_id: string): Promise<Card["pricing"]> {
  return blankCard().pricing; // real source: rent_evidence for the property (needs a backend route)
}

export async function prospects(_id: string): Promise<Card["prospects"]> {
  return blankCard().prospects; // real source: tenants_current lease expirations nearby (needs a backend route)
}
