// Labels every room of a scan with Gemini and saves the result for the app.
// Run: npx tsx --env-file=.env.local scripts/label-rooms.ts [modelId]
// Output: data/spatial/inspect_<modelId>.json (same shape as `inspect` in data/demo.json)

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectModel } from "../src/lib/spatial/inspector";

async function main() {
  const id = process.argv[2] ?? "mXRDfAHA7iB";
  const result = await inspectModel(id, (m) => console.log(m));
  const dir = path.join(process.cwd(), "data", "spatial");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `inspect_${id}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));

  console.log(`\nSaved ${file}`);
  console.log(`${result.measured.rooms} rooms, ${result.measured.scans} scans, ${result.measured.area_sqft.toLocaleString()} sq ft measured`);
  for (const r of result.rooms) {
    const feats = r.features.map((f) => f.type).join(", ") || "no features";
    console.log(` - ${r.display} · ${r.area_sqft} sq ft · ${Math.round(r.confidence * 100)}% · ${feats}`);
  }
  console.log("Counts:", result.counts);
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
