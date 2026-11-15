import "server-only";
import { costarTools, dispatchCostarTool, type ToolDefinition } from "./costar-tools";
import { ToolValidationError } from "../tools/costar";
import { get_spatial_context } from "../tools/spatial-context";
import { get_matterport_rooms, inspect_matterport_features } from "../spatial/matterport-tools";
import { inspect_vexcel_site } from "../spatial/vexcel-tools";

export const spatialTools: ToolDefinition[] = [
  { name: "get_spatial_context", description: "DuckDB entity lookup for property coordinates and candidate Matterport model IDs. May be used before either spatial source; it does not answer visual questions. Links establish building associations, not verified suite extent. suite_name_hint is only a name hint. Review conflicts and ask if ambiguous.",
    input_schema: { type: "object", additionalProperties: false, required: ["property_id"], properties: {
      property_id: { type: "string" }, suite_id: { type: "string", description: "Optional exact suite ID to identify name hints, not to confirm scan extent." },
    } } },
  { name: "get_matterport_rooms", description: "Start room/layout questions here after resolving the model. Returns room geometry and Matterport labels from the scan, not lease records. Scan date and suite extent remain unverified. Use inspect_matterport_features for visible sinks/cabinets/equipment.",
    input_schema: { type: "object", additionalProperties: false, required: ["model_id"], properties: { model_id: { type: "string" } } } },
  { name: "inspect_matterport_features", description: "Inspect a bounded sample of Matterport panorama views for visible room use, sinks, cabinets and equipment. Defaults to one panorama, maximum two. Select room_id from get_matterport_rooms to target a room. Not a full inventory; counts can duplicate objects across views. Not observed does not mean absent. Cite image sources and disclose scope/date uncertainty.",
    input_schema: { type: "object", additionalProperties: false, required: ["model_id"], properties: { model_id: { type: "string" }, room_id: { type: "string" }, max_panoramas: { type: "integer", minimum: 1, maximum: 2 } } } },
  { name: "inspect_vexcel_site", description: "Start parking/outdoor questions here using property coordinates. Retrieves the newest available Vexcel ortho collection and analyzes a bounded vicinity image. Returns approximate visible observations and collection date, not ownership, legal parcel boundaries, live availability, or exact certified stall counts.",
    input_schema: { type: "object", additionalProperties: false, required: ["latitude", "longitude"], properties: {
      latitude: { type: "number" }, longitude: { type: "number" }, half_width_m: { type: "number", minimum: 20, maximum: 150 },
    } } },
];
export const agentTools = [...costarTools, ...spatialTools];
export async function dispatchAgentTool(name: string, args: unknown, context?: { signal?: AbortSignal }): Promise<unknown> {
  const tool = agentTools.find((entry) => entry.name === name);
  if (!tool) throw new ToolValidationError("Unknown tool. Use a declared source tool.");
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new ToolValidationError("Tool arguments must be an object.");
  if (Object.keys(args).some((key) => !Object.hasOwn(tool.input_schema.properties, key))) throw new ToolValidationError("Unsupported tool argument.");
  const input: unknown = args;
  switch (name) {
    case "get_spatial_context": return get_spatial_context(input as Parameters<typeof get_spatial_context>[0]);
    case "get_matterport_rooms": return get_matterport_rooms(input as Parameters<typeof get_matterport_rooms>[0], context?.signal);
    case "inspect_matterport_features": return inspect_matterport_features(input as Parameters<typeof inspect_matterport_features>[0], context?.signal);
    case "inspect_vexcel_site": return inspect_vexcel_site(input as Parameters<typeof inspect_vexcel_site>[0], context?.signal);
    default: return dispatchCostarTool(name, args);
  }
}
