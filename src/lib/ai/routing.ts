import { ToolValidationError } from "../tools/costar";

export type DataSource = "duckdb" | "matterport" | "vexcel";
export interface SourcePlan { primary_source: DataSource | null; requested_sources: DataSource[]; unsupported_capabilities: string[] }
// Transparent routing hints for the supported vocabulary. Unknown wording is
// left to the model rather than silently defaulted to the wrong data source.
export function routeQuestion(question: string): SourcePlan {
  const patterns: [DataSource, RegExp][] = [
    ["duckdb", /\b(rent|rental|availability|available|asking|lease|tenants?|occupants?|occupied|occupancy|previously|history)\b/i],
    ["matterport", /\b(rooms?|sinks?|cabinets?|interiors?|equipment|layout|exam|plumbing|kitchen|restroom|bathroom)\b/i],
    ["vexcel", /\b(parking|outdoor|outside|aerial|loading|driveway|yard|trees?|exterior)\b/i],
  ];
  const matches = patterns.map(([source, pattern]) => ({ source, index: question.search(pattern) })).filter((match) => match.index >= 0).sort((a, b) => a.index - b.index);
  return { primary_source: matches[0]?.source ?? null, requested_sources: matches.map((match) => match.source),
    unsupported_capabilities: /\b(rent|rental|availability|available|asking)\b/i.test(question) ? ["duckdb_rent_and_availability_tools"] : [] };
}
const domainByTool: Record<string, DataSource> = { get_tenant_history: "duckdb", get_matterport_rooms: "matterport", inspect_matterport_features: "matterport", inspect_vexcel_site: "vexcel" };
export function orderedExecutor(plan: SourcePlan, execute: (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>) {
  let primaryAttempted = false;
  return async (name: string, args: unknown, context?: { signal?: AbortSignal }) => {
    const source = domainByTool[name];
    // Entity resolution/coordinate/scan lookup is allowed before domain work.
    if (source && plan.primary_source && source !== plan.primary_source && !primaryAttempted) {
      throw new ToolValidationError(`Start domain evidence with ${plan.primary_source}; use other sources for missing pieces afterward.`);
    }
    try {
      const result = await execute(name, args, context?.signal);
      if (source === plan.primary_source) primaryAttempted = true;
      return result;
    } catch (error) {
      if (!(error instanceof ToolValidationError) && source === plan.primary_source) primaryAttempted = true;
      throw error;
    }
  };
}
