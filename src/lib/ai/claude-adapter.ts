import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming, MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { AgentError, systemInstruction, type ModelSession } from "./agent-core";
import { agentTools } from "./agent-tools";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
export type ClaudeGenerate = (parameters: MessageCreateParamsNonStreaming, signal: AbortSignal) => Promise<Message>;
export const claudeTools: Tool[] = agentTools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

export function createClaudeSession(question: string, generate: ClaudeGenerate, model = DEFAULT_CLAUDE_MODEL): ModelSession {
  const messages: MessageParam[] = [{ role: "user", content: question.trim() }];
  return {
    provider: "anthropic", model,
    async next(results, signal) {
      if (results.length) messages.push({ role: "user", content: results.map(({ call, response, isError }) => ({
        type: "tool_result" as const, tool_use_id: call.id!, content: JSON.stringify(response), is_error: isError,
      })) });
      const response = await generate({ model, max_tokens: 4096, system: systemInstruction,
        messages, tools: claudeTools, tool_choice: { type: "auto" }, stream: false }, signal);
      if (!response.content.length || !["end_turn", "tool_use"].includes(response.stop_reason ?? "")) {
        throw new AgentError("INVALID_RESPONSE", "Claude did not return a complete response.");
      }
      const calls = response.content.flatMap((block) => block.type === "tool_use" ? [{ id: block.id, name: block.name, args: block.input }] : []);
      if ((response.stop_reason === "tool_use") !== (calls.length > 0) || calls.some((call) => !call.id)) {
        throw new AgentError("INVALID_RESPONSE", "Claude returned an invalid tool-use response.");
      }
      // Preserve the complete assistant turn, including thinking/signatures.
      // All results immediately follow it as one user message.
      if (calls.length) messages.push({ role: "assistant", content: response.content });
      return { calls, text: response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("") };
    },
  };
}

export function claudeSessionFromEnv(question: string): ModelSession {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new AgentError("NOT_CONFIGURED", "Set ANTHROPIC_API_KEY on the server.");
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  return createClaudeSession(question, (parameters, signal) => client.messages.create(parameters, { signal }),
    process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL);
}
