import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";
import type { DuckDBInstance, DuckDBValue } from "@duckdb/node-api";

import { callBackendTool, usesRemoteBackend } from "./backend";

// Preserve the instance across Next.js development reloads. Each query gets its
// own connection, so simultaneous requests do not share connection state.
const globalDb = globalThis as typeof globalThis & {
  costarDuckDB?: Promise<DuckDBInstance>;
};

async function openDatabase(): Promise<DuckDBInstance> {
  const configuredPath = process.env.DUCKDB_PATH?.trim();
  if (!configuredPath) {
    throw new Error("Set DUCKDB_PATH to an existing commercial_clean.duckdb file.");
  }

  const databasePath = path.resolve(configuredPath);
  if (!(await stat(databasePath)).isFile()) {
    throw new Error("DUCKDB_PATH must point to a database file.");
  }

  const { DuckDBInstance } = await import("@duckdb/node-api");
  return DuckDBInstance.create(databasePath, {
    access_mode: "READ_ONLY",
    enable_external_access: "false",
  });
}

function getDatabase(): Promise<DuckDBInstance> {
  globalDb.costarDuckDB ??= openDatabase().catch((error: unknown) => {
    // A missing file or conflicting writer must not poison future requests.
    globalDb.costarDuckDB = undefined;
    throw error;
  });
  return globalDb.costarDuckDB;
}

// For trusted server-side SQL only. Bind input values through parameters; never
// expose this function as an endpoint accepting arbitrary SQL from a client.
export async function queryDuckDB(sql: string, parameters: DuckDBValue[] = []) {
  const instance = await getDatabase();
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(sql, parameters);
    try {
      // Converts BIGINTs, dates, and nested DuckDB values into JSON-safe values.
      return result.getRowObjectsJson();
    } finally {
      result.closeSync();
    }
  } finally {
    connection.closeSync();
  }
}

export async function getDuckDBHealth(): Promise<Record<string, unknown>> {
  if (usesRemoteBackend()) return callBackendTool<Record<string, unknown>>("database_health", {});
  const [health] = await queryDuckDB(`
    SELECT version() AS version,
           current_setting('access_mode') AS access_mode,
           (SELECT count(*) FROM properties) AS property_count,
           (SELECT count(*) FROM suites) AS suite_count,
           (SELECT count(*) FROM suite_history) AS suite_history_count,
           (SELECT count(*) FROM deals_normalized) AS rent_evidence_count
  `);
  if (!health) throw new Error("Database health query returned no result.");
  return health;
}
