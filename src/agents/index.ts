// ROLE 3 · Runs every agent and writes the letter with Claude.

import demo from "../../data/demo.json";
import { askClaude } from "./claude";
import { suite, history, tenantMix, pricing, prospects } from "./costar";
import { inspect, fit, site } from "./spatial";

// The shape of everything comes from data/demo.json.
// Need a new field? Add it to demo.json first so everyone sees it.
export type Card = typeof demo;

type LetterInput = Pick<Card, "suite" | "history" | "pricing" | "tenant_mix">;

/** Code does the numbers; Claude only writes the words. Falls back to the sample letter without an API key. */
export async function negotiate(id: string, input: LetterInput): Promise<Card["negotiate"]> {
  const { suite: s, history: h, pricing: p, tenant_mix: m } = input;

  // The asks are computed by code from real numbers, never invented by the AI.
  const target = p.target_rent_psf_yr;
  const opening = Math.round(target * 0.95 * 100) / 100;
  const asks = [
    `Base rent $${opening.toFixed(2)}/sf/yr, ${p.service_type} (target $${target}/sf/yr from ${p.n_deals} signed deals)`,
    "3 months free rent",
    "Use the existing medical build-out as-is",
  ];
  const fallbacks = [`Accept $${target.toFixed(2)}/sf/yr with 4 months free`, "Shorter 5-year term with a renewal option"];

  const facts = {
    space: `${s.address}, Suite ${s.suite}, ${s.sqft} sq ft, ${s.use}, asking $${s.asking_rent_psf_yr}/sf/yr ${s.service_type}`,
    listing_notes: s.listing_notes,
    past_tenants: h.timeline.filter((t) => t.match !== "same_floor").map((t) => `${t.tenant} (${t.category}, ${t.from}–${t.to}, ${t.match})`),
    likely_buildout: h.likely_buildout.map((b) => b.feature),
    building: m.complements.map((c) => c.reason),
    our_asks: asks,
  };

  const letter = await askClaude(
    "You write short, professional letters of intent for commercial office leases on behalf of a tenant. " +
      "Use only the facts given. Never invent numbers, names or features. Plain text, no markdown, under 220 words.",
    `Write a letter of intent from a dermatology practice to the landlord of this suite.\n` +
      `Explain why the space fits (existing build-out, past medical use), then state our asks exactly as written.\n\n` +
      `Facts:\n${JSON.stringify(facts, null, 2)}`,
  );

  return {
    mode: "tenant",
    subject: `Letter of intent: ${s.address}, Suite ${s.suite}`,
    letter: letter ?? demo.negotiate.letter,
    asks,
    fallbacks,
  };
}

export async function runAll(id: string): Promise<Card> {
  const [s, h, m, p, pr, i, f, si] = await Promise.all([
    suite(id), history(id), tenantMix(id), pricing(id), prospects(id), inspect(id), fit(id), site(id),
  ]);
  // The letter needs the other agents' results, so it runs after them.
  const n = await negotiate(id, { suite: s, history: h, pricing: p, tenant_mix: m });
  return { suite: s, history: h, tenant_mix: m, pricing: p, prospects: pr, negotiate: n, inspect: i, fit: f, site: si };
}
