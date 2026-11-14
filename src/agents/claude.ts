// ROLE 3 · Claude helper. Reads ANTHROPIC_API_KEY from .env (never commit .env).
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

/** True when an API key is set, so the app can fall back to sample text without one. */
export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Ask Claude for plain text. Returns null on any failure (no key, network, refusal),
 * so a Claude problem never breaks the demo: callers fall back to sample data.
 */
export async function askClaude(system: string, prompt: string): Promise<string | null> {
  if (!hasClaude()) return null;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" }, // short writing task: fast and cheap
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: [{ model: "claude-opus-5" }], // if Opus 5.5 declines, retry on Opus 5
      system,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return text || null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error("Claude: invalid ANTHROPIC_API_KEY");
    else if (error instanceof Anthropic.RateLimitError) console.error("Claude: rate limited");
    else if (error instanceof Anthropic.APIError) console.error(`Claude: API error ${error.status}`, error.message);
    else console.error("Claude: request failed", error);
    return null;
  }
}
