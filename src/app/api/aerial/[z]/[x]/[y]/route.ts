// GET /api/aerial/{z}/{x}/{y}: one Vexcel aerial map tile (Web Mercator, 256 px).
// The Vexcel key stays on the server; the browser only ever sees this address.

export const runtime = "nodejs";

const WMTS = "https://api.vexcelgroup.com/v2/ortho/wmts";
// Small in-memory cache so panning back and forth doesn't re-download (and re-bill) the same tiles.
const cache = new Map<string, { body: ArrayBuffer; type: string }>();
const MAX_CACHED = 1500;

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const [zi, xi, yi] = [z, x, y.replace(/\.(png|jpe?g)$/, "")].map((v) => Number(v));
  const n = 2 ** zi;
  if (![zi, xi, yi].every(Number.isInteger) || zi < 3 || zi > 21 || xi < 0 || yi < 0 || xi >= n || yi >= n) {
    return new Response("Bad tile", { status: 400 });
  }
  const key = process.env.VEXCEL_API_KEY?.trim();
  if (!key) return new Response("Aerial imagery needs VEXCEL_API_KEY", { status: 503 });

  const id = `${zi}/${xi}/${yi}`;
  const hit = cache.get(id);
  const headers = (type: string) => ({ "Content-Type": type, "Cache-Control": "public, max-age=86400, immutable" });
  if (hit) return new Response(hit.body, { headers: headers(hit.type) });

  // High-resolution "urban" imagery where it exists, wide-area coverage otherwise.
  for (const layer of zi >= 12 ? ["urban", "wide-area"] : ["wide-area"]) {
    const url = new URL(WMTS);
    for (const [k, v] of Object.entries({
      service: "wmts", request: "getTile", layer, Style: "RGB", TileMatrixSet: layer,
      TileMatrix: String(zi), TileRow: String(yi), TileCol: String(xi), format: "image/jpeg", api_key: key,
    })) url.searchParams.set(k, v);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const type = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (!res.ok || !type.startsWith("image/")) continue;
      const body = await res.arrayBuffer();
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
      cache.set(id, { body, type });
      return new Response(body, { headers: headers(type) });
    } catch {
      // try the next layer
    }
  }
  return new Response(null, { status: 204 });
}
