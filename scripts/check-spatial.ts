import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { get_matterport_rooms, inspect_matterport_features } from "../src/lib/spatial/matterport-tools";
import { inspect_vexcel_site } from "../src/lib/spatial/vexcel-tools";
import { get_spatial_context } from "../src/lib/tools/spatial-context";
import { find_suites } from "../src/lib/tools/costar";
import { answerTenantQuestion, AgentError } from "../src/lib/ai/tenant-agent";
import { SpatialError, hash } from "../src/lib/spatial/common";
import { readFile } from "node:fs/promises";

async function main() {
  const suites = await find_suites({ property_id: "238587", suite: "900" });
  const context = await get_spatial_context({ property_id: "238587", suite_id: suites.items[0].suite_id });
  assert.equal(context.status, "ok");
  assert.ok(context.models?.some((model) => model.model_id === "mXRDfAHA7iB" && model.suite_name_hint && !model.suite_extent_verified));
  const rooms = await get_matterport_rooms({ model_id: "mXRDfAHA7iB" });
  assert.ok(rooms.room_count > 0 && rooms.panorama_count > 0);
  assert.equal(rooms.captured_at, null);
  const interior = await inspect_matterport_features({ model_id: "mXRDfAHA7iB" });
  assert.ok(interior.analysis && interior.source_references && interior.coverage);
  assert.equal(interior.coverage.exhaustive, false);
  assert.equal(interior.coverage.sampled_panorama_ids.length, 1);
  const aerial = await inspect_vexcel_site({ latitude: context.latitude as number, longitude: context.longitude as number });
  assert.ok(aerial.analysis && aerial.source_references);
  assert.equal(aerial.scope, "coordinate_vicinity_not_verified_parcel");
  assert.ok(aerial.captured_at && aerial.collection);
  for (const result of [interior, aerial]) {
    const refs = result.source_references!;
    const imageIds = new Set(refs.map((ref) => ref.image_id));
    for (const observation of result.analysis!.report.observations) {
      assert.ok(observation.image_ids.every((id) => imageIds.has(id)));
    }
    for (const ref of refs) {
      assert.ok(ref.asset_path && (await stat(ref.asset_path)).isFile());
      assert.equal(hash(await readFile(ref.asset_path)), ref.image_id);
      assert.equal(ref.source_line, null);
    }
  }
  console.log(`Live source checks passed: ${rooms.room_count} usable Matterport rooms, ${interior.source_references.length} interior views, one Vexcel ortho, validated artifact hashes and observation references.`);
  console.log(`Image analysis providers: Matterport ${interior.analysis.provider}, Vexcel ${aerial.analysis.provider}. Collection date: ${aerial.captured_at}.`);
  if (!process.argv.includes("--agent")) return;
  const cases = [
    { label: "rooms", question: "How many rooms are represented in Matterport model mXRDfAHA7iB? Explain exclusions and whether its scan date and suite extent are verified.", domain: "matterport", tool: "get_matterport_rooms" },
    { label: "interior features", question: "What sinks or cabinets are visible in Matterport model mXRDfAHA7iB? Use the default bounded sample and disclose incomplete coverage and scan date uncertainty.", domain: "matterport", tool: "inspect_matterport_features" },
    { label: "parking", question: "Describe the parking and outdoor evidence in Vexcel imagery at latitude 29.709464, longitude -95.4037013. Include image date and vicinity/ownership limitations.", domain: "vexcel", tool: "inspect_vexcel_site" },
    { label: "history plus interiors", question: "Who previously occupied Suite 900 at 6655 Travis St, Houston TX, then what interior equipment is visibly recorded in its candidate Matterport scan? Use a bounded sample. Distinguish supported history, uncertain candidates and unverified suite extent.", domain: "duckdb", tool: "get_tenant_history", secondary: "inspect_matterport_features" },
  ];
  const domainTools = new Map([["get_tenant_history", "duckdb"], ["get_matterport_rooms", "matterport"], ["inspect_matterport_features", "matterport"], ["inspect_vexcel_site", "vexcel"]]);
  for (const scenario of cases) {
    const result = await answerTenantQuestion(scenario.question);
    assert.equal(result.routing?.primary_source, scenario.domain);
    assert.ok(result.tool_calls.some((call) => call.name === scenario.tool && call.status === "ok"));
    const domainCalls = result.tool_calls.filter((call) => domainTools.has(call.name) && call.status === "ok");
    assert.equal(domainTools.get(domainCalls[0].name), scenario.domain);
    if (scenario.secondary) assert.ok(domainCalls.some((call) => call.name === scenario.secondary));
    assert.ok(result.sources.length > 0);
    if (scenario.domain !== "duckdb") assert.ok(result.sources.some((source) => source.source_type === scenario.domain));
    console.log(`Live agent scenario passed: ${scenario.label}; provider ${result.provider}; domain calls ${domainCalls.map((call) => call.name).join(" → ")}; citations ${result.sources.length}.`);
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof AgentError || error instanceof SpatialError ? `${error.code}: ${error.message}` : `Spatial verification failed: ${error instanceof Error ? error.name : "unknown"}.`);
  process.exitCode = 1;
});
