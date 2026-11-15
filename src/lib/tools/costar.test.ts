import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { queryDuckDB } from "../duckdb";
import { get_spatial_context } from "./spatial-context";
import { find_properties, find_suites, get_tenant_history, ToolValidationError } from "./costar";

const ids = { main: "a".repeat(64), otherFloor: "b".repeat(64), leadingZero: "c".repeat(64),
  otherBuilding: "d".repeat(64), missingProperty: "e".repeat(64), empty: "f".repeat(64) };
const largeId = "9007199254740993";
let directory: string;
const originalPath = process.env.DUCKDB_PATH;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "costar-tools-"));
  const database = path.join(directory, "fixture.duckdb");
  const instance = await DuckDBInstance.create(database);
  const db = await instance.connect();
  try {
    await db.run(`
      CREATE TABLE source_records(dataset VARCHAR, source_line BIGINT, source_file VARCHAR, record_id VARCHAR, payload JSON);
      INSERT INTO source_records VALUES
        ('commercial-property', 1, 'property.jsonl', '1', '{}'),
        ('commercial-property', 2, 'property.jsonl', '2', '{}'),
        ('commercial-property', 3, 'property.jsonl', '3', '{}'),
        ('commercial-property', 4, 'property.jsonl', '${largeId}', '{}'),
        ('commercial-listing-summary', 1, 'listing.jsonl', '101', '{"forLeaseSummary":{"spaces":[{},{}]}}'),
        ('location-occupancy', 1, 'occupancy.jsonl', '201', '{"spaces":[{}]}'),
        ('location-occupancy', 2, 'occupancy.jsonl', '202', '{"spaces":[{}]}'),
        ('company-detail', 1, 'company.jsonl', '301', '{}');
      CREATE TABLE properties(property_id BIGINT, building_name VARCHAR, address JSON, city VARCHAR, state VARCHAR,
        postal_code VARCHAR, source_dataset VARCHAR, source_line BIGINT);
      INSERT INTO properties VALUES
        (1, 'Medical Plaza', '{"streetNumber":"100","streetName":"Main","streetType":"St"}', 'Houston', 'TX', '77001', 'commercial-property', 1),
        (2, 'Medical Plaza Annex', '{"streetNumber":"100","streetName":"Main","streetType":"St"}', 'Austin', 'TX', '78701', 'commercial-property', 2),
        (3, 'Medical Plaza', '{"streetNumber":"200","streetName":"Oak","streetType":"Rd"}', 'Houston', 'TX', '77002', 'commercial-property', 3),
        (${largeId}, 'Café North', '{"streetNumber":"5","streetName":"École","streetType":"St"}', 'Houston', 'TX', NULL, 'commercial-property', 4);
      ALTER TABLE properties ADD COLUMN latitude DOUBLE DEFAULT 29;
      ALTER TABLE properties ADD COLUMN longitude DOUBLE DEFAULT -95;
      CREATE TABLE property_scan_inventory(property_id BIGINT, model_id VARCHAR, name VARCHAR, shared_model BOOLEAN,
        index_property_conflict BOOLEAN, segment_conflict BOOLEAN, source_dataset VARCHAR, source_line BIGINT, field_path VARCHAR);
      INSERT INTO property_scan_inventory VALUES (1, 'fixture123', 'Suite 900', false, false, false, 'commercial-listing-summary', 1, '/forLeaseSummary/spaces/0');
      CREATE TABLE suites(suite_id VARCHAR, property_id BIGINT, property_floor_id BIGINT, suite_raw VARCHAR,
        suite_normalized VARCHAR, building_name VARCHAR, address JSON, city VARCHAR, state VARCHAR, postal_code VARCHAR);
      CREATE TABLE suite_listing_links(suite_id VARCHAR, source_dataset VARCHAR, source_line BIGINT, field_path VARCHAR);
      CREATE MACRO normalize_suite(value) AS nullif(trim(regexp_replace(
        upper(trim(regexp_replace(value, '[[:space:]]+', ' ', 'g'))),
        '^(SUITE|STE)([[:space:].:#-]+)|^#[[:space:]]*', '')), '');
    `);
    for (const [id, property, floor, label] of [
      [ids.main, "1", "9", "900"], [ids.otherFloor, "1", "8", "900"],
      [ids.leadingZero, "1", "9", "0900"], [ids.otherBuilding, "2", "9", "900"],
      [ids.empty, "1", "9", "1000"],
    ]) {
      await db.run(`INSERT INTO suites SELECT ?, property_id, ?::BIGINT, ?, ?, building_name, address, city, state, postal_code
        FROM properties WHERE property_id = ?::BIGINT`, [id, floor, label, label, property]);
      await db.run("INSERT INTO suite_listing_links VALUES (?, 'commercial-listing-summary', 1, '/forLeaseSummary/spaces/0')", [id]);
    }
    await db.run("INSERT INTO suites VALUES (?, 999, 9, '900', '900', NULL, NULL, NULL, NULL, NULL)", [ids.missingProperty]);
    await db.run("INSERT INTO suite_listing_links VALUES (?, 'commercial-listing-summary', 99, '/forLeaseSummary/spaces/0')", [ids.missingProperty]);
    await db.run("INSERT INTO suite_listing_links VALUES (?, 'commercial-listing-summary', 1, '/forLeaseSummary/spaces/1')", [ids.main]);

    const historyColumns = `history_id VARCHAR, suite_id VARCHAR, property_id BIGINT DEFAULT 1,
      occupancy_id BIGINT, company_location_id BIGINT DEFAULT 301, space_id BIGINT DEFAULT 401,
      resolved_industry_code BIGINT DEFAULT 1, property_floor_id BIGINT DEFAULT 9, listed_floor_id BIGINT DEFAULT 9,
      company_name VARCHAR DEFAULT 'Fixture Medical', resolved_industry_label VARCHAR DEFAULT 'Medical',
      industry_source VARCHAR DEFAULT 'occupancy', suite_raw VARCHAR DEFAULT '900', suite_normalized VARCHAR DEFAULT '900',
      company_suite_raw VARCHAR DEFAULT '900', company_suite_normalized VARCHAR DEFAULT '900', listed_suite_normalized VARCHAR DEFAULT '900',
      square_feet_occupied DOUBLE DEFAULT 1000, from_date TIMESTAMPTZ, move_in_date TIMESTAMPTZ, to_date TIMESTAMPTZ,
      lease_commencement_date TIMESTAMPTZ, lease_expiration_date TIMESTAMPTZ, lease_sign_date TIMESTAMPTZ,
      timeline_start TIMESTAMPTZ, timeline_start_source VARCHAR, match_status VARCHAR,
      match_method VARCHAR DEFAULT 'historical_suite_and_floor', supporting_reason VARCHAR DEFAULT 'Recorded suite and floor match',
      uncertainty_reason VARCHAR, suite_label_disagreement BOOLEAN DEFAULT false, floor_disagreement BOOLEAN DEFAULT false,
      floor_evidence VARCHAR DEFAULT 'agree', company_address_agreement VARCHAR DEFAULT 'agree',
      source_dataset VARCHAR DEFAULT 'location-occupancy', source_line BIGINT DEFAULT 1, field_path VARCHAR DEFAULT '/spaces/0',
      company_source_dataset VARCHAR DEFAULT 'company-detail', company_source_line BIGINT DEFAULT 1`;
    await db.run(`CREATE TABLE suite_history (${historyColumns}); CREATE TABLE suite_history_candidates (${historyColumns});
      CREATE TABLE suite_history_issues(suite_id VARCHAR, history_id VARCHAR, other_history_id VARCHAR,
        source_dataset VARCHAR, source_line BIGINT, field_path VARCHAR, issue VARCHAR, detail VARCHAR);`);
    for (const [id, occupancy, start, end] of [
      ["later", "202", "2022-01-01", "2021-01-01"],
      ["earlier", largeId, "2020-01-01", null], ["unknown", "203", null, null],
    ]) {
      await db.run(`INSERT INTO suite_history
        (history_id, suite_id, occupancy_id, from_date, to_date, timeline_start, timeline_start_source, match_status)
        VALUES (?, ?, ?::BIGINT, ?::TIMESTAMPTZ, ?::TIMESTAMPTZ, ?::TIMESTAMPTZ, ?, 'supported')`,
      [id, ids.main, occupancy, start, end, start, start ? "from_date" : null]);
    }
    await db.run(`INSERT INTO suite_history_candidates
      (history_id,suite_id,occupancy_id,match_status,match_method,uncertainty_reason,property_floor_id,floor_disagreement,floor_evidence)
      VALUES ('candidate', ?, 204, 'candidate', 'historical_suite_floor_uncertain', 'Floor differs', 8, true, 'conflict')`, [ids.main]);
    for (const [history, other, issue] of [["earlier", "later", "overlapping_occupancies"], ["later", null, "reversed_occupancy_dates"], [null, null, "listing_issue"]]) {
      await db.run("INSERT INTO suite_history_issues VALUES (?, ?, ?, 'location-occupancy', 1, '/spaces/0', ?, 'Preserve source issue')", [ids.main, history, other, issue]);
    }
  } finally {
    db.closeSync();
    instance.closeSync();
  }
  // Test operational failures before the first successful (cached) connection.
  delete process.env.DUCKDB_PATH;
  await assert.rejects(find_properties({ query: "Medical" }), /Set DUCKDB_PATH/);
  process.env.DUCKDB_PATH = path.join(directory, "missing.duckdb");
  await assert.rejects(find_properties({ query: "Medical" }), /ENOENT/);
  process.env.DUCKDB_PATH = database;
});

after(async () => {
  const globalDb = globalThis as typeof globalThis & { costarDuckDB?: Promise<DuckDBInstance> };
  (await globalDb.costarDuckDB)?.closeSync();
  delete globalDb.costarDuckDB;
  if (originalPath === undefined) delete process.env.DUCKDB_PATH;
  else process.env.DUCKDB_PATH = originalPath;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("property search ranks exact names, preserves ambiguity, and resolves references", async () => {
  const result = await find_properties({ query: "  MEDICAL,   PLAZA! " });
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map((p) => [p.property_id, p.match_type]), [["1", "exact"], ["3", "exact"], ["2", "partial"]]);
  assert.deepEqual(result.items[0].source_references, [{ dataset: "commercial-property", source_line: "1", source_file: "property.jsonl", record_id: "1", field_path: null }]);
  assert.equal(result.items[0].address.street_number, "100");
  assert.equal(result.items[0].formatted_address, "100 Main St Houston TX 77001");
});

test("address tokens, filters, unicode and literal punctuation work without wildcard SQL", async () => {
  const address = await find_properties({ query: "100 Main St", city: " houston ", state: "tx" });
  assert.equal(address.total, 1);
  assert.equal(address.items[0].match_type, "exact");
  assert.equal((await find_properties({ query: "main 100", city: "Austin" })).total, 1);
  assert.equal((await find_properties({ query: "Café" })).items[0].property_id, largeId);
  assert.equal((await find_properties({ query: "%medical_" })).total, 3);
  for (const query of ["' OR 1=1 --", "missing building"]) {
    assert.equal((await find_properties({ query })).total, 0);
  }
});

test("pagination retains total even past the last page", async () => {
  const page = await find_properties({ query: "Medical", limit: 1, offset: 1 });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].property_id, "2");
  assert.deepEqual(await find_properties({ query: "Medical", limit: 1, offset: 99 }), { items: [], total: 3, limit: 1, offset: 99 });
});

test("suite normalization preserves floors, leading zeros and property boundaries", async () => {
  for (const suite of ["Suite 900", "STE. 900", "#900", " \tSuite\t900\n"]) {
    const result = await find_suites({ property_id: "1", suite });
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map((s) => s.suite_id), [ids.otherFloor, ids.main]);
  }
  assert.equal((await find_suites({ property_id: "1", suite: "0900" })).items[0].suite_id, ids.leadingZero);
  assert.equal((await find_suites({ property_id: "2", suite: "900" })).items[0].suite_id, ids.otherBuilding);
  assert.equal((await find_suites({ property_id: "1", suite: "900", property_floor_id: "9" })).items[0].suite_id, ids.main);
  assert.equal((await find_suites({ property_id: "1", suite: "' OR 1=1 --" })).total, 0);
});

test("listing joins do not duplicate suites or their page totals", async () => {
  const result = await find_suites({ property_id: "1", suite: "900", property_floor_id: "9", limit: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].source_references.map((r) => r.field_path), ["/forLeaseSummary/spaces/0", "/forLeaseSummary/spaces/1"]);
  assert.equal((await find_suites({ property_id: "1" })).total, 4);
  assert.equal((await find_suites({ property_id: "1", offset: 99 })).total, 4);
});

test("missing property metadata and unresolved source fields remain explicit", async () => {
  const result = await find_suites({ property_id: "999" });
  const suite = result.items[0];
  assert.deepEqual(suite.warnings, ["missing_property_metadata"]);
  assert.equal(suite.building_name, null);
  assert.equal(suite.address.street_number, null);
  assert.deepEqual(suite.source_references[0], { dataset: "commercial-listing-summary", source_line: "99", source_file: null, record_id: null, field_path: "/forLeaseSummary/spaces/0" });
});

test("history preserves evidence categories, dates, source occurrences and issues", async () => {
  const result = await get_tenant_history({ suite_id: ids.main.toUpperCase() });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.supported_history.map((h) => h.history_id), ["earlier", "later", "unknown"]);
  assert.equal(result.supported_history[0].occupancy_id, largeId);
  assert.equal(result.supported_history[0].to_date, null);
  assert.equal(result.supported_history[2].timeline_start, null);
  assert.equal(result.supported_history[1].timeline_start_source, "from_date");
  assert.ok(result.supported_history[1].from_date! > result.supported_history[1].to_date!);
  assert.equal(result.supported_history[0].source_references.length, 2);
  assert.equal(result.supported_history[0].source_references[0].field_path, "/spaces/0");
  assert.equal(result.supported_history[0].source_references[1].source_file, "company.jsonl");
  assert.equal(result.candidate_history.length, 1);
  assert.equal(result.candidate_history[0].floor_disagreement, true);
  assert.equal(result.candidate_history[0].uncertainty_reason, "Floor differs");
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.some((i) => i.other_history_id === "later"));
  assert.ok(result.issues.some((i) => i.history_id === null));
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal((await queryDuckDB("SELECT current_setting('access_mode') AS mode"))[0].mode, "read_only");
});

test("unknown suite differs from an existing suite without recorded history", async () => {
  assert.deepEqual(await get_tenant_history({ suite_id: "0".repeat(64) }), { status: "not_found", suite_id: "0".repeat(64) });
  const empty = await get_tenant_history({ suite_id: ids.empty });
  assert.equal(empty.status, "ok");
  if (empty.status === "ok") {
    assert.deepEqual(empty.supported_history, []);
    assert.deepEqual(empty.candidate_history, []);
    assert.deepEqual(empty.issues, []);
  }
});

test("invalid arguments raise validation errors", async () => {
  const invalid = [
    () => find_properties({ query: "" }), () => find_properties({ query: "%_" }),
    () => find_properties({ query: "Medical", city: "" }),
    () => find_properties({ query: "Medical", limit: 101 }),
    () => find_properties({ query: "Medical", limit: 1.5 }),
    () => find_properties({ query: "Medical", offset: -1 }),
    () => find_properties({ query: "Medical", offset: Number.MAX_SAFE_INTEGER + 1 }),
    () => find_suites({ property_id: "1 OR 1=1" }),
    () => find_suites({ property_id: "9223372036854775808" }),
    () => find_suites({ property_id: "1", property_floor_id: "-1" }),
    () => find_suites({ property_id: "1", suite: "# " }),
    () => get_tenant_history({ suite_id: "900" }),
    () => find_properties(null as never),
  ];
  for (const call of invalid) await assert.rejects(call, ToolValidationError);
});

test("spatial context preserves building scope and rejects cross-property suite matches", async () => {
  const result = await get_spatial_context({ property_id: "1", suite_id: ids.main });
  assert.equal(result.status, "ok");
  assert.equal(result.latitude, 29);
  assert.equal(result.longitude, -95);
  assert.ok(result.models);
  assert.equal(result.models[0].suite_name_hint, true);
  assert.equal(result.models[0].suite_extent_verified, false);
  assert.equal(result.models[0].association_scope, "building");
  assert.equal(result.models[0].source_references[0].field_path, "/forLeaseSummary/spaces/0");
  assert.equal((await get_spatial_context({ property_id: "1", suite_id: ids.otherBuilding })).status, "suite_not_found_in_property");
  assert.equal((await get_spatial_context({ property_id: "999" })).status, "not_found");
  await assert.rejects(get_spatial_context({ property_id: "1 OR 1=1" }), ToolValidationError);
});
