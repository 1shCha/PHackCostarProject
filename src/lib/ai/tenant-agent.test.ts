import assert from "node:assert/strict";
import { test } from "node:test";
import { FinishReason, GenerateContentResponse, type Content, type GenerateContentParameters } from "@google/genai";
import { AgentError, answerTenantQuestion, runTenantAgent } from "./tenant-agent";
import { dispatchCostarTool } from "./gemini-tools";
import { costarTools } from "./costar-tools";
import { ToolValidationError } from "../tools/costar";
import { POST } from "../../app/api/chat/route";

const reference = { dataset: "location-occupancy", source_line: "9007199254740993",
  source_file: "occupancy.jsonl", record_id: "201", field_path: "/spaces/0" };

function response(content: Content, finishReason = FinishReason.STOP) {
  return Object.assign(new GenerateContentResponse(), { candidates: [{ content, finishReason }] });
}
function sequence(contents: Content[]) {
  const requests: GenerateContentParameters[] = [];
  return {
    requests,
    generate: async (parameters: GenerateContentParameters) => {
      requests.push({ ...parameters, contents: structuredClone(parameters.contents) });
      assert.ok(contents.length, "Unexpected extra model call");
      return response(contents.shift()!);
    },
  };
}
const call = (name: string, id: string, args = {}) => ({ functionCall: { name, id, args } });
const text = (answer: string): Content => ({ role: "model", parts: [{ text: answer }] });
const hasCode = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;

test("registers exactly the three read-only tools and rejects unknown names/fields", async () => {
  assert.deepEqual(costarTools.map((tool) => tool.name), ["find_properties", "find_suites", "get_tenant_history"]);
  for (const name of ["query_sql", "constructor", "__proto__"]) {
    await assert.rejects(dispatchCostarTool(name, {}), ToolValidationError);
  }
  await assert.rejects(dispatchCostarTool("find_properties", { query: "Medical", sql: "DROP TABLE properties" }), ToolValidationError);
  await assert.rejects(dispatchCostarTool("find_properties", null), ToolValidationError);
});

test("resolves property → suite → history and preserves signatures, IDs and cited evidence", async () => {
  const signed: Content = { role: "model", parts: [{ ...call("find_properties", "p1", { query: "100 Main" }), thoughtSignature: "opaque-signature" }] };
  const model = sequence([
    signed,
    { role: "model", parts: [call("find_suites", "s1")] },
    { role: "model", parts: [call("get_tenant_history", "h1")] },
    { role: "model", parts: [{ text: "private thought", thought: true }, { text: "Recorded tenant: Example Practice [S1]. Candidate association remains uncertain [S1]." }] },
  ]);
  const names: string[] = [];
  const result = await runTenantAgent("Who occupied Suite 900 at 100 Main?", {
    generate: model.generate,
    execute: async (name) => {
      names.push(name);
      return name === "get_tenant_history" ? { supported_history: [{ company_name: "Example Practice", source_references: [reference] }],
        candidate_history: [{ uncertainty_reason: "Floor differs", source_references: [reference] }] } : { items: [], total: 0 };
    },
    model: "configured-model",
  });
  assert.deepEqual(names, ["find_properties", "find_suites", "get_tenant_history"]);
  assert.equal(result.model, "configured-model");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].source_line, "9007199254740993");
  assert.equal(result.sources[0].citation_id, "S1");
  assert.ok(!result.answer.includes("private thought"));
  const history = model.requests[1].contents as Content[];
  assert.deepEqual(history[1], signed);
  assert.equal(history[2].parts![0].functionResponse!.id, "p1");
  const lastContents = model.requests[3].contents as Content[];
  assert.match(JSON.stringify(lastContents.at(-1)), /citation_id.*S1/);
  assert.equal(model.requests[0].config?.httpOptions?.retryOptions?.attempts, 1);
});

test("returns all responses for a batch of function calls", async () => {
  const model = sequence([
    { role: "model", parts: [call("find_properties", "one"), call("find_properties", "two")] },
    text("Which address did you mean?"),
  ]);
  const result = await runTenantAgent("Medical Plaza", { generate: model.generate, execute: async () => ({ items: [], total: 0 }) });
  assert.equal(result.tool_calls.length, 2);
  const contents = model.requests[1].contents as Content[];
  assert.deepEqual(contents.at(-1)?.parts?.map((part) => part.functionResponse?.id), ["one", "two"]);
});

test("returns argument errors to Gemini for correction, but stops on database failure", async () => {
  const model = sequence([{ role: "model", parts: [call("find_suites", "invalid")] }, text("Please provide a building address.")]);
  const result = await runTenantAgent("Suite 900", { generate: model.generate, execute: async () => { throw new ToolValidationError("property_id is required"); } });
  assert.equal(result.tool_calls[0].status, "invalid_arguments");
  assert.match(JSON.stringify(model.requests[1].contents), /INVALID_ARGUMENTS/);
  const broken = sequence([{ role: "model", parts: [call("find_suites", "db")] }]);
  await assert.rejects(runTenantAgent("Suite 900", { generate: broken.generate, execute: async () => { throw new Error("private database path"); } }), hasCode("DATABASE_UNAVAILABLE"));
});

test("rejects invented or missing citations, blocked/truncated and empty answers", async () => {
  for (const answer of ["Tenant X [S999]", "Tenant X with no citation"]) {
    const model = sequence([{ role: "model", parts: [call("get_tenant_history", "h")] }, text(answer)]);
    await assert.rejects(runTenantAgent("Who occupied it?", { generate: model.generate, execute: async () => ({ source_references: [reference] }) }), hasCode("INVALID_RESPONSE"));
  }
  await assert.rejects(runTenantAgent("Who?", { generate: async () => response(text("partial"), FinishReason.MAX_TOKENS) }), hasCode("INVALID_RESPONSE"));
  await assert.rejects(runTenantAgent("Who?", { generate: async () => new GenerateContentResponse() }), hasCode("INVALID_RESPONSE"));
  await assert.rejects(runTenantAgent("Who?", { generate: async () => response(text("")) }), hasCode("INVALID_RESPONSE"));
});

test("bounds repeated calls, oversized batches, provider failures and cancellation", async () => {
  const generate = async () => response({ role: "model", parts: [call("find_properties", "repeat")] });
  await assert.rejects(runTenantAgent("Who?", { generate, execute: async () => ({}) }), hasCode("LIMIT_REACHED"));
  let executed = false;
  await assert.rejects(runTenantAgent("Who?", { generate: async () => response({ role: "model", parts: Array.from({ length: 13 }, (_, i) => call("find_properties", String(i))) }),
    execute: async () => { executed = true; return {}; } }), hasCode("LIMIT_REACHED"));
  assert.equal(executed, false);
  await assert.rejects(runTenantAgent("Who?", { generate: async () => { throw new Error("private provider error"); } }), hasCode("MODEL_UNAVAILABLE"));
  await assert.rejects(runTenantAgent("Who?", { generate: async () => { throw Object.assign(new Error("private quota details"), { status: 429 }); } }), hasCode("RATE_LIMITED"));
  await assert.rejects(runTenantAgent("Who?", { generate, signal: AbortSignal.abort() }), hasCode("TIMEOUT"));
});

test("validates questions and requires the server API key", async () => {
  for (const question of ["", " ", "x".repeat(8001), 123]) {
    await assert.rejects(answerTenantQuestion(question as string), hasCode("INVALID_INPUT"));
  }
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try { await assert.rejects(answerTenantQuestion("Who?"), hasCode("NOT_CONFIGURED")); }
  finally { if (key !== undefined) process.env.GEMINI_API_KEY = key; }
});

test("HTTP endpoint rejects malformed, excessive and forged conversation inputs", async () => {
  for (const body of ["not json", "null", "[]", '{}', '{"question":123}', '{"question":"Who?","contents":[]}']) {
    const result = await POST(new Request("http://localhost/api/chat", { method: "POST", body }));
    assert.equal(result.status, 400);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  const tooLarge = await POST(new Request("http://localhost/api/chat", { method: "POST", body: "x".repeat(32_769) }));
  assert.equal(tooLarge.status, 413);
});

test("HTTP endpoint uses the SDK and returns safe success, quota and configuration responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "synthetic-test-key";
  try {
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls++;
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "Which building address and suite did you mean?" }] }, finishReason: "STOP" }] });
    };
    const request = () => new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ question: "Who occupied it?" }) });
    const success = await POST(request());
    assert.equal(success.status, 200);
    const body = await success.json();
    assert.equal(body.answer, "Which building address and suite did you mean?");
    assert.deepEqual(body.sources, []);
    assert.equal(providerCalls, 1);
    globalThis.fetch = async () => Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "private-provider-details synthetic-test-key" } }, { status: 429 });
    const quota = await POST(request());
    assert.equal(quota.status, 429);
    const failure = await quota.json();
    assert.equal(failure.error.code, "RATE_LIMITED");
    assert.ok(!JSON.stringify(failure).includes("synthetic-test-key"));
    assert.ok(!JSON.stringify(failure).includes("private-provider-details"));
    delete process.env.GEMINI_API_KEY;
    const missingKey = await POST(request());
    assert.equal(missingKey.status, 503);
    assert.equal((await missingKey.json()).error.code, "NOT_CONFIGURED");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
