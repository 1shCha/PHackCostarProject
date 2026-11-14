// One place for every image question we ask Gemini.
// Calls the Gemini REST API directly so each request has a timeout (the SDK can retry silently for minutes).
// Retries when Google is busy, falls back to another model, and caches every answer under cache/vision.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE = path.join(process.cwd(), "cache", "vision");
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-3.8-flash"].filter(Boolean) as string[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  for (const model of [...new Set(MODELS)]) {
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
          const answer = JSON.parse(text) as T;
          mkdirSync(CACHE, { recursive: true });
          writeFileSync(file, JSON.stringify({ model, images: imagePaths.map((p) => path.basename(p)), answer }, null, 1));
          return answer;
        }
        lastError = `${model} ${res.status}: ${body.error?.message ?? "unknown error"}`;
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
  throw new Error(`Gemini failed: ${lastError}`);
}
