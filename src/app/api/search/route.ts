// GET /api/search?q=I'm a barber looking for 1,500–2,000 sq ft in Houston
// Returns ranked real suites (see src/lib/search.ts for the shape and scoring).

import { usesRemoteBackend } from "@/lib/backend";
import { searchSpaces } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 300) {
    return Response.json({ error: "Pass ?q= with a short description, e.g. barber, 1500-2000 sq ft, Houston" }, { status: 400 });
  }
  try {
    return Response.json(await searchSpaces(q), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = (e as Error).message;
    console.error("Search failed:", message);
    const noDb = /DUCKDB_PATH|database file/i.test(message);
    const remote = usesRemoteBackend();
    return Response.json(
      { error: remote ? "Search database is unavailable. Check the backend connection." : noDb ? "Search needs the CoStar database: set DUCKDB_PATH in .env.local" : "Search failed" },
      { status: remote || noDb ? 503 : 500 },
    );
  }
}
