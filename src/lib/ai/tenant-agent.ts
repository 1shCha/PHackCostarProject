import "server-only";
import { GoogleGenAI } from "@google/genai";
import { AgentError, runAgentLoop, validateQuestion, type LoopOptions, type TenantAnswer } from "./agent-core";
import { createGeminiSession, DEFAULT_GEMINI_MODEL, type GeminiGenerate } from "./gemini-adapter";
import { claudeSessionFromEnv } from "./claude-adapter";

export { AgentError, validateQuestion } from "./agent-core";
export type { AgentErrorCode, CitedSource, ToolCallSummary, TenantAnswer } from "./agent-core";

// Compatibility entrypoint for deterministic Gemini tests and offline checks.
export function runTenantAgent(question: string, options: LoopOptions & { generate: GeminiGenerate; model?: string }): Promise<TenantAnswer> {
  validateQuestion(question);
  return runAgentLoop(question, createGeminiSession(question, options.generate, options.model), options);
}

type Attempt = (question: string, signal: AbortSignal) => Promise<TenantAnswer>;
export interface FallbackOptions { primary: Attempt; secondary?: Attempt; signal?: AbortSignal; primaryTimeoutMs?: number }

export async function runWithFallback(question: string, options: FallbackOptions): Promise<TenantAnswer> {
  validateQuestion(question);
  const signal = AbortSignal.any([AbortSignal.timeout(110_000), ...(options.signal ? [options.signal] : [])]);
  if (signal.aborted) throw new AgentError("TIMEOUT", "The request was cancelled.");
  try {
    return await options.primary(question, AbortSignal.any([signal, AbortSignal.timeout(options.primaryTimeoutMs ?? 30_000)]));
  } catch (error) {
    // A cancelled client or expired overall budget must never start another API call.
    if (signal.aborted) throw new AgentError("TIMEOUT", "The request timed out or was cancelled.");
    if (!(error instanceof AgentError) || !error.retryable || !options.secondary) throw error;
    try {
      // Start a fresh session with the original question. No Gemini transcript,
      // source registry or partially completed calls cross provider boundaries.
      const result = await options.secondary(question, AbortSignal.any([signal, AbortSignal.timeout(75_000)]));
      return { ...result, fallback: { from: "gemini", reason: error.code } };
    } catch (secondaryError) {
      if (secondaryError instanceof AgentError) {
        secondaryError.attempts = [{ provider: "gemini", code: error.code }, { provider: "anthropic", code: secondaryError.code }];
      }
      throw secondaryError;
    }
  }
}

export async function answerTenantQuestion(question: string, signal?: AbortSignal): Promise<TenantAnswer> {
  validateQuestion(question);
  // CHAT_PROVIDER=anthropic: answer with Claude first (for example when the Gemini quota is used up).
  if (process.env.CHAT_PROVIDER?.trim() === "anthropic" && process.env.ANTHROPIC_API_KEY?.trim()) {
    return runWithFallback(question, {
      signal,
      primary: (input, attemptSignal) => runAgentLoop(input, claudeSessionFromEnv(input), { signal: attemptSignal }),
      // No second provider to fall back to, so allow slow tools (panorama inspection) the full budget.
      primaryTimeoutMs: 105_000,
    });
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AgentError("NOT_CONFIGURED", "Set GEMINI_API_KEY on the server.");
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_CHAT_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return runWithFallback(question, {
    signal,
    primary: (input, attemptSignal) => runAgentLoop(input, createGeminiSession(input, (parameters) => ai.models.generateContent(parameters), model), { signal: attemptSignal }),
    secondary: process.env.ANTHROPIC_API_KEY?.trim() ?
      (input, attemptSignal) => runAgentLoop(input, claudeSessionFromEnv(input), { signal: attemptSignal }) : undefined,
  });
}
