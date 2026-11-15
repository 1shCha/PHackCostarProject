import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock, Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { AgentError, providerError, runAgentLoop, type ModelSession, type TenantAnswer } from "./agent-core";
import { createClaudeSession, claudeTools } from "./claude-adapter";
import { costarFunctionDeclarations } from "./gemini-tools";
import { runWithFallback } from "./tenant-agent";
import { ToolValidationError } from "../tools/costar";
import { POST } from "../../app/api/chat/route";

const ref = { dataset: "location-occupancy", source_line: "12", source_file: "occupancy.jsonl", record_id: "3", field_path: "/spaces/0" };
function message(content: ContentBlock[], stop_reason: Message["stop_reason"] = "end_turn"): Message {
  // Unused usage/billing metadata is omitted from this provider fixture.
  return { id: "msg_test", type: "message", role: "assistant", model: "test-claude", content, stop_reason, stop_sequence: null } as Message;
}
const text = (value: string): ContentBlock => ({ type: "text", text: value, citations: null });
const tool = (id: string, name: string): ContentBlock => ({ type: "tool_use", id, name, input: {}, caller: { type: "direct" } });
const answer = (provider: "gemini" | "anthropic"): TenantAnswer => ({ answer: "Which address?", sources: [], tool_calls: [], model: "test-model", provider, fallback: null });
const hasCode = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;

test("Claude uses the same schemas and preserves thinking, batch IDs and error results", async () => {
  assert.deepEqual(claudeTools.map((entry) => entry.input_schema), costarFunctionDeclarations.map((entry) => entry.parametersJsonSchema));
  const requests: MessageCreateParamsNonStreaming[] = [];
  const thinking: ContentBlock = { type: "thinking", thinking: "private thought", signature: "opaque" };
  const first = message([thinking, tool("good", "get_tenant_history"), tool("bad", "find_suites")], "tool_use");
  const session = createClaudeSession("Who occupied it?", async (parameters) => {
    requests.push(structuredClone(parameters));
    return requests.length === 1 ? first : message([text("Recorded tenant: Fixture Practice [S1].")]);
  }, "configured-claude");
  const result = await runAgentLoop("Who occupied it?", session, {
    execute: async (name) => {
      if (name === "find_suites") throw new ToolValidationError("property_id is required");
      return { source_references: [ref] };
    },
  });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "configured-claude");
  assert.equal(result.sources[0].citation_id, "S1");
  assert.ok(!result.answer.includes("private thought"));
  assert.deepEqual(requests[1].messages[1], { role: "assistant", content: first.content });
  const results = requests[1].messages[2].content;
  assert.ok(Array.isArray(results));
  if (!Array.isArray(results)) return;
  assert.deepEqual(results.map((block) => block.type === "tool_result" && [block.tool_use_id, block.is_error]), [["good", false], ["bad", true]]);
  assert.match(JSON.stringify(results), /INVALID_ARGUMENTS/);
});

test("Claude rejects truncated, refused, inconsistent and uncited responses", async () => {
  for (const response of [message([text("partial")], "max_tokens"), message([text("refused")], "refusal"), message([text("no calls")], "tool_use"), message([tool("x", "find_suites")], "end_turn")]) {
    await assert.rejects(runAgentLoop("Who?", createClaudeSession("Who?", async () => response)), hasCode("INVALID_RESPONSE"));
  }
  for (const final of ["Tenant without citation", "Tenant [S99]"]) {
    let round = 0;
    await assert.rejects(runAgentLoop("Who?", createClaudeSession("Who?", async () => ++round === 1 ? message([tool("x", "get_tenant_history")], "tool_use") : message([text(final)])),
      { execute: async () => ({ source_references: [ref] }) }), hasCode("INVALID_RESPONSE"));
  }
});

test("Gemini success does not invoke Claude", async () => {
  const result = await runWithFallback("Who?", { primary: async () => answer("gemini"), secondary: async () => { assert.fail("Unexpected fallback"); } });
  assert.equal(result.provider, "gemini");
  assert.equal(result.fallback, null);
});

test("only transient provider failures qualify for fallback", async () => {
  for (const failure of [Object.assign(new Error(), { status: 429 }), Object.assign(new Error(), { status: 503 }), Object.assign(new Error(), { status: 408 }), new TypeError("network failure"), Object.assign(new Error(), { name: "APIConnectionTimeoutError" })]) {
    const mapped = providerError(failure, "gemini");
    assert.equal(mapped.retryable, true);
    const result = await runWithFallback("Original question", {
      primary: async () => { throw mapped; },
      secondary: async (question, signal) => { assert.equal(question, "Original question"); assert.equal(signal.aborted, false); return answer("anthropic"); },
    });
    assert.equal(result.provider, "anthropic");
    assert.deepEqual(result.fallback, { from: "gemini", reason: mapped.code });
  }
  for (const status of [400, 401, 403, 404]) {
    const error = providerError({ status }, "gemini");
    assert.equal(error.retryable, false);
    await assert.rejects(runWithFallback("Who?", { primary: async () => { throw error; }, secondary: async () => assert.fail("Unexpected fallback") }), hasCode("MODEL_UNAVAILABLE"));
  }
});

test("data, configuration, validation, citation and loop errors never switch providers", async () => {
  for (const code of ["DATABASE_UNAVAILABLE", "NOT_CONFIGURED", "INVALID_INPUT", "INVALID_RESPONSE", "LIMIT_REACHED"] as const) {
    await assert.rejects(runWithFallback("Who?", { primary: async () => { throw new AgentError(code, "test"); }, secondary: async () => assert.fail("Unexpected fallback") }), hasCode(code));
  }
  await assert.rejects(runWithFallback("Who?", { primary: async () => { throw new AgentError("RATE_LIMITED", "quota", true); } }), hasCode("RATE_LIMITED"));
});

test("fallback discards partial Gemini results and starts citation numbering fresh", async () => {
  let primaryTurn = 0;
  const primary: ModelSession = { provider: "gemini", model: "primary", next: async () => {
    if (++primaryTurn === 1) return { text: "", calls: [{ name: "get_tenant_history", args: {} }] };
    throw Object.assign(new Error("private outage details"), { status: 503 });
  } };
  let claudeTurn = 0;
  const result = await runWithFallback("Original question", {
    primary: (question, signal) => runAgentLoop(question, primary, { signal, execute: async () => ({ source_references: [{ ...ref, source_line: "111" }] }) }),
    secondary: (question, signal) => runAgentLoop(question, createClaudeSession(question, async (parameters) => {
      if (++claudeTurn === 1) {
        assert.deepEqual(parameters.messages, [{ role: "user", content: "Original question" }]);
        return message([tool("fresh", "get_tenant_history")], "tool_use");
      }
      assert.ok(!JSON.stringify(parameters.messages).includes('"source_line":"111"'));
      return message([text("Fresh tenant evidence [S1].")]);
    }), { signal, execute: async () => ({ source_references: [{ ...ref, source_line: "222" }] }) }),
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].source_line, "222");
  assert.equal(result.sources[0].citation_id, "S1");
  assert.equal(result.tool_calls.length, 1);
});

test("cancellation prevents fallback and a failed fallback stops after one attempt", async () => {
  const controller = new AbortController();
  await assert.rejects(runWithFallback("Who?", { signal: controller.signal,
    primary: async () => { controller.abort(); throw new AgentError("RATE_LIMITED", "quota", true); },
    secondary: async () => assert.fail("Fallback after cancellation"),
  }), hasCode("TIMEOUT"));
  let calls = 0;
  await assert.rejects(runWithFallback("Who?", {
    primary: async () => { throw new AgentError("RATE_LIMITED", "quota", true); },
    secondary: async () => { calls++; throw new AgentError("MODEL_UNAVAILABLE", "Claude unavailable", true); },
  }), (error: unknown) => {
    assert.ok(error instanceof AgentError);
    assert.deepEqual(error.attempts, [{ provider: "gemini", code: "RATE_LIMITED" }, { provider: "anthropic", code: "MODEL_UNAVAILABLE" }]);
    return true;
  });
  assert.equal(calls, 1);
});

test("HTTP endpoint performs one Gemini-to-Claude fallback through both SDKs", async () => {
  const originalFetch = globalThis.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalClaude = process.env.ANTHROPIC_API_KEY;
  const originalWorkspace = process.env.ANTHROPIC_WORKSPACE_ID;
  process.env.GEMINI_API_KEY = "synthetic-gemini-key";
  process.env.ANTHROPIC_API_KEY = "synthetic-claude-key";
  process.env.ANTHROPIC_WORKSPACE_ID = "synthetic-workspace";
  try {
    const calls: string[] = [];
    globalThis.fetch = async (input, options) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("generativelanguage.googleapis.com")) {
        calls.push("gemini");
        return Response.json({ error: { code: 429, message: "private provider details" } }, { status: 429 });
      }
      assert.ok(url.startsWith("https://api.anthropic.com/"));
      calls.push("anthropic");
      assert.equal(new Headers(options?.headers).get("anthropic-workspace-id"), "synthetic-workspace");
      const body = JSON.parse(String(options?.body));
      assert.deepEqual(body.messages, [{ role: "user", content: "Who occupied it?" }]);
      assert.equal(body.tools.length, 7);
      return Response.json(message([text("Which building address and suite did you mean?")]));
    };
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ question: "Who occupied it?" }) }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.provider, "anthropic");
    assert.deepEqual(result.fallback, { from: "gemini", reason: "RATE_LIMITED" });
    assert.deepEqual(calls, ["gemini", "anthropic"]);
    assert.ok(!JSON.stringify(result).includes("synthetic-"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGemini;
    if (originalClaude === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalClaude;
    if (originalWorkspace === undefined) delete process.env.ANTHROPIC_WORKSPACE_ID;
    else process.env.ANTHROPIC_WORKSPACE_ID = originalWorkspace;
  }
});
