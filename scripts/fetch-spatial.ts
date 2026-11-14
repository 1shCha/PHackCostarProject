// Downloads and caches the Matterport data for the demo suites, then prints a room summary.
// Run: npx tsx --env-file=.env.local scripts/fetch-spatial.ts [modelId ...]

import { downloadFloorplan, getModel, pickFloorplan } from "../src/lib/spatial/matterport";
import { buildRooms, M2_TO_SQFT } from "../src/lib/spatial/geometry";

const DEMO = {
  mXRDfAHA7iB: "6655 Travis St #900 (hero)",
  dnTP8ULgTbb: "2000 Dairy Ashford #550 (landlord demo)",
  YnZqEwSebtw: "9800 Northwest Fwy #206 (backup)",
  MnXUqTokRqk: "13201 Northwest Fwy #325 (backup)",
};

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DEMO);
  for (const id of ids) {
    console.log(`\n${id}  ${DEMO[id as keyof typeof DEMO] ?? ""}`);
    try {
      const model = await getModel(id);
      const rooms = buildRooms(model);
      const fp = pickFloorplan(model);
      const total = rooms.reduce((s, r) => s + r.areaM2, 0);
      console.log(`  ${model.name}: ${rooms.length} real rooms, ${model.panoLocations.length} scans, ` +
        `${Math.round(total)} m² (${Math.round(total * M2_TO_SQFT).toLocaleString()} sq ft)`);
      for (const r of rooms) {
        console.log(`   - ${r.id.slice(0, 6)}  ${r.areaM2.toFixed(1).padStart(6)} m²  ${r.label} ` +
          `(${Math.round(r.confidence * 100)}%)  ${r.panoIds.length} scans inside`);
      }
      const unplaced = model.panoLocations.length - new Set(rooms.flatMap((r) => r.panoIds)).size;
      if (unplaced) console.log(`  ${unplaced} scans are outside every room outline`);
      if (fp) {
        const file = await downloadFloorplan(id);
        console.log(`  floor plan: ${fp.width}×${fp.height}px, ${fp.resolution} px/m → ${file}`);
      } else {
        console.log("  no photo floor plan found");
      }
    } catch (e) {
      console.log(`  FAILED: ${(e as Error).message}`);
    }
  }
}

main();
