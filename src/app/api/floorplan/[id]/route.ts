// Serves a scan's floor plan image from the local cache (run scripts/fetch-spatial.ts first).
// Matterport images stay out of the public repo; each machine downloads its own copy.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) return new Response("Bad model id", { status: 400 });
  const file = path.join(process.cwd(), "cache", "matterport", id, "floorplan.jpg");
  if (!existsSync(file)) {
    return new Response(`No floor plan cached for ${id}. Run: npx tsx --env-file=.env.local scripts/fetch-spatial.ts ${id}`, {
      status: 404,
    });
  }
  return new Response(readFileSync(file), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
}
