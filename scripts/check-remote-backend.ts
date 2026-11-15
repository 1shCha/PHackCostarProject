import assert from "node:assert/strict";
import { find_properties, find_suites, get_tenant_history } from "../src/lib/tools/costar";
import { get_spatial_context } from "../src/lib/tools/spatial-context";
import { getDuckDBHealth } from "../src/lib/duckdb";
import { runTenantAgent } from "../src/lib/ai/tenant-agent";
import { FinishReason, GenerateContentResponse, type Content, type GenerateContentParameters } from "@google/genai";

async function main() {
  assert.ok(process.env.BACKEND_API_URL && process.env.BACKEND_API_KEY, "Configure the backend URL and key");
  // This must succeed without access to a local database file.
  process.env.DUCKDB_PATH = "/nonexistent/remote-integration-check.duckdb";
  const health = await getDuckDBHealth();
  assert.equal(health.access_mode, "read_only");
  const properties = await find_properties({ query: "6655 Travis St", city: "Houston", state: "TX" });
  const property = properties.items.find(item => item.property_id === "238587");
  assert.ok(property);
  assert.ok(property.source_references.length);
  const suites = await find_suites({ property_id: property.property_id, suite: "900" });
  assert.equal(suites.items.length, 1);
  const suite = suites.items[0];
  const history = await get_tenant_history({ suite_id: suite.suite_id });
  assert.equal(history.status, "ok");
  if (history.status !== "ok") throw new Error("Known suite history missing");
  assert.ok(history.supported_history.length);
  assert.ok(history.supported_history.every(row => row.suite_id === suite.suite_id && row.source_references.length));
  const context = await get_spatial_context({ property_id: property.property_id, suite_id: suite.suite_id });
  assert.equal(context.status, "ok");
  const generate = async (parameters: GenerateContentParameters) => {
    const contents = parameters.contents as Content[];
    const last = contents.at(-1)?.parts?.[0].functionResponse;
    let content: Content;
    if (!last) content = { role: "model", parts: [{ functionCall: { id: "property", name: "find_properties", args: { query: "6655 Travis St", city: "Houston", state: "TX" } } }] };
    else if (last.name === "find_properties") content = { role: "model", parts: [{ functionCall: { id: "suite", name: "find_suites", args: { property_id: "238587", suite: "900" } } }] };
    else if (last.name === "find_suites") content = { role: "model", parts: [{ functionCall: { id: "history", name: "get_tenant_history", args: { suite_id: suite.suite_id } } }] };
    else {
      const output = last.response?.output as { supported_history: { company_name: string; source_references: { citation_id: string }[] }[] };
      const recorded = output.supported_history[0];
      content = { role: "model", parts: [{ text: `Recorded tenant: ${recorded.company_name} [${recorded.source_references[0].citation_id}]. Candidate records remain uncertain.` }] };
    }
    return Object.assign(new GenerateContentResponse(), { candidates: [{ content, finishReason: FinishReason.STOP }] });
  };
  const answer = await runTenantAgent("Who previously occupied Suite 900 at 6655 Travis St, Houston TX?", { generate, model: "scripted-remote-integration-check" });
  for (const name of ["find_properties", "find_suites", "get_tenant_history"]) assert.ok(answer.tool_calls.some(call => call.name === name && call.status === "ok"));
  assert.ok(answer.sources.length);
  assert.ok(history.supported_history.some(row => row.company_name && answer.answer.includes(row.company_name)));
  console.log("Remote integration passed: health → property → suite → history → cited agent answer; spatial context passed. Local database path was deliberately invalid. No model API calls were made.");
}
main().catch(() => { console.error("Remote backend integration failed; check service deployment, URL/key, and server logs."); process.exitCode = 1; });
