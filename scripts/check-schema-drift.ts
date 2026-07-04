#!/usr/bin/env tsx
/**
 * scripts/check-schema-drift.ts
 *
 * Proactively detects column type mismatches between the drizzle schema
 * (shared/schema.ts) and the live database BEFORE db:push runs.
 *
 * This prevents the class of failure where drizzle-kit errors with:
 *   "column 'X' cannot be cast automatically to type integer"
 * because a column was originally created as `text` but the schema now
 * declares it as `integer` (or another incompatible type).
 *
 * How it works:
 *   1. Imports every exported pgTable from shared/schema.ts via drizzle-orm
 *      introspection (getTableName + getTableColumns + getSQLType).
 *   2. Connects to the database and queries information_schema.columns for
 *      the public schema to get every live column's data_type.
 *   3. Maps drizzle SQL types to their PostgreSQL information_schema equivalents.
 *   4. Reports every mismatch and exits non-zero so db:push is never attempted
 *      on a column that cannot be auto-cast.
 *
 * Remediation:
 *   Add an idempotent ALTER TABLE … TYPE … USING block to scripts/db-migrate.sh
 *   for each flagged column, then re-run this script to confirm it passes.
 *
 * Usage:
 *   npx tsx scripts/check-schema-drift.ts
 *   npm run db:check-drift
 *
 * Exit codes:
 *   0 — no mismatches (or DATABASE_URL not set — prints a warning and skips)
 *   1 — one or more column type mismatches detected; db:push should NOT run
 *   1 — DATABASE_URL is set but the database could not be reached (auth
 *       failure, connection refused, timeout, DNS failure, etc). A
 *       misconfigured-but-present DATABASE_URL must NOT be treated the same
 *       as "not set" — silently skipping here would give false confidence
 *       that drift was checked in a post-merge environment.
 */

import { Client } from "pg";
import { getTableName, getTableColumns, isTable } from "drizzle-orm";
import * as schema from "../shared/schema";

// ---------------------------------------------------------------------------
// Type normalisation
//
// drizzle's getSQLType() returns the drizzle-internal type string.
// PostgreSQL information_schema.columns.data_type uses different terminology
// for some of these.  Only map types where a drift mismatch is meaningful
// (i.e. types that can silently differ between an old DB and the current
// schema without being caught until db:push tries to ALTER the column).
// ---------------------------------------------------------------------------
const DRIZZLE_TO_PG: Record<string, string> = {
  integer: "integer",
  serial: "integer", // serial is stored as integer in the DB
  text: "text",
  varchar: "character varying",
  boolean: "boolean",
  timestamp: "timestamp without time zone",
  jsonb: "jsonb",
};

// ---------------------------------------------------------------------------
// Build the expected type map from the drizzle schema
// ---------------------------------------------------------------------------
const expected: Record<string, Record<string, string>> = {};

for (const value of Object.values(schema as Record<string, unknown>)) {
  if (!isTable(value)) continue;
  const tableName = getTableName(value);
  const cols = getTableColumns(value);
  expected[tableName] = {};
  for (const col of Object.values(cols)) {
    const drizzleType = (col as { getSQLType(): string }).getSQLType();
    const pgType = DRIZZLE_TO_PG[drizzleType.toLowerCase()];
    if (pgType !== undefined) {
      expected[tableName][(col as { name: string }).name] = pgType;
    }
  }
}

// ---------------------------------------------------------------------------
// Connect to the live DB and query information_schema.columns
// ---------------------------------------------------------------------------
const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.warn(
    "check-schema-drift: DATABASE_URL / NEON_DATABASE_URL not set — " +
      "skipping live DB type check.",
  );
  process.exit(0);
}

// Configurable connection timeout — defaults to the previous hard-coded
// 10s, but can be tuned via env var without editing this script (e.g. a
// slower network path to the DB, or a CI runner that needs more headroom
// before declaring the host unreachable).
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const rawTimeout = process.env.SCHEMA_DRIFT_CONNECT_TIMEOUT_MS;
const parsedTimeout = rawTimeout ? Number(rawTimeout) : NaN;
const connectionTimeoutMillis =
  Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_CONNECT_TIMEOUT_MS;

if (rawTimeout && !(Number.isFinite(parsedTimeout) && parsedTimeout > 0)) {
  console.warn(
    `check-schema-drift: SCHEMA_DRIFT_CONNECT_TIMEOUT_MS='${rawTimeout}' is not a ` +
      `positive number — falling back to the default ${DEFAULT_CONNECT_TIMEOUT_MS}ms.`,
  );
}

const client = new Client({
  connectionString: dbUrl,
  // Fail loudly within a bounded time instead of hanging forever when the
  // host is unreachable (firewalled/blackholed) rather than actively
  // refusing the connection. Configurable via SCHEMA_DRIFT_CONNECT_TIMEOUT_MS.
  connectionTimeoutMillis,
});

// ---------------------------------------------------------------------------
// Classify a pg/node connection failure into a human-readable failure mode
// so a maintainer debugging a flaky post-merge pipeline can immediately tell
// "connection actively refused" (fast) apart from "timed out" (slow, near
// the configured ceiling) or a DNS/auth failure, instead of having to dig
// through a raw stack trace.
// ---------------------------------------------------------------------------
function classifyConnectionError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  if (code === "ECONNREFUSED") {
    return "CONNECTION REFUSED — the host actively rejected the connection " +
      "(nothing is listening on that host/port, or a firewall reset it " +
      "immediately). This is a fast failure, not a timeout.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "DNS FAILURE — the hostname in DATABASE_URL / NEON_DATABASE_URL " +
      "could not be resolved. Check for typos or an expired/unavailable DNS record.";
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return `CONNECTION TIMED OUT — no response within the ${connectionTimeoutMillis}ms ` +
      "connectionTimeoutMillis ceiling. The host is likely unreachable " +
      "(blackholed/firewalled) rather than actively refusing. Tune the " +
      "ceiling via SCHEMA_DRIFT_CONNECT_TIMEOUT_MS if this is a slow but " +
      "otherwise healthy network path.";
  }
  if (
    code === "28P01" ||
    code === "28000" ||
    /password authentication failed/i.test(message)
  ) {
    return "AUTH FAILURE — the database rejected the provided credentials " +
      "(wrong username/password, or the role lacks CONNECT privilege).";
  }
  return "UNKNOWN FAILURE MODE — see the raw error below for details.";
}

async function main(): Promise<void> {
  try {
    await client.connect();
  } catch (err: unknown) {
    console.error(
      "check-schema-drift: FAILED to connect to the database at the " +
        "configured DATABASE_URL / NEON_DATABASE_URL. Schema drift could " +
        "NOT be verified — refusing to silently pass.\n" +
        "This means DATABASE_URL is set but misconfigured (wrong " +
        "credentials, unreachable host, connection refused, or timeout), " +
        "which is different from DATABASE_URL being unset.\n\n" +
        `Failure mode: ${classifyConnectionError(err)}\n`,
    );
    console.error(err);
    process.exit(1);
    return;
  }

  try {
    const res = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'`,
    );

    const actual: Record<string, Record<string, string>> = {};
    for (const row of res.rows) {
      if (!actual[row.table_name]) actual[row.table_name] = {};
      actual[row.table_name][row.column_name] = row.data_type;
    }

    const mismatches: string[] = [];
    const alterStatements: string[] = [];

    for (const [tableName, cols] of Object.entries(expected)) {
      const dbCols = actual[tableName];
      if (!dbCols) {
        // Table not yet in DB — db:push will create it; no drift possible.
        continue;
      }
      for (const [colName, expectedType] of Object.entries(cols)) {
        const actualType = dbCols[colName];
        if (!actualType) {
          // Column not yet in DB — db:push will add it; no drift possible.
          continue;
        }
        if (actualType !== expectedType) {
          mismatches.push(
            `  ${tableName}.${colName}: DB has '${actualType}', schema expects '${expectedType}'`,
          );
          alterStatements.push(
            `ALTER TABLE ${tableName} ALTER COLUMN ${colName} TYPE ${expectedType} ` +
              `USING ${colName}::${expectedType};`,
          );
        }
      }
    }

    if (mismatches.length > 0) {
      console.error(
        `check-schema-drift: ${mismatches.length} column type mismatch(es) detected:\n`,
      );
      for (const m of mismatches) {
        console.error(m);
      }
      console.error(
        "\nExact ALTER statement(s) needed (wrap each in an idempotent DO $$ … $$ " +
          "block in scripts/db-migrate.sh, guarded by an information_schema check " +
          "so it is safe to run repeatedly):\n",
      );
      for (const stmt of alterStatements) {
        console.error(`  ${stmt}`);
      }
      console.error(
        "\nAdd the statement(s) above to scripts/db-migrate.sh, then re-run " +
          "`npm run db:check-drift` to confirm it passes before attempting db:push.",
      );
      process.exit(1);
    }

    const tableCount = Object.keys(expected).length;
    const colCount = Object.values(expected).reduce(
      (n, cols) => n + Object.keys(cols).length,
      0,
    );
    console.log(
      `check-schema-drift: OK — checked ${colCount} columns across ${tableCount} tables, no type mismatches found.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("check-schema-drift: unexpected error:", err);
  process.exit(1);
});
