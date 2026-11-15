// Serves a scan's floor plan image. Uses the cached copy if there is one; otherwise asks Matterport for a
// fresh link and downloads it (./cache locally, /tmp on Vercel). Matterport images stay out of the public repo.

import { readFileSync } from "node:fs";
import { downloadFloorplan } from "@/lib/spatial/matterport";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) return new Response("Bad model id", { status: 400 });
  try {
    const file = await downloadFloorplan(id); // returns the cached file when it exists
    return new Response(readFileSync(file), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    console.error(`Floor plan ${id}:`, (e as Error).message);
    return new Response(`No floor plan available for ${id}`, { status: 404 });
  }
}
