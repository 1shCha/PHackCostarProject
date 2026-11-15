import { AgentError, answerTenantQuestion } from "@/lib/ai/tenant-agent";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  let input: unknown;
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: { code: "INVALID_INPUT", message: "Provide a JSON question." } }, { status: 400, headers });
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) {
        await reader.cancel();
        return Response.json({ error: { code: "INVALID_INPUT", message: "Request body is too large." } }, { status: 413, headers });
      }
      chunks.push(value);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return Response.json({ error: { code: "INVALID_INPUT", message: "Provide valid JSON." } }, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "question")) {
    return Response.json({ error: { code: "INVALID_INPUT", message: 'Expected only a "question" field.' } }, { status: 400, headers });
  }
  try {
    const result = await answerTenantQuestion((input as { question: string }).question, request.signal);
    return Response.json(result, { headers });
  } catch (error) {
    const agentError = error instanceof AgentError ? error :
      new AgentError("MODEL_UNAVAILABLE", "The agent is unavailable.");
    const status = agentError.code === "INVALID_INPUT" ? 400 :
      agentError.code === "TIMEOUT" ? 504 :
      agentError.code === "RATE_LIMITED" ? 429 :
      ["NOT_CONFIGURED", "DATABASE_UNAVAILABLE"].includes(agentError.code) ? 503 : 502;
    // Do not log provider error objects: they may contain credential-bearing URLs.
    console.error("Tenant agent failed:", agentError.code);
    return Response.json({ error: { code: agentError.code, message: agentError.message, ...(agentError.attempts ? { attempts: agentError.attempts } : {}) } }, { status, headers });
  }
}
