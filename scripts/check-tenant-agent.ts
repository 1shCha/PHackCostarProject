import assert from "node:assert/strict";
import { FinishReason, GenerateContentResponse, type Content, type GenerateContentParameters } from "@google/genai";
import { answerTenantQuestion, runTenantAgent, AgentError } from "../src/lib/ai/tenant-agent";
import { find_suites, get_tenant_history } from "../src/lib/tools/costar";

// Scripted model replies exercise the actual dispatcher and private database
// without making Gemini calls; the live mode uses the same assertions below.
async function scriptedGenerate(parameters: GenerateContentParameters) {
  const contents = parameters.contents as Content[];
  const response = contents.at(-1)?.parts?.[0].functionResponse;
  const output = response?.response?.output as Record<string, unknown> | undefined;
  let content: Content;
  if (!response) {
    content = { role: "model", parts: [{ functionCall: { id: "property", name: "find_properties", args: { query: "6655 Travis St", city: "Houston", state: "TX" } } }] };
  } else if (response.name === "find_properties") {
    const properties = output!.items as { property_id: string }[];
    assert.ok(properties.some((property) => property.property_id === "238587"));
    content = { role: "model", parts: [{ functionCall: { id: "suite", name: "find_suites", args: { property_id: "238587", suite: "900" } } }] };
  } else if (response.name === "find_suites") {
    const suites = output!.items as { suite_id: string }[];
    assert.equal(suites.length, 1);
    content = { role: "model", parts: [{ functionCall: { id: "history", name: "get_tenant_history", args: { suite_id: suites[0].suite_id } } }] };
  } else {
    const history = output!.supported_history as { company_name: string; source_references: { citation_id: string }[] }[];
    assert.ok(history.length);
    content = { role: "model", parts: [{ text: `Recorded tenant: ${history[0].company_name} [${history[0].source_references[0].citation_id}]. Candidate records remain uncertain.` }] };
  }
  return Object.assign(new GenerateContentResponse(), { candidates: [{ content, finishReason: FinishReason.STOP }] });
}

async function main() {
  const offline = process.argv.includes("--offline");
  const answerQuestion = offline ? (question: string) => runTenantAgent(question, { generate: scriptedGenerate, model: "scripted-offline-check" }) : answerTenantQuestion;
  const result = await answerQuestion(
    "Who previously occupied Suite 900 at 6655 Travis St, Houston, TX? Distinguish supported records from uncertain candidates, mention relevant date issues, and cite the evidence.",
  );
  for (const name of ["find_properties", "find_suites", "get_tenant_history"]) {
    assert.ok(result.tool_calls.some((call) => call.name === name && call.status === "ok"), `Expected ${name}`);
  }
  const suites = await find_suites({ property_id: "238587", suite: "900" });
  const history = await get_tenant_history({ suite_id: suites.items[0].suite_id });
  assert.equal(history.status, "ok");
  if (history.status !== "ok") throw new Error("Known suite missing");
  assert.ok(history.supported_history.some((entry) => entry.company_name && result.answer.toLowerCase().includes(entry.company_name.toLowerCase())), "Answer must mention an actual supported tenant");
  assert.ok(result.sources.some((source) => ["location-occupancy", "company-detail"].includes(source.dataset)), "Answer must cite tenant evidence");
  const evidence = [...history.supported_history, ...history.candidate_history].flatMap((entry) => entry.source_references);
  assert.ok(result.sources.some((source) => evidence.some((ref) => ref.dataset === source.dataset && ref.source_line === source.source_line && ref.field_path === source.field_path)), "Tenant citation must come from the selected suite");
  if (history.candidate_history.length) assert.match(result.answer, /uncertain|candidate|unconfirmed|unverified|not confirmed|not supported/i);
  console.log(`${offline ? "Offline orchestration check" : "Live agent check"} passed with ${result.model}: property → suite → history, actual tenant and source citations.`);
  console.log(`Provider: ${result.provider}; fallback: ${result.fallback?.reason ?? "none"}.`);
  console.log(`Calls: ${result.tool_calls.map((call) => call.name).join(", ")}; cited sources: ${result.sources.length}.`);
}

main().catch((error: unknown) => {
  // Avoid logging SDK/provider objects or private tenant records.
  console.error(error instanceof AgentError ? `${error.code}: ${error.message}` : "Tenant-agent verification failed.");
  process.exitCode = 1;
});
