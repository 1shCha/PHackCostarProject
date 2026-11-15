// Labels every room of one or more scans and saves the results for the app.
// Run: npx tsx --env-file=.env.local scripts/label-rooms.ts [modelId ...]
//      npx tsx --env-file=.env.local scripts/label-rooms.ts --shortlist   (the demo shortlist below)
// Output: data/spatial/inspect_<modelId>.json (same shape as `inspect` in data/demo.json)
// Uses Gemini first, then Claude when Gemini is out of quota (needs ANTHROPIC_API_KEY). Saved answers are reused.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectModel } from "../src/lib/spatial/inspector";

// Scanned, listed Houston suites picked to cover different businesses (sizes 1.3k–7k sq ft).
const SHORTLIST = [
  "mXRDfAHA7iB", // 6655 Travis · 900 · former medical (hero)
  "LxesjX9RDHT", // MM · 1,569 sf · retail, past personal services
  "hXsQLNJ9589", // 325 · 1,800 sf · past personal services
  "B9b1hGuh61v", // B · 2,000 sf · past personal services
  "bC6qQ2geFYb", // 104 · 1,561 sf · office
  "xestuNsDQSf", // 100 · 1,988 sf · office
  "YnZqEwSebtw", // 206 · 1,327 sf · medical office
  "9xZApYqePUx", // 200 · 2,744 sf · past health care
  "4H2JSnQ3wSj", // 104 · 2,946 sf · retail, past food service
  "ZNwAFka5Dab", // 11-12 · 3,700 sf · retail
  "szdeKc4TjsE", // 415 · 3,364 sf · past professional services
  "xPSkiJhu6Wy", // 150 · 5,989 sf · past health care + professional
  "SgKbPPm1YYW", // 450 · 5,279 sf · landlord demo
  "bmhcaHw66PV", // 1009 · 5,525 sf · flex
];

const verified = (r: { rooms: { status?: string }[] }) => r.rooms.filter((x) => x.status && x.status !== "unverified").length;

async function labelOne(id: string) {
  const result = await inspectModel(id, (m) => console.log(m));
  const dir = path.join(process.cwd(), "data", "spatial");
  mkdirSync(dir, { recursive: true });
  // Never replace a better result: if fewer rooms were verified than last time, save beside it instead.
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
  return { id, rooms: result.rooms.length, verified: verified(result) };
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes("--shortlist") ? SHORTLIST : args.length ? args : ["mXRDfAHA7iB"];
  const summary: { id: string; rooms?: number; verified?: number; error?: string }[] = [];
  for (const id of ids) {
    console.log(`\n=== ${id} (${summary.length + 1}/${ids.length}) ===`);
    try {
      summary.push(await labelOne(id));
    } catch (e) {
      console.log(`FAILED ${id}: ${(e as Error).message}`); // keep going with the next suite
      summary.push({ id, error: (e as Error).message });
    }
  }
  if (ids.length > 1) {
    console.log("\n=== Summary ===");
    for (const s of summary) console.log(s.error ? ` ✗ ${s.id}: ${s.error}` : ` ✓ ${s.id}: ${s.verified}/${s.rooms} rooms verified`);
  }
  if (summary.every((s) => s.error)) process.exit(1);
}

main();
