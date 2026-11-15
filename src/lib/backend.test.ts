import assert from "node:assert/strict";
import { test } from "node:test";
import { callBackendTool, usesRemoteBackend } from "./backend";
import { find_properties } from "./tools/costar";
import { ToolValidationError } from "./tool-errors";

test("backend client uses the server-only key and never silently falls back", async () => {
  const saved = { url: process.env.BACKEND_API_URL, key: process.env.BACKEND_API_KEY, path: process.env.DUCKDB_PATH };
  const originalFetch = globalThis.fetch;
  try {
    process.env.BACKEND_API_URL = "https://backend.example/";
    process.env.BACKEND_API_KEY = "synthetic-server-only-test-key";
    process.env.DUCKDB_PATH = "/nonexistent/database.duckdb";
    assert.equal(usesRemoteBackend(), true);
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), "https://backend.example/tools/find_properties");
      assert.equal(new Headers(options?.headers).get("X-API-Key"), process.env.BACKEND_API_KEY);
      assert.equal(options?.redirect, "error");
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.method, "POST");
      return Response.json({ items: [], total: 0, limit: 20, offset: 0 });
    };
    assert.equal((await find_properties({ query: "Houston" })).total, 0);
    globalThis.fetch = async () => Response.json({ error: "private server details" }, { status: 401 });
    await assert.rejects(find_properties({ query: "Houston" }), /authentication failed/);
    globalThis.fetch = async () => Response.json({}, { status: 400 });
    await assert.rejects(find_properties({ query: "Houston" }), ToolValidationError);
    globalThis.fetch = async () => new Response("<html>error</html>");
    await assert.rejects(callBackendTool("find_properties", {}), /invalid JSON/);
    process.env.BACKEND_API_URL = "http://untrusted.example";
    await assert.rejects(callBackendTool("find_properties", {}), /HTTPS/);
    process.env.BACKEND_API_URL = "https://backend.example/";
    delete process.env.BACKEND_API_KEY;
    assert.equal(usesRemoteBackend(), true);
    await assert.rejects(find_properties({ query: "Houston" }), /Set both/);
    delete process.env.BACKEND_API_URL;
    assert.equal(usesRemoteBackend(), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [["BACKEND_API_URL", saved.url], ["BACKEND_API_KEY", saved.key], ["DUCKDB_PATH", saved.path]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
