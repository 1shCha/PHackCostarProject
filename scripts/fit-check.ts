// Shows how well a labeled suite fits any business, with the build-out estimate.
// Run: npx tsx --env-file=.env.local scripts/fit-check.ts "nail salon" ["law firm" ...]
// Uses the saved labels in data/spatial (run label-rooms.ts first). Custom businesses use one Gemini request each.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fitFor } from "../src/lib/spatial/buildout";
import { profileFor } from "../src/lib/spatial/profiles";

async function main() {
  const modelId = process.env.MODEL_ID ?? "mXRDfAHA7iB";
  const insp = JSON.parse(readFileSync(path.join(process.cwd(), "data", "spatial", `inspect_${modelId}.json`), "utf8"));
  const businesses = process.argv.slice(2).length ? process.argv.slice(2) : ["dermatologist", "nail salon", "law firm", "construction company"];
  for (const b of businesses) {
    const profile = await profileFor(b);
    const r = fitFor(insp, profile);
    console.log(`\n${b} → ${r.profile.name} · fit ${r.score}%`);
    for (const c of r.checks) console.log(`  ${c.status === "pass" ? "✓" : c.status === "partial" ? "~" : "✗"} ${c.need}: ${c.evidence}`);
    console.log(`  Already in place: ${r.buildout.already_in_place.summary}`);
    console.log(`  To add:           ${r.buildout.to_add.summary}`);
    console.log(`  To remove:        ${r.buildout.to_remove.summary}`);
  }
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
