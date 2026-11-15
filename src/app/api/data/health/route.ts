import { getDuckDBHealth } from "@/lib/duckdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const database = await getDuckDBHealth();
    return Response.json({ status: "ok", database }, { headers });
  } catch (error) {
    console.error("DuckDB health check failed:", error);
    return Response.json(
      { status: "unavailable", error: "Database unavailable. Check server configuration and logs." },
      { status: 503, headers },
    );
  }
}
