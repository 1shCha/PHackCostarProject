// Labels every room of a scan with Gemini and saves the result for the app.
// Run: npx tsx --env-file=.env.local scripts/label-rooms.ts [modelId]
// Output: data/spatial/inspect_<modelId>.json (same shape as `inspect` in data/demo.json)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectModel } from "../src/lib/spatial/inspector";

async function main() {
  const id = process.argv[2] ?? "mXRDfAHA7iB";
  const result = await inspectModel(id, (m) => console.log(m));
  const dir = path.join(process.cwd(), "data", "spatial");
  mkdirSync(dir, { recursive: true });
  // Never replace a better result: if fewer rooms were verified than last time, save beside it instead.
  const verified = (r: { rooms: { status?: string }[] }) => r.rooms.filter((x) => x.status && x.status !== "unverified").length;
  let file = path.join(dir, `inspect_${id}.json`);
  if (existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, "utf8"));
    if (prev.rooms?.every((x: { status?: string }) => x.status) && verified(result) < verified(prev)) {
      file = path.join(dir, `inspect_${id}.partial.json`);
      console.log(`\nThis run verified fewer rooms than the saved result, so the saved result was kept.`);
    }
  }
  writeFileSync(file, JSON.stringify(result, null, 2));

  console.log(`\nSaved ${file}`);
  console.log(`${result.measured.rooms} rooms, ${result.measured.scans} scans, ${result.measured.area_sqft.toLocaleString()} sq ft measured`);
  for (const r of result.rooms) {
    const feats = r.features.map((f) => (f.seen_in > 1 ? `${f.type} (seen ${f.seen_in}×)` : f.type)).join(", ") || "no features";
    console.log(` - ${r.display} · ${r.area_sqft} sq ft · ${Math.round(r.confidence * 100)}% ${r.status} (${r.source}) · ${feats}`);
  }
  console.log("Counts:", result.counts);
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
