// GET /api/tour-places/{modelId}: named spots inside a scan for the voice tour ("take me to the exam room").
// Names come from our own room labels (see src/lib/spatial/saved-inspections.ts); floor-plan pixels are converted
// to Matterport model metres so the browser can line them up with the 3D photo spots.

import { loadInspection } from "@/lib/spatial/saved-inspections";
import { getModel, pickFloorplan, type Floorplan } from "@/lib/spatial/matterport";

export const runtime = "nodejs";

type Zone = { label: string; display: string; x: number; y: number };
type InspectRoom = { id: string; label: string; display: string; polygon?: [number, number][]; zones?: Zone[] };
type Inspect = { floorplan?: { width?: number; height?: number }; rooms: InspectRoom[] };

const toModel = (fp: Floorplan, px: number, py: number) => ({
  x: fp.origin.x + px / fp.resolution,
  y: fp.origin.y + (fp.height - py) / fp.resolution,
});

export async function GET(_req: Request, { params }: { params: Promise<{ modelId: string }> }) {
  const { modelId } = await params;
  if (!/^[A-Za-z0-9]{6,20}$/.test(modelId)) return Response.json({ error: "Bad model id" }, { status: 400 });
  const inspect: Inspect | null = loadInspection(modelId);
  if (!inspect) return Response.json({ places: [], panos: [] });

  try {
    const model = await getModel(modelId);
    // Use the floor plan whose size matches the one the labels were drawn on.
    const candidates = [pickFloorplan(model), pickFloorplan(model, { measurements: true })].filter((f): f is Floorplan => !!f);
    const fp = candidates.find((f) => f.width === inspect.floorplan?.width && f.height === inspect.floorplan?.height) ?? candidates[0];
    if (!fp) return Response.json({ places: [], panos: [] });

    const places: { label: string; display: string; x: number; y: number }[] = [];
    for (const room of inspect.rooms) {
      if (room.zones?.length) {
        for (const z of room.zones) if (z.label !== "other") places.push({ label: z.label, display: z.display, ...toModel(fp, z.x, z.y) });
      } else if (room.label !== "other" && room.polygon?.length) {
        const cx = room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length;
        const cy = room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length;
        places.push({ label: room.label, display: room.display, ...toModel(fp, cx, cy) });
      }
    }
    const panos = model.panoLocations.map((p) => ({ id: p.id, x: p.position.x, y: p.position.y, z: p.position.z }));
    return Response.json({ places, panos }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("tour-places failed:", (e as Error).message);
    return Response.json({ places: [], panos: [] });
  }
}
