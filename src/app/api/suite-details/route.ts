// GET /api/suite-details?property_id=…&lat=…&lon=…&category=…&sqft=…
// Neighbors, rent comps and "who should lease next" for one suite, from the hosted CoStar database.

import { suiteDetails } from "@/lib/suite-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: string | null) => (v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const property_id = q.get("property_id") ?? "";
  const category = q.get("category") ?? "";
  if (!/^[1-9]\d{0,17}$/.test(property_id) || !/^[a-z]{0,20}$/.test(category)) {
    return Response.json({ error: "Pass a numeric property_id and a business category." }, { status: 400 });
  }
  try {
    const details = await suiteDetails({ property_id, latitude: num(q.get("lat")), longitude: num(q.get("lon")), category, sqft: num(q.get("sqft")) });
    return Response.json(details, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("Suite details failed:", (e as Error).message);
    return Response.json({ error: "Suite details are unavailable right now." }, { status: 503 });
  }
}
