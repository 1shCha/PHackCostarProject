import assert from "node:assert/strict";
import { getDuckDBHealth, queryDuckDB } from "../src/lib/duckdb";

async function main() {
  const health = await getDuckDBHealth();
  assert.equal(health.access_mode, "read_only");
  assert.ok(BigInt(String(health.suite_count)) > BigInt(0), "Expected suites in the supplied database");
  assert.doesNotThrow(() => JSON.stringify(health));

  const [suite] = await queryDuckDB("SELECT suite_id FROM suites ORDER BY suite_id LIMIT 1");
  assert.equal(typeof suite.suite_id, "string");
  const rows = await queryDuckDB(
    "SELECT suite_id, property_id FROM suites WHERE suite_id = ?",
    [suite.suite_id as string],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].suite_id, suite.suite_id);
  assert.doesNotThrow(() => JSON.stringify(rows));
  assert.deepEqual(await queryDuckDB("SELECT suite_id FROM suites WHERE suite_id = ?", ["' OR 1=1 --"]), []);

  const [values] = await queryDuckDB("SELECT 9007199254740993::BIGINT AS large_id, DATE '2026-11-14' AS snapshot_date");
  assert.equal(values.large_id, "9007199254740993");
  assert.equal(values.snapshot_date, "2026-11-14");
  console.log("DuckDB checks passed: read-only mode, expected views, parameter binding, and JSON serialization.");
  console.log(JSON.stringify(health, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
