import "server-only";
import { FunctionCallingConfigMode, type Content, type GenerateContentParameters,
  type GenerateContentResponse } from "@google/genai";
import { costarFunctionDeclarations } from "./gemini-tools";
import { AgentError, systemInstruction, type ModelSession } from "./agent-core";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export type GeminiGenerate = (parameters: GenerateContentParameters) => Promise<GenerateContentResponse>;

export function createGeminiSession(question: string, generate: GeminiGenerate, model = DEFAULT_GEMINI_MODEL): ModelSession {
  const contents: Content[] = [{ role: "user", parts: [{ text: question.trim() }] }];
  return {
    provider: "gemini", model,
    async next(results, signal) {
      if (results.length) contents.push({ role: "user", parts: results.map(({ call, response }) => ({
        functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response },
      })) });
      const response = await generate({ model, contents, config: {
        systemInstruction, tools: [{ functionDeclarations: costarFunctionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        candidateCount: 1, maxOutputTokens: 4096, abortSignal: signal,
        httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } },
      } });
      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      if (!content?.parts?.length || (candidate?.finishReason && candidate.finishReason !== "STOP")) {
        throw new AgentError("INVALID_RESPONSE", "Gemini did not return a complete response.");
      }
      // Preserve all original parts, call IDs and opaque thought signatures.
      const calls = content.parts.flatMap((part) => part.functionCall ? [{
        id: part.functionCall.id, name: part.functionCall.name ?? "", args: part.functionCall.args ?? {},
      }] : []);
      if (calls.length) contents.push(content);
      return { calls, text: content.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("") };
    },
  };
}
