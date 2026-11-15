import "server-only";
import { queryDuckDB } from "../duckdb";
import { ToolValidationError, type SourceReference } from "./costar";

export async function get_spatial_context(input: { property_id: string; suite_id?: string }) {
  if (typeof input?.property_id !== "string" || !/^\d+$/.test(input.property_id) || BigInt(input.property_id) > BigInt("9223372036854775807")) throw new ToolValidationError("property_id must be a decimal BIGINT string.");
  if (input.suite_id !== undefined && (typeof input.suite_id !== "string" || !/^[a-f0-9]{64}$/i.test(input.suite_id))) throw new ToolValidationError("suite_id must be a 64-character hexadecimal identifier.");
  const [property] = await queryDuckDB(`SELECT cast(p.property_id AS VARCHAR) AS property_id, p.building_name, p.latitude, p.longitude,
    p.source_dataset, p.source_line::VARCHAR AS source_line, r.source_file, r.record_id
    FROM properties p LEFT JOIN source_records r ON r.dataset=p.source_dataset AND r.source_line=p.source_line
    WHERE p.property_id=?::BIGINT`, [input.property_id]);
  if (!property) return { status: "not_found", property_id: input.property_id };
  let suiteLabel: string | null = null;
  if (input.suite_id !== undefined) {
    const [suite] = await queryDuckDB("SELECT suite_normalized FROM suites WHERE property_id=?::BIGINT AND suite_id=?", [input.property_id, input.suite_id.toLowerCase()]);
    if (!suite) return { status: "suite_not_found_in_property", property_id: input.property_id, suite_id: input.suite_id };
    suiteLabel = suite.suite_normalized as string;
  }
  const models = await queryDuckDB(`SELECT DISTINCT i.model_id, i.name, i.shared_model, i.index_property_conflict, i.segment_conflict,
    i.source_dataset, i.source_line::VARCHAR AS source_line, i.field_path, r.source_file, r.record_id,
    normalize_suite(i.name) AS normalized_name
    FROM property_scan_inventory i LEFT JOIN source_records r ON r.dataset=i.source_dataset AND r.source_line=i.source_line
    WHERE i.property_id=?::BIGINT ORDER BY i.model_id`, [input.property_id]);
  const reference = (r: Record<string, unknown>): SourceReference => ({ dataset: r.source_dataset as string, source_line: r.source_line as string,
    source_file: r.source_file as string | null, record_id: r.record_id as string | null, field_path: (r.field_path as string | null) ?? null });
  return { status: "ok", property_id: property.property_id, building_name: property.building_name,
    latitude: property.latitude, longitude: property.longitude, suite_id: input.suite_id ?? null,
    models: models.map((model) => ({ model_id: model.model_id, name: model.name,
      suite_name_hint: suiteLabel !== null && model.normalized_name === suiteLabel,
      association_scope: "building", suite_extent_verified: false, shared_model: model.shared_model,
      index_property_conflict: model.index_property_conflict, segment_conflict: model.segment_conflict,
      source_references: [reference(model)] })),
    limitations: ["Coordinates anchor the property, not verified parcel boundaries.", "Scan links are recorded building associations. A matching model name is only a suite hint; scan extent must be verified."],
    source_references: [reference(property)] };
}
