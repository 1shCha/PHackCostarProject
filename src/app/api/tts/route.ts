// POST /api/tts { text } → audio/wav spoken by a Gemini voice (natural-sounding, unlike the browser default).
// The key stays on the server. If this fails, the browser falls back to its best local voice (src/lib/voice/speaker.ts).
// Optional env: GEMINI_TTS_MODEL (default gemini-3.8-flash-lite-tts, the fastest), GEMINI_TTS_VOICE (default Kore, a calm voice).

export const runtime = "nodejs";

const MAX_CHARS = 700;
const recent = new Map<string, Buffer>(); // repeated lines ("Okay. Say Hey SecondLife…") play instantly

/** Some TTS models return raw 16-bit PCM; wrap it in a WAV header so browsers can play it. */
function pcmToWav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return Response.json({ error: "TTS not configured" }, { status: 503 });
  let text = "";
  try {
    text = String((await request.json())?.text ?? "").trim();
  } catch {
    return Response.json({ error: "Send JSON { text }" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Empty text" }, { status: 400 });
  text = text.slice(0, MAX_CHARS);

  const model = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-lite-tts";
  const voice = process.env.GEMINI_TTS_VOICE?.trim() || "Kore";
  const cacheKey = `${model}|${voice}|${text}`;
  const headers = { "Content-Type": "audio/wav", "Cache-Control": "no-store" };
  const hit = recent.get(cacheKey);
  if (hit) return new Response(new Uint8Array(hit), { headers });

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        // Text only: this model reads any style instruction out loud.
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("TTS failed:", res.status); // don't log bodies: they can echo request details
      return Response.json({ error: "TTS unavailable" }, { status: 502 });
    }
    const body = await res.json();
    const part = body.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData;
    if (!part?.data) return Response.json({ error: "No audio returned" }, { status: 502 });
    const bytes = Buffer.from(part.data, "base64");
    const mime = String(part.mimeType ?? "").toLowerCase();
    const wav = mime.includes("wav") ? bytes : pcmToWav(bytes, Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000));
    recent.set(cacheKey, wav);
    if (recent.size > 40) recent.delete(recent.keys().next().value as string);
    return new Response(new Uint8Array(wav), { headers });
  } catch {
    return Response.json({ error: "TTS timed out" }, { status: 504 });
  }
}
