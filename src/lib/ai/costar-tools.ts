import "server-only";

import {
  find_properties, find_suites, get_tenant_history, ToolValidationError,
  type FindPropertiesInput, type FindSuitesInput, type TenantHistoryInput,
} from "../tools/costar";

const pagination = {
  limit: { type: "integer", minimum: 1, maximum: 100, description: "Page size, default 20." },
  offset: { type: "integer", minimum: 0, description: "Page offset, default 0. Check total before treating a page as complete." },
};

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
}

export const costarTools: ToolDefinition[] = [
  {
    name: "find_properties",
    description: "Find recorded properties by building name or primary street address. Exact and partial token matching, no typo correction or street-abbreviation expansion. Returns candidates with IDs and addresses. Narrow ambiguous matches using the user's address or city; never silently choose the first match.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["query"],
      properties: {
        query: { type: "string", description: "Building name or street address only; exclude suite number." },
        city: { type: "string", description: "Optional exact city filter." },
        state: { type: "string", description: "Optional exact state filter, e.g. TX." },
        ...pagination,
      },
    },
  },
  {
    name: "find_suites",
    description: "List recorded suites within a property or match a suite label. Returns stable suite IDs and floor IDs, which are identifiers, not floor numbers. Suite 900 and #900 normalize alike; 0900 is distinct. Repeated labels on different floors remain separate candidates. This catalog does not prove current availability.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["property_id"],
      properties: {
        property_id: { type: "string", description: "Decimal property ID from find_properties, kept as a string." },
        suite: { type: "string", description: "Optional recorded suite label, e.g. Suite 900." },
        property_floor_id: { type: "string", description: "Optional exact floor ID returned by a tool; do not invent from a floor number." },
        ...pagination,
      },
    },
  },
  {
    name: "get_tenant_history",
    description: "Retrieve all recorded tenant-history occurrences and issues for an exact suite ID. Supported history and uncertain candidate history are separate. Missing history does not prove vacancy. Preserve source references, date issues and uncertainty; never use lease expiration as occupancy end.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["suite_id"],
      properties: { suite_id: { type: "string", description: "64-character hexadecimal suite ID from find_suites." } },
    },
  },
];

export async function dispatchCostarTool(name: string, args: unknown): Promise<unknown> {
  const declaration = costarTools.find((tool) => tool.name === name);
  if (!declaration) throw new ToolValidationError(`Unknown tool: ${name}. Use a declared tool.`);
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolValidationError("Tool arguments must be an object.");
  }
  const schema = declaration.input_schema as { properties: Record<string, unknown> };
  if (Object.keys(args).some((key) => !Object.hasOwn(schema.properties, key))) {
    throw new ToolValidationError("Tool arguments contain unsupported fields.");
  }
  switch (name) {
    case "find_properties": return find_properties(args as FindPropertiesInput);
    case "find_suites": return find_suites(args as FindSuitesInput);
    case "get_tenant_history": return get_tenant_history(args as TenantHistoryInput);
    default: throw new ToolValidationError("Unknown tool.");
  }
}
