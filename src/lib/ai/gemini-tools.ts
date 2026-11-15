import "server-only";
import type { FunctionDeclaration } from "@google/genai";
import { agentTools } from "./agent-tools";
export { dispatchCostarTool } from "./costar-tools";

export const costarFunctionDeclarations: FunctionDeclaration[] = agentTools.map(
  ({ name, description, input_schema }) => ({ name, description, parametersJsonSchema: input_schema }),
);
