import "server-only";

import type { DuckDBValue } from "@duckdb/node-api";
import { queryDuckDB } from "../duckdb";

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

export interface SourceReference {
  dataset: string;
  source_line: string | null;
  source_type?: "duckdb" | "matterport" | "vexcel";
  model_id?: string;
  image_id?: string;
  asset_path?: string;
  retrieved_at?: string;
  captured_at?: string | null;
  scope?: string;
  source_file: string | null;
  record_id: string | null;
  field_path: string | null;
}

export interface PropertyAddress {
  street_number: string | null;
  street_number_end_range: string | null;
  street_direction: string | null;
  street_name: string | null;
  street_type: string | null;
  street_suffix: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

export interface PropertyIdentity {
  property_id: string;
  building_name: string | null;
  address: PropertyAddress;
  formatted_address: string;
}

export interface PropertyMatch extends PropertyIdentity {
  match_type: "exact" | "partial";
  source_references: SourceReference[];
}

export interface SuiteIdentity extends PropertyIdentity {
  suite_id: string;
  property_floor_id: string;
  suite_raw: string;
  suite_normalized: string;
  warnings: string[];
  source_references: SourceReference[];
}

export interface PageInput { limit?: number; offset?: number }
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
export interface FindPropertiesInput extends PageInput { query: string; city?: string; state?: string }
export interface FindSuitesInput extends PageInput { property_id: string; suite?: string; property_floor_id?: string }
export interface TenantHistoryInput { suite_id: string }

export interface TenantHistoryEntry {
  history_id: string;
  suite_id: string;
  property_id: string;
  occupancy_id: string;
  company_location_id: string | null;
  space_id: string | null;
  company_name: string | null;
  resolved_industry_code: string | null;
  resolved_industry_label: string | null;
  industry_source: string | null;
  suite_raw: string | null;
  suite_normalized: string | null;
  company_suite_raw: string | null;
  company_suite_normalized: string | null;
  property_floor_id: string | null;
  listed_floor_id: string;
  listed_suite_normalized: string;
  square_feet_occupied: number | null;
  from_date: string | null;
  move_in_date: string | null;
  to_date: string | null;
  lease_commencement_date: string | null;
  lease_expiration_date: string | null;
  lease_sign_date: string | null;
  timeline_start: string | null;
  timeline_start_source: string | null;
  match_status: "supported" | "candidate";
  match_method: string;
  supporting_reason: string;
  uncertainty_reason: string | null;
  suite_label_disagreement: boolean | null;
  floor_disagreement: boolean | null;
  floor_evidence: string;
  company_address_agreement: string;
  source_references: SourceReference[];
}

export interface HistoryIssue {
  suite_id: string;
  history_id: string | null;
  other_history_id: string | null;
  issue: string;
  detail: string;
  source_references: SourceReference[];
}

export type TenantHistoryResult =
  | { status: "not_found"; suite_id: string }
  | { status: "ok"; suite: SuiteIdentity; supported_history: TenantHistoryEntry[];
      candidate_history: TenantHistoryEntry[]; issues: HistoryIssue[] };

function objectInput(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolValidationError("Tool arguments must be an object.");
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolValidationError(`${field} must be a nonempty string.`);
  }
  return value.trim();
}

function decimalId(value: unknown, field: string): string {
  const id = text(value, field);
  if (!/^\d+$/.test(id) || BigInt(id) > BigInt("9223372036854775807")) {
    throw new ToolValidationError(`${field} must be a decimal BIGINT identifier.`);
  }
  return BigInt(id).toString();
}

function page(input: PageInput) {
  const { limit = 20, offset = 0 } = input;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ToolValidationError("limit must be an integer from 1 to 100.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ToolValidationError("offset must be a nonnegative safe integer.");
  }
  return { limit, offset };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// These SQL fragments contain only developer-owned expressions, never inputs.
const sqlNormalize = (expression: string) =>
  `trim(regexp_replace(lower(coalesce(${expression}, '')), '[^\\p{L}\\p{N}]+', ' ', 'g'))`;

function addressColumns(alias: string) {
  const a = (key: string) => `${alias}.address->>'$.${key}'`;
  const number = `concat_ws('-', ${a("streetNumber")}, ${a("streetNumberEndRange")})`;
  const street = `trim(concat_ws(' ', nullif(${number}, ''), ${a("streetDirection")}, ${a("streetName")}, ${a("streetType")}, ${a("streetSuffix")}))`;
  const formatted = `trim(concat_ws(' ', nullif(${street}, ''), ${alias}.city, ${alias}.state, ${alias}.postal_code))`;
  const structured = `struct_pack(
    street_number := ${a("streetNumber")}, street_number_end_range := ${a("streetNumberEndRange")},
    street_direction := ${a("streetDirection")}, street_name := ${a("streetName")},
    street_type := ${a("streetType")}, street_suffix := ${a("streetSuffix")},
    city := ${alias}.city, state := ${alias}.state, postal_code := ${alias}.postal_code)`;
  return { street, formatted, structured };
}

function sourceReference(dataset: string, line: string, pointer: string, source: string) {
  return `CASE WHEN ${dataset} IS NOT NULL AND ${line} IS NOT NULL THEN struct_pack(
    dataset := ${dataset}, source_line := cast(${line} AS VARCHAR),
    source_file := ${source}.source_file, record_id := ${source}.record_id,
    field_path := ${pointer}) END`;
}

const sourceJoin = (dataset: string, line: string, alias: string) =>
  `LEFT JOIN source_records ${alias} ON ${alias}.dataset = ${dataset} AND ${alias}.source_line = ${line}`;

// The result types below correspond to explicit SELECT projections, not raw
// DuckDB rows. JSON conversion is handled by the shared connection module.
async function rows<T>(sql: string, parameters: DuckDBValue[] = []): Promise<T[]> {
  return await queryDuckDB(sql, parameters) as unknown as T[];
}

export async function find_properties(input: FindPropertiesInput): Promise<Page<PropertyMatch>> {
  objectInput(input);
  const query = normalize(text(input.query, "query"));
  if (!query) throw new ToolValidationError("query must contain letters or digits.");
  const pagination = page(input);
  const parameters: DuckDBValue[] = [];
  const filters = query.split(" ").map((token) => {
    parameters.push(token);
    return "contains(search_text, ?)";
  });
  for (const field of ["city", "state"] as const) {
    if (input[field] !== undefined) {
      parameters.push(text(input[field], field));
      filters.push(`lower(trim(${field})) = lower(?)`);
    }
  }
  const address = addressColumns("p");
  const cte = `WITH searchable AS (
    SELECT p.*, ${address.structured} AS structured_address,
           ${address.formatted} AS formatted_address,
           ${sqlNormalize("p.building_name")} AS normalized_name,
           ${sqlNormalize(address.street)} AS normalized_street,
           ${sqlNormalize(address.formatted)} AS normalized_address,
           ${sqlNormalize(`concat_ws(' ', p.building_name, ${address.formatted})`)} AS search_text
    FROM properties p
  ), matches AS (SELECT * FROM searchable WHERE ${filters.join(" AND ")})`;
  const [counts, items] = await Promise.all([
    rows<{ total: number }>(`${cte} SELECT count(*)::DOUBLE AS total FROM matches`, parameters),
    rows<PropertyMatch>(`${cte}
      SELECT cast(p.property_id AS VARCHAR) AS property_id, p.building_name,
             p.structured_address AS address, p.formatted_address,
             CASE WHEN ? IN (normalized_name, normalized_street, normalized_address)
                  THEN 'exact' ELSE 'partial' END AS match_type,
             list_filter([${sourceReference("p.source_dataset", "p.source_line", "NULL::VARCHAR", "r")}], lambda x: x IS NOT NULL) AS source_references
      FROM matches p ${sourceJoin("p.source_dataset", "p.source_line", "r")}
      ORDER BY CASE WHEN match_type = 'exact' THEN 0 ELSE 1 END, p.property_id
      LIMIT ? OFFSET ?`, [...parameters, query, pagination.limit, pagination.offset]),
  ]);
  return { items, total: counts[0].total, ...pagination };
}

async function selectSuites(where: string, parameters: DuckDBValue[], pagination?: { limit: number; offset: number }) {
  const address = addressColumns("s");
  const items = await rows<SuiteIdentity>(`
    SELECT s.suite_id, cast(s.property_id AS VARCHAR) AS property_id,
           cast(s.property_floor_id AS VARCHAR) AS property_floor_id,
           s.suite_raw, s.suite_normalized, s.building_name,
           ${address.structured} AS address, ${address.formatted} AS formatted_address,
           CASE WHEN p.property_id IS NULL THEN ['missing_property_metadata'] ELSE [] END AS warnings
    FROM suites s LEFT JOIN properties p ON p.property_id = s.property_id
    WHERE ${where}
    ORDER BY s.suite_normalized, s.property_floor_id, s.suite_id
    ${pagination ? "LIMIT ? OFFSET ?" : ""}
  `, pagination ? [...parameters, pagination.limit, pagination.offset] : parameters);
  if (items.length === 0) return items;
  const references = await rows<{ suite_id: string; reference: SourceReference }>(`
    SELECT l.suite_id,
           ${sourceReference("l.source_dataset", "l.source_line", "l.field_path", "r")} AS reference
    FROM suite_listing_links l ${sourceJoin("l.source_dataset", "l.source_line", "r")}
    WHERE l.suite_id IN (${items.map(() => "?").join(",")})
    ORDER BY l.suite_id, l.source_dataset, l.source_line, l.field_path
  `, items.map((item) => item.suite_id));
  return items.map((item) => ({
    ...item,
    source_references: references.filter((ref) => ref.suite_id === item.suite_id && ref.reference).map((ref) => ref.reference),
  }));
}

export async function find_suites(input: FindSuitesInput): Promise<Page<SuiteIdentity>> {
  objectInput(input);
  const parameters: DuckDBValue[] = [decimalId(input.property_id, "property_id")];
  const filters = ["s.property_id = ?::BIGINT"];
  const pagination = page(input);
  if (input.suite !== undefined) {
    const label = text(input.suite, "suite");
    const [normalized] = await queryDuckDB("SELECT normalize_suite(?) AS label", [label]);
    if (typeof normalized.label !== "string") throw new ToolValidationError("suite must contain a suite label.");
    parameters.push(normalized.label);
    filters.push("s.suite_normalized = ?");
  }
  if (input.property_floor_id !== undefined) {
    parameters.push(decimalId(input.property_floor_id, "property_floor_id"));
    filters.push("s.property_floor_id = ?::BIGINT");
  }
  const where = filters.join(" AND ");
  const [counts, items] = await Promise.all([
    rows<{ total: number }>(`SELECT count(*)::DOUBLE AS total FROM suites s WHERE ${where}`, parameters),
    selectSuites(where, parameters, pagination),
  ]);
  return { items, total: counts[0].total, ...pagination };
}

async function selectHistory(table: "suite_history" | "suite_history_candidates", suiteId: string) {
  return rows<TenantHistoryEntry>(`
    SELECT h.history_id, h.suite_id,
      ${["property_id", "occupancy_id", "company_location_id", "space_id", "resolved_industry_code", "property_floor_id", "listed_floor_id"].map((column) => `cast(h.${column} AS VARCHAR) AS ${column}`).join(", ")},
      ${["company_name", "resolved_industry_label", "industry_source", "suite_raw", "suite_normalized", "company_suite_raw", "company_suite_normalized", "listed_suite_normalized", "square_feet_occupied", "from_date", "move_in_date", "to_date", "lease_commencement_date", "lease_expiration_date", "lease_sign_date", "timeline_start", "timeline_start_source", "match_status", "match_method", "supporting_reason", "uncertainty_reason", "suite_label_disagreement", "floor_disagreement", "floor_evidence", "company_address_agreement"].map((column) => `h.${column}`).join(", ")},
      list_filter([
        ${sourceReference("h.source_dataset", "h.source_line", "h.field_path", "r")},
        ${sourceReference("h.company_source_dataset", "h.company_source_line", "NULL::VARCHAR", "c")}
      ], lambda x: x IS NOT NULL) AS source_references
    FROM ${table} h
    ${sourceJoin("h.source_dataset", "h.source_line", "r")}
    ${sourceJoin("h.company_source_dataset", "h.company_source_line", "c")}
    WHERE h.suite_id = ?
    ORDER BY h.timeline_start ASC NULLS LAST, h.occupancy_id, h.history_id
  `, [suiteId]);
}

export async function get_tenant_history(input: TenantHistoryInput): Promise<TenantHistoryResult> {
  objectInput(input);
  const suiteId = text(input.suite_id, "suite_id").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(suiteId)) {
    throw new ToolValidationError("suite_id must be a 64-character hexadecimal identifier.");
  }
  const [suite] = await selectSuites("s.suite_id = ?", [suiteId]);
  if (!suite) return { status: "not_found", suite_id: suiteId };
  const [supported_history, candidate_history, issues] = await Promise.all([
    selectHistory("suite_history", suiteId),
    selectHistory("suite_history_candidates", suiteId),
    rows<HistoryIssue>(`
      SELECT i.suite_id, i.history_id, i.other_history_id, i.issue, i.detail,
             list_filter([${sourceReference("i.source_dataset", "i.source_line", "i.field_path", "r")}], lambda x: x IS NOT NULL) AS source_references
      FROM suite_history_issues i ${sourceJoin("i.source_dataset", "i.source_line", "r")}
      WHERE i.suite_id = ?
      ORDER BY i.issue, i.source_line, i.field_path, i.history_id, i.other_history_id, i.detail
    `, [suiteId]),
  ]);
  return { status: "ok", suite, supported_history, candidate_history, issues };
}
