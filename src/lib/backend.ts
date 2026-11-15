import "server-only";
import { ToolValidationError } from "./tool-errors";

type BackendTool = "find_properties" | "find_suites" | "get_tenant_history" | "get_spatial_context" | "database_health" | "search_candidates";

// Presence of either setting selects remote mode. A configuration error must
// never silently fall back to a laptop-only database.
export function usesRemoteBackend() {
  return Boolean(process.env.BACKEND_API_URL?.trim() || process.env.BACKEND_API_KEY?.trim());
}

export async function callBackendTool<T>(name: BackendTool, input: unknown): Promise<T> {
  const configured = process.env.BACKEND_API_URL?.trim();
  const key = process.env.BACKEND_API_KEY?.trim();
  if (!configured || !key) throw new Error("Set both BACKEND_API_URL and BACKEND_API_KEY.");
  const base = new URL(configured);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(local && base.protocol === "http:"))) {
    throw new Error("BACKEND_API_URL must be an HTTPS URL (HTTP is allowed only for localhost).");
  }
  const url = `${base.toString().replace(/\/+$/, "")}/tools/${name}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify(input),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Database backend is unreachable or timed out.");
  }
  if (response.status === 400) throw new ToolValidationError("Database tool arguments were rejected.");
  if (response.status === 401) throw new Error("Database backend authentication failed. Check BACKEND_API_KEY.");
  if (!response.ok) throw new Error(`Database backend request failed (HTTP ${response.status}).`);
  try {
    return await response.json() as T;
  } catch {
    throw new Error("Database backend returned an invalid JSON response.");
  }
}
