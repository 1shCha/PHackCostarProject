import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { routeQuestion, orderedExecutor } from "../ai/routing";
import { AgentError, runAgentLoop } from "../ai/agent-core";
import { get_matterport_rooms, inspect_matterport_features } from "./matterport-tools";
import { inspect_vexcel_site, vicinityWKT } from "./vexcel-tools";
import { validateVisualReport } from "./visual-analysis";
import { SpatialError, hash } from "./common";
import { ToolValidationError } from "../tools/costar";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=", "base64");
const imageId = hash(png);
const model = {
  id: "fixture123", name: "Fixture Suite", assets: { floorplans: [] },
  floors: [{ id: "floor", vertices: [
    { id: "a", position: { x: 0, y: 0 } }, { id: "b", position: { x: 4, y: 0 } },
    { id: "c", position: { x: 4, y: 4 } }, { id: "d", position: { x: 0, y: 4 } },
  ], edges: [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]].map((vertices, i) => ({ id: `e${i}`, type: "wall", thickness: 0.1, vertices: vertices.map((id) => ({ id })) })) }],
  rooms: [{ id: "room1", floor: { id: "floor" }, classifications: [{ label: "Other", confidence: 0.5 }], dimensionEstimates: null, boundary: { edges: [0, 1, 2, 3].map((i) => ({ id: `e${i}` })) } }],
  panoLocations: ["p1", "p2"].map((id) => ({ id, label: id, position: { x: 1, y: 1, z: 1 } })),
};
function report(feature = "sink") { return { summary: "Visible evidence only", observations: [{ feature, status: "observed", approximate_count: 1, evidence: "Visible in supplied view", image_ids: [imageId] }], limitations: ["Partial coverage"] }; }

async function fixture(run: (calls: { vendor: string; body?: Record<string, unknown> }[]) => Promise<void>, mode = "ok") {
  const originalFetch = globalThis.fetch;
  const names = ["SPATIAL_CACHE_DIR", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "VEXCEL_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"];
  const env = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const directory = await mkdtemp(path.join(os.tmpdir(), "spatial-test-"));
  process.env.SPATIAL_CACHE_DIR = directory;
  for (const name of names.slice(1)) process.env[name] = "synthetic-test-key";
  const calls: { vendor: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (url.hostname === "api.matterport.com") {
      calls.push({ vendor: "matterport", body });
      assert.ok(new Headers(options?.headers).get("Authorization")?.startsWith("Basic "));
      if (mode === "mp_error") return Response.json({ errors: [{ message: "private provider data" }] });
      if (String(body.query).includes("skybox")) return Response.json({ data: { model: { panoLocations: model.panoLocations.map((p) => ({ id: p.id, skybox: { children: Array.from({ length: 6 }, (_, i) => `https://cdn-2.matterport.com/${p.id}/${i}.png`) } })) } } });
      return Response.json({ data: { model } });
    }
    if (url.hostname === "cdn-2.matterport.com") {
      calls.push({ vendor: "panorama" }); return new Response(png, { headers: { "Content-Type": "image/png" } });
    }
    if (url.hostname === "api.vexcelgroup.com") {
      assert.equal(new Headers(options?.headers).get("X-API-KEY"), "synthetic-test-key");
      assert.equal(url.searchParams.has("api_key"), false);
      calls.push({ vendor: url.pathname, body });
      if (mode === "no_coverage") return Response.json({}, { status: 404 });
      if (url.pathname.endsWith("collections")) return Response.json({ type: "FeatureCollection", features: [
        { properties: { collection: "old", "last-capture-date": "2020-01-01" } },
        { properties: { collection: "new", "last-capture-date": "2025-01-01" } },
      ] });
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      calls.push({ vendor: "gemini" }); return Response.json({ error: { code: 429 } }, { status: 429 });
    }
    if (url.hostname === "api.anthropic.com") {
      calls.push({ vendor: "claude", body });
      return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: "test", stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "report", name: "report_visual_evidence", input: report(mode === "aerial" ? "parking_stalls" : "sink") }] });
    }
    throw new Error("Unexpected external request in fixture");
  };
  try { await run(calls); }
  finally { globalThis.fetch = originalFetch; for (const name of names) { if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; } await rm(directory, { recursive: true, force: true }); }
}

test("routing starts with the direct source and permits entity lookup before domain work", async () => {
  assert.equal(routeQuestion("Who were the past tenants?").primary_source, "duckdb");
  assert.equal(routeQuestion("How many rooms and sinks?").primary_source, "matterport");
  assert.equal(routeQuestion("Parking and outdoor space?").primary_source, "vexcel");
  assert.deepEqual(routeQuestion("Past tenants then cabinets").requested_sources, ["duckdb", "matterport"]);
  assert.deepEqual(routeQuestion("Sinks and past tenants").requested_sources, ["matterport", "duckdb"]);
  assert.equal(routeQuestion("Tell me about this address").primary_source, null);
  assert.ok(routeQuestion("What is the rent?").unsupported_capabilities.length);
  const called: string[] = [];
  const execute = orderedExecutor(routeQuestion("Sinks and past tenants"), async (name) => { called.push(name); return {}; });
  await execute("find_properties", {});
  await execute("get_spatial_context", {});
  await assert.rejects(execute("get_tenant_history", {}), ToolValidationError);
  await execute("get_matterport_rooms", {});
  await execute("get_tenant_history", {});
  assert.deepEqual(called, ["find_properties", "get_spatial_context", "get_matterport_rooms", "get_tenant_history"]);
});

test("Matterport room evidence has unknown capture date and unverified suite extent", async () => fixture(async (calls) => {
  const result = await get_matterport_rooms({ model_id: "fixture123" });
  assert.equal(result.room_count, 1);
  assert.equal(result.panorama_count, 2);
  assert.equal(result.captured_at, null);
  assert.equal(result.scope, "scan_extent_unverified_for_suite");
  assert.equal(result.source_references[0].source_line, null);
  await get_matterport_rooms({ model_id: "fixture123" });
  assert.equal(calls.filter((c) => c.vendor === "matterport").length, 1);
}));

test("Matterport analysis is bounded, cites actual images and uses Claude on Gemini quota", async () => fixture(async (calls) => {
  const result = await inspect_matterport_features({ model_id: "fixture123", room_id: "room1" });
  assert.equal(result.status, "ok");
  assert.ok(result.analysis && result.coverage && result.source_references);
  assert.equal(result.coverage.sampled_panorama_ids.length, 1);
  assert.equal(result.coverage.exhaustive, false);
  assert.equal(result.analysis.provider, "anthropic");
  assert.equal(result.analysis.fallback, true);
  assert.equal(result.source_references.length, 4);
  assert.equal(result.source_references[0].image_id, imageId);
  assert.ok((await stat(result.source_references[0].asset_path!)).isFile());
  const visionCalls = calls.filter((call) => call.vendor === "claude").length;
  await inspect_matterport_features({ model_id: "fixture123", room_id: "room1" });
  assert.equal(calls.filter((call) => call.vendor === "claude").length, visionCalls);
  assert.equal((await inspect_matterport_features({ model_id: "fixture123", room_id: "missing" })).status, "not_found");
}));

test("Vexcel pins the newest collection and keeps vicinity separate from parcel ownership", async () => fixture(async (calls) => {
  const result = await inspect_vexcel_site({ latitude: 29, longitude: -95 });
  assert.equal(result.status, "ok");
  if (!("analysis" in result)) return assert.fail("Expected aerial analysis");
  assert.equal(result.collection, "new");
  assert.equal(result.captured_at, "2025-01-01");
  assert.equal(result.scope, "coordinate_vicinity_not_verified_parcel");
  assert.equal(result.source_references[0].source_type, "vexcel");
  assert.equal(result.analysis.report.observations[0].feature, "parking_stalls");
  const extract = calls.find((call) => call.vendor.endsWith("ortho/extract"))!.body!;
  assert.equal(extract.collection, "new");
  assert.ok(String(extract.wkt).startsWith("POLYGON((-95"));
  assert.equal(extract.srid, 4326);
}, "aerial"));

test("no coverage is explicit, not zero parking, and does not call vision", async () => fixture(async (calls) => {
  const result = await inspect_vexcel_site({ latitude: 29, longitude: -95 });
  assert.equal(result.status, "no_coverage");
  assert.ok(!("analysis" in result));
  assert.equal(calls.some((call) => call.vendor === "claude"), false);
}, "no_coverage"));

test("source errors remain operational failures and do not become dummy evidence", async () => fixture(async () => {
  await assert.rejects(get_matterport_rooms({ model_id: "fixture123" }), (e) => e instanceof SpatialError && !e.message.includes("private provider data"));
}, "mp_error"));

test("agent preserves a spatial failure as an unavailable tool result", async () => {
  let round = 0;
  const result = await runAgentLoop("Rooms?", { provider: "anthropic", model: "fixture", next: async (results) => {
    if (++round === 1) return { text: "", calls: [{ name: "get_matterport_rooms", args: {} }] };
    assert.equal((results[0].response.error as { code: string }).code, "SOURCE_UNAVAILABLE");
    return { calls: [], text: "The scan source is unavailable; room count is unknown." };
  } }, { execute: async () => { throw new SpatialError("matterport", "UNAVAILABLE", "Scan unavailable"); } });
  assert.equal(result.tool_calls[0].status, "unavailable");
  assert.deepEqual(result.sources, []);
});

test("invalid spatial inputs and fabricated visual references are rejected", async () => {
  await assert.rejects(get_matterport_rooms({ model_id: "../../private" }), ToolValidationError);
  await assert.rejects(inspect_matterport_features({ model_id: "fixture123", max_panoramas: 20 }), ToolValidationError);
  for (const latitude of [NaN, Infinity, 91, "29"]) await assert.rejects(inspect_vexcel_site({ latitude: latitude as number, longitude: -95 }), ToolValidationError);
  await assert.rejects(inspect_vexcel_site({ latitude: 29, longitude: -95, half_width_m: 10000 }), ToolValidationError);
  const invalid = report(); invalid.observations[0].image_ids = ["invented"];
  assert.throws(() => validateVisualReport(invalid, [imageId]), AgentError);
  assert.throws(() => validateVisualReport({ ...report(), source_references: [{ dataset: "fake" }] }, [imageId]), AgentError);
  const negative = report(); negative.observations[0].status = "not_observed";
  assert.throws(() => validateVisualReport(negative, [imageId]), AgentError);
  assert.ok(vicinityWKT(29, -95, 80).includes("POLYGON"));
});

test("invalid primary arguments do not bypass source order", async () => {
  const execute = orderedExecutor(routeQuestion("Sinks and past tenants"), async () => { throw new ToolValidationError("Invalid model"); });
  await assert.rejects(execute("get_matterport_rooms", {}), ToolValidationError);
  await assert.rejects(execute("get_tenant_history", {}), /Start domain evidence with matterport/);
});
