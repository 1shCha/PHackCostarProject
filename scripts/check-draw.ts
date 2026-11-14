// Draws room outlines and scan positions over the floor plan so you can check they line up.
// Run after fetch-spatial: npx tsx --env-file=.env.local scripts/check-draw.ts [modelId]
// Then open the printed .svg file in a browser.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { downloadFloorplan, getModel, pickFloorplan } from "../src/lib/spatial/matterport";
import { buildRooms, centroid, toPx } from "../src/lib/spatial/geometry";

async function main() {
  const id = process.argv[2] ?? "mXRDfAHA7iB";
  const model = await getModel(id);
  const fp = pickFloorplan(model);
  if (!fp) throw new Error("No photo floor plan for this model");
  const image = await downloadFloorplan(id);
  const rooms = buildRooms(model);

  const shapes = rooms.map((r, i) => {
    const pts = r.outline.map((p) => toPx(p, fp).join(",")).join(" ");
    const [cx, cy] = toPx(centroid(r.outline), fp);
    return `<polygon points="${pts}" fill="hsla(${(i * 47) % 360},80%,50%,0.18)" stroke="#ff5a00" stroke-width="6"/>
  <text x="${cx}" y="${cy}" font-size="44" font-family="sans-serif" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="8" paint-order="stroke">${r.areaM2.toFixed(0)} m² · ${r.panoIds.length} scans</text>`;
  });
  const dots = model.panoLocations.map((p) => {
    const [x, y] = toPx(p.position, fp);
    return `<circle cx="${x}" cy="${y}" r="14" fill="#0a6cff" stroke="#fff" stroke-width="4"/>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fp.width} ${fp.height}" width="${fp.width / 2}">
  <image href="${path.basename(image)}" width="${fp.width}" height="${fp.height}"/>
  ${shapes.join("\n  ")}
  ${dots.join("\n  ")}
</svg>`;
  const out = path.join(path.dirname(image), "check.svg");
  writeFileSync(out, svg);
  console.log(`Wrote ${out}\nOrange outlines should sit on the walls; blue dots are the ${model.panoLocations.length} scan positions.`);
}

main();
