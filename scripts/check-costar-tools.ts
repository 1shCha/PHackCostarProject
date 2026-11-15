import assert from "node:assert/strict";
import { queryDuckDB } from "../src/lib/duckdb";
import { find_properties, find_suites, get_tenant_history, type SourceReference } from "../src/lib/tools/costar";

async function verifyReference(ref: SourceReference) {
  const [source] = await queryDuckDB(`
    SELECT source_file, record_id, payload::VARCHAR AS payload
    FROM source_records WHERE dataset = ? AND source_line = ?::BIGINT
  `, [ref.dataset, ref.source_line]);
  assert.ok(source, "Evidence locator must resolve to a source record");
  assert.equal(ref.source_file, source.source_file);
  assert.equal(ref.record_id, source.record_id);
  if (ref.field_path !== null) {
    assert.ok(ref.field_path === "" || ref.field_path.startsWith("/"), "Expected a JSON Pointer");
    let value: unknown = JSON.parse(source.payload as string);
    for (const token of ref.field_path === "" ? [] : ref.field_path.slice(1).split("/")) {
      const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
      assert.ok(value !== null && typeof value === "object" && Object.hasOwn(value, key), "JSON Pointer must resolve in source payload");
      value = (value as Record<string, unknown>)[key];
    }
  }
}

async function main() {
  for (const example of [
    { property_id: "238587", name: "Houston Medical Plaza", address: "6655 Travis St", suite: "900" },
    { property_id: "239781", name: "Dairy Ashford Plaza", address: "2000 S Dairy Ashford Rd", suite: "550" },
  ]) {
    for (const query of [example.name, example.address]) {
      const matches = await find_properties({ query, city: "Houston", state: "TX", limit: 100 });
      assert.ok(matches.items.some((p) => p.property_id === example.property_id));
    }
    const suites = await find_suites({ property_id: example.property_id, suite: `Suite ${example.suite}` });
    const directSuites = await queryDuckDB(`
      SELECT suite_id FROM suites WHERE property_id = ?::BIGINT AND suite_normalized = ?
      ORDER BY suite_normalized, property_floor_id, suite_id
    `, [example.property_id, example.suite]);
    assert.equal(suites.total, directSuites.length);
    assert.deepEqual(suites.items.map((s) => s.suite_id), directSuites.map((s) => s.suite_id));
    assert.ok(suites.items.length > 0);
    for (const suite of suites.items) {
      const result = await get_tenant_history({ suite_id: suite.suite_id });
      assert.equal(result.status, "ok");
      if (result.status !== "ok") throw new Error("Expected recorded suite");
      for (const [table, entries, status] of [
        ["suite_history", result.supported_history, "supported"],
        ["suite_history_candidates", result.candidate_history, "candidate"],
      ] as const) {
        const direct = await queryDuckDB(`SELECT history_id FROM ${table} WHERE suite_id = ?
          ORDER BY timeline_start ASC NULLS LAST, occupancy_id, history_id`, [suite.suite_id]);
        assert.deepEqual(entries.map((h) => h.history_id), direct.map((h) => h.history_id));
        assert.ok(entries.every((h) => h.match_status === status));
      }
      const [count] = await queryDuckDB("SELECT count(*)::DOUBLE AS total FROM suite_history_issues WHERE suite_id = ?", [suite.suite_id]);
      assert.equal(result.issues.length, count.total);
      const references = [...suite.source_references,
        ...result.supported_history.flatMap((h) => h.source_references),
        ...result.candidate_history.flatMap((h) => h.source_references),
        ...result.issues.flatMap((i) => i.source_references)];
      for (const ref of references) await verifyReference(ref);
      assert.doesNotThrow(() => JSON.stringify(result));
    }
  }
  console.log("Real-database tool checks passed for both examples: property/suite resolution, supported/candidate history, issues, and source JSON Pointers.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
