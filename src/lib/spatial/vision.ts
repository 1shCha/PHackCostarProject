// One place for every image question we ask Gemini.
// Calls the Gemini REST API directly so each request has a timeout (the SDK can retry silently for minutes).
// Retries when Google is busy, falls back to another Gemini model, then to Claude (if ANTHROPIC_API_KEY is set),
// and caches every answer under cache/vision. Set VISION_PROVIDER=claude to skip Gemini entirely.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE = path.join(process.cwd(), "cache", "vision");
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-3.8-flash"].filter(Boolean) as string[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const outOfQuota = new Set<string>(); // models that hit their daily limit during this run: skip them right away

/**
 * The most recent saved answer for exactly these images, from any earlier prompt.
 * Used as a fallback when Gemini is unavailable (quota or outage), so a re-run never loses labels.
 */
export function earlierAnswer<T>(imagePaths: string[]): T | null {
  if (!existsSync(CACHE)) return null;
  const want = imagePaths.map((p) => path.basename(p)).join("|");
  let best: { t: number; answer: T } | null = null;
  for (const f of readdirSync(CACHE)) {
    const full = path.join(CACHE, f);
    try {
      const d = JSON.parse(readFileSync(full, "utf8"));
      if ((d.images ?? []).join("|") !== want) continue;
      const t = statSync(full).mtimeMs;
      if (!best || t > best.t) best = { t, answer: d.answer as T };
    } catch {
      /* ignore unreadable cache files */
    }
  }
  return best?.answer ?? null;
}

/** Sends images + a prompt, returns the model's JSON answer. Same images + prompt → cached answer. */
export async function askVisionJSON<T>(imagePaths: string[], prompt: string): Promise<T> {
  const key = createHash("sha256").update(prompt).update(imagePaths.join("|")).digest("hex").slice(0, 24);
  const file = path.join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).answer as T;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Set GEMINI_API_KEY in .env.local");
  const parts = [
    ...imagePaths.map((p) => ({ inlineData: { mimeType: "image/jpeg", data: readFileSync(p).toString("base64") } })),
    { text: prompt },
  ];

  let lastError = "";
  const save = (model: string, answer: T) => {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify({ model, images: imagePaths.map((p) => path.basename(p)), answer }, null, 1));
    return answer;
  };
  const geminiModels = process.env.VISION_PROVIDER === "claude" ? [] : [...new Set(MODELS)];
  for (const model of geminiModels.filter((m) => !outOfQuota.has(m))) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } }),
          signal: AbortSignal.timeout(90_000),
        });
        const body = await res.json();
        if (res.ok) {
          const text: string = body.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
          return save(model, JSON.parse(text) as T);
        }
        lastError = `${model} ${res.status}: ${body.error?.message ?? "unknown error"}`;
        if (res.status === 429 && /per day|PerDay/i.test(lastError)) {
          outOfQuota.add(model); // daily limit: retrying won't help until tomorrow
          break;
        }
        if (res.status === 429 || res.status >= 500) {
          await sleep(4_000 * 2 ** attempt); // busy or rate-limited: wait and retry
          continue;
        }
        break; // other errors (bad key, unknown model): try the next model
      } catch (e) {
        lastError = `${model}: ${(e as Error).message}`; // timeout, network or unparseable JSON
        await sleep(2_000);
      }
    }
  }
  // Gemini is out (quota, outage) or skipped: ask Claude instead, if a key is set.
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      const { model, answer } = await askClaude<T>(imagePaths, prompt);
      return save(model, answer);
    } catch (e) {
      lastError += `${lastError ? "; " : ""}${(e as Error).message}`;
    }
  }
  throw new Error(`Vision failed: ${lastError || "every Gemini model is out of daily quota and no ANTHROPIC_API_KEY is set"}`);
}

/** Same question, asked to Claude. Used when Gemini can't answer. */
async function askClaude<T>(imagePaths: string[], prompt: string): Promise<{ model: string; answer: T }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const model = process.env.ANTHROPIC_VISION_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 120_000,
    maxRetries: 3, // the SDK waits and retries on 429 / 5xx
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        ...imagePaths.map((p) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: "image/jpeg" as const, data: readFileSync(p).toString("base64") },
        })),
        { type: "text" as const, text: `${prompt}\n\nReply with only the JSON object, no other text.` },
      ],
    }],
  });
  if (response.stop_reason === "max_tokens") throw new Error(`${model}: answer was cut off`);
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1); // tolerate a ```json fence
  try {
    return { model, answer: JSON.parse(json) as T };
  } catch {
    throw new Error(`${model}: answer was not JSON`);
  }
}
