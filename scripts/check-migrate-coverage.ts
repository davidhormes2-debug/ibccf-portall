#!/usr/bin/env tsx
/**
 * scripts/check-migrate-coverage.ts
 *
 * Catches the case where `scripts/check-schema-drift.ts` WOULD detect a
 * text-vs-integer/boolean mismatch, but `scripts/db-migrate.sh` has no
 * corresponding USING cast block to fix it.
 *
 * Why this exists:
 *   check-schema-drift.ts reports drift, but fixing it is still a manual,
 *   easy-to-forget step: a developer changes a column's declared type in
 *   shared/schema.ts (e.g. text -> integer) without also appending an
 *   idempotent ALTER TABLE ... USING block to scripts/db-migrate.sh. That
 *   omission is only discovered post-merge, when check-schema-drift.ts (run
 *   AFTER db-migrate.sh) still fails because the live column was never cast.
 *
 * This script closes that gap by cross-referencing, at commit time:
 *   1. Every column in shared/schema.ts declared as `integer`, `serial`, or
 *      `boolean` (the drizzle types that CANNOT be auto-cast from text).
 *   2. The live database's actual column types (information_schema.columns).
 *   3. The USING-cast blocks already present in scripts/db-migrate.sh.
 *
 * For every column where the DB still has `text` but the schema expects
 * integer/boolean, AND no matching cast block exists in db-migrate.sh, this
 * script fails with a message naming the exact `table.column` and the type
 * that needs a cast — rather than only failing generically post-merge.
 *
 * Brand-new tables (not yet present in the live DB) are mostly excluded:
 * db:push *should* create them fresh with the correct type, so no guard is
 * needed in the common case. The one exception mirrors the ADD COLUMN
 * guard below: if db:push silently fails to create the WHOLE table (the
 * same class of failure db-migrate.sh's conventions exist for), a table
 * with integer/boolean column(s) and no db-migrate.sh
 * `CREATE TABLE IF NOT EXISTS <table> (...)` fallback is flagged by name,
 * rather than being silently skipped forever.
 *
 * Brand-new columns on an EXISTING table are a separate, related risk: in
 * theory db:push adds them fresh with the correct type, but in practice
 * db:push can fail or be skipped in some environments (the same reason
 * db-migrate.sh already carries a hand-written "ADD COLUMN IF NOT EXISTS"
 * convention for is_flagged/flag_reason). This script flags any such new
 * column that has no matching `ADD COLUMN IF NOT EXISTS <col> <type>` guard
 * in db-migrate.sh, so that convention doesn't silently bit-rot for columns
 * added after it was introduced.
 *
 * Unlike the text-vs-integer/boolean cast check above, this "new column"
 * check is NOT limited to non-castable types — it covers every column type
 * (text, varchar, timestamp, jsonb, numeric, ...). The cast check is scoped
 * to integer/boolean specifically because those are the only types
 * drizzle-kit cannot safely auto-cast a `text` column into; but a brand-new
 * text/varchar/timestamp/jsonb column on an existing table is just as
 * silently missing if db:push fails or is skipped, and there is no other
 * signal that would catch it. So every column declared in shared/schema.ts
 * is checked for ADD COLUMN coverage, regardless of its type.
 *
 * Usage:
 *   npx tsx scripts/check-migrate-coverage.ts
 *   npm run db:check-migrate-coverage
 *
 * Exit codes:
 *   0 — every text-vs-integer/boolean mismatch already has a db-migrate.sh
 *       cast block (or DATABASE_URL is not set — prints a warning and skips)
 *   1 — one or more mismatches are missing a db-migrate.sh cast block
 *   1 — DATABASE_URL is set but the database could not be reached (auth
 *       failure, connection refused, timeout, DNS failure, etc). A
 *       misconfigured-but-present DATABASE_URL must NOT be treated the same
 *       as "not set" — silently skipping here would give false confidence
 *       that migration coverage was checked in a post-merge environment.
 *       The connection timeout is configurable via
 *       SCHEMA_DRIFT_CONNECT_TIMEOUT_MS (shared with check-schema-drift.ts),
 *       and connection failures are classified the same way (refused / DNS
 *       / timeout / auth) to make a flaky post-merge pipeline easy to
 *       diagnose.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { getTableName, getTableColumns, isTable } from "drizzle-orm";
import * as schema from "../shared/schema";
import {
  hasCastBlock,
  hasCreateTableGuard,
  findAddColumnGuardPrecisionMismatch,
  hasAddColumnGuard
} from "./migrateGuardMatchers";

// ---------------------------------------------------------------------------
// Types that drizzle-kit cannot auto-cast a `text` column into.
// ---------------------------------------------------------------------------
const NON_CASTABLE_TYPES: Record<string, "integer" | "boolean"> = {
  integer: "integer",
  serial: "integer", // serial is stored as integer in the DB
  boolean: "boolean",
};

// ---------------------------------------------------------------------------
// Build the set of ALL columns declared in shared/schema.ts, keyed by table
// and column name, along with their declared SQL type. This covers both
// checks below: the text-vs-integer/boolean cast check (a subset, via
// NON_CASTABLE_TYPES) and the brand-new-column ADD COLUMN guard check
// (every type).
// ---------------------------------------------------------------------------
const allColumns: Record<string, Record<string, string>> = {};

for (const value of Object.values(schema as Record<string, unknown>)) {
  if (!isTable(value)) continue;
  const tableName = getTableName(value);
  const cols = getTableColumns(value);
  for (const col of Object.values(cols)) {
    const drizzleType = (col as { getSQLType(): string })
      .getSQLType()
      .toLowerCase();
    if (!allColumns[tableName]) allColumns[tableName] = {};
    allColumns[tableName][(col as { name: string }).name] = drizzleType;
  }
}

// ---------------------------------------------------------------------------
// Parse scripts/db-migrate.sh for existing USING cast blocks
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATE_SH = path.resolve(__dirname, "db-migrate.sh");

// hasCastBlock / hasAddColumnGuard now live in ./migrateGuardMatchers so they
// can be unit-tested directly against synthetic db-migrate.sh fixtures
// without triggering this script's top-level DB connection / process.exit
// side effects.

// ---------------------------------------------------------------------------
// Connect to the live DB and compare
// ---------------------------------------------------------------------------
const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.warn(
    "check-migrate-coverage: DATABASE_URL / NEON_DATABASE_URL not set — " +
      "skipping live DB migration-coverage check.",
  );
  process.exit(0);
}

if (!fs.existsSync(MIGRATE_SH)) {
  console.error(
    `check-migrate-coverage: scripts/db-migrate.sh not found at ${MIGRATE_SH}`,
  );
  process.exit(1);
}

const migrateSql = fs.readFileSync(MIGRATE_SH, "utf-8");

// Configurable connection timeout — shares SCHEMA_DRIFT_CONNECT_TIMEOUT_MS
// with scripts/check-schema-drift.ts since both scripts connect to the same
// database in the same post-merge sequence and should be tunable together
// (e.g. a slower network path to the DB, or a CI runner that needs more
// headroom before declaring the host unreachable).
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const rawTimeout = process.env.SCHEMA_DRIFT_CONNECT_TIMEOUT_MS;
const parsedTimeout = rawTimeout ? Number(rawTimeout) : NaN;
const connectionTimeoutMillis =
  Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_CONNECT_TIMEOUT_MS;

if (rawTimeout && !(Number.isFinite(parsedTimeout) && parsedTimeout > 0)) {
  console.warn(
    `check-migrate-coverage: SCHEMA_DRIFT_CONNECT_TIMEOUT_MS='${rawTimeout}' is not a ` +
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
// through a raw stack trace. Mirrors classifyConnectionError in
// scripts/check-schema-drift.ts.
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
      "check-migrate-coverage: FAILED to connect to the database at the " +
        "configured DATABASE_URL / NEON_DATABASE_URL. Migration cast " +
        "coverage could NOT be verified — refusing to silently pass.\n" +
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

    const uncovered: string[] = [];
    const precisionWarnings: string[] = [];

    for (const [tableName, cols] of Object.entries(allColumns)) {
      const dbCols = actual[tableName];
      if (!dbCols) {
        // Brand-new table — db:push *should* create it fresh with the
        // correct types, but the same "db:push can fail or be skipped in
        // some environments" risk that motivates the ADD COLUMN IF NOT
        // EXISTS convention applies here too, one level up: if db:push
        // silently fails to create the WHOLE table, every column check
        // above would otherwise never run for it. So a brand-new table
        // that declares any non-castable (integer/boolean/serial) column
        // requires a db-migrate.sh CREATE TABLE IF NOT EXISTS fallback,
        // named explicitly, rather than being silently skipped.
        const hasNonCastableColumn = Object.values(cols).some(
          (sqlType) => NON_CASTABLE_TYPES[sqlType] !== undefined,
        );
        if (hasNonCastableColumn && !hasCreateTableGuard(migrateSql, tableName)) {
          uncovered.push(
            `  ${tableName}: brand-new table (not yet present in the live DB) with ` +
              `integer/boolean column(s), but scripts/db-migrate.sh has no matching ` +
              `'CREATE TABLE IF NOT EXISTS ${tableName} (...)' fallback.`,
          );
        }
        continue;
      }
      for (const [colName, sqlType] of Object.entries(cols)) {
        const castTarget = NON_CASTABLE_TYPES[sqlType];
        const actualType = dbCols[colName];
        if (!actualType) {
          // Brand-new column on an existing table, of ANY declared type
          // (not just integer/boolean — see the file-level comment above).
          // db:push *should* add it fresh with the correct type, but db:push
          // can fail or be skipped in some environments — db-migrate.sh's
          // ADD COLUMN IF NOT EXISTS convention (see is_flagged/flag_reason)
          // exists for exactly this scenario, so require a matching guard
          // regardless of the column's type.
          const guardType = castTarget ?? sqlType;
          if (!hasAddColumnGuard(migrateSql, tableName, colName, guardType)) {
            uncovered.push(
              `  ${tableName}.${colName}: new '${guardType}' column not yet present in the ` +
                `live DB, but scripts/db-migrate.sh has no matching ADD COLUMN IF NOT EXISTS guard.`,
            );
          } else {
            // A matching guard exists — but hasAddColumnGuard only compares
            // base type names (e.g. "varchar(50)" and "varchar(255)" both
            // satisfy a guard written as "varchar"). If the guard DOES
            // specify a length/precision modifier and it disagrees with the
            // schema's, that's a real (if lower-severity) bug worth
            // surfacing as a warning rather than silently passing.
            const mismatch = findAddColumnGuardPrecisionMismatch(
              migrateSql,
              tableName,
              colName,
              guardType,
            );
            if (mismatch) {
              precisionWarnings.push(
                `  ${tableName}.${colName}: schema declares '${mismatch.schemaType}' but ` +
                  `scripts/db-migrate.sh's ADD COLUMN IF NOT EXISTS guard uses '${mismatch.guardType}' ` +
                  `— length/precision mismatch.`,
              );
            }
          }
          continue;
        }
        if (!castTarget) {
          // Not one of the non-castable types (integer/boolean/serial) — the
          // text-vs-target cast check below only applies to those; any other
          // drift is scripts/check-schema-drift.ts's concern.
          continue;
        }
        if (actualType !== "text") {
          // Already the right type (or some other unrelated type) — not our
          // concern here; scripts/check-schema-drift.ts covers general drift.
          continue;
        }
        if (!hasCastBlock(migrateSql, tableName, colName, castTarget)) {
          uncovered.push(
            `  ${tableName}.${colName}: DB has 'text', schema expects '${castTarget}', ` +
              `but scripts/db-migrate.sh has no matching USING cast block.`,
          );
        }
      }
    }

    if (uncovered.length > 0) {
      console.error(
        `check-migrate-coverage: ${uncovered.length} column(s) need a db-migrate.sh guard:\n`,
      );
      for (const line of uncovered) {
        console.error(line);
      }
      console.error(
        "\nFor a 'text' column that needs to become integer/boolean, add an " +
          "idempotent ALTER TABLE … TYPE … USING block to scripts/db-migrate.sh. " +
          "For a brand-new column on an existing table (of any type — text, " +
          "integer, boolean, varchar, timestamp, jsonb, ...), add an idempotent " +
          "'ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> <type>' guard " +
          "instead. For a brand-new TABLE with integer/boolean column(s), add an " +
          "idempotent 'CREATE TABLE IF NOT EXISTS <table> (...)' fallback " +
          "(matching the shared/schema.ts column list) to scripts/db-migrate.sh. " +
          "Then re-run `npm run db:check-migrate-coverage` to confirm it passes.\n\n" +
          "IMPORTANT — a db-migrate.sh guard alone is NOT enough to make the next " +
          "Publish succeed: scripts/db-migrate.sh only ever runs against the " +
          "DEVELOPMENT database (via scripts/post-merge.sh after a merge). " +
          "Replit's Publish flow auto-diffs shared/schema.ts against PRODUCTION " +
          "and generates a plain ALTER TABLE with no USING clause, which fails " +
          "outright on the exact same cast. Before the next Publish, run " +
          "`npm run db:check-drift:production` (read-only) to see whether " +
          "production has this drift, and if so apply the matching cast " +
          "manually via Replit's production database console — see the " +
          "'Before you Publish' checklist in replit.md. Do NOT write or run a " +
          "script that executes DDL directly against production.",
      );
      process.exit(1);
    }

    if (precisionWarnings.length > 0) {
      console.warn(
        `check-migrate-coverage: WARNING — ${precisionWarnings.length} ADD COLUMN ` +
          "guard(s) specify a length/precision that does not match shared/schema.ts:\n",
      );
      for (const line of precisionWarnings) {
        console.warn(line);
      }
      console.warn(
        "\nThis is a warning, not a failure — the guard IS present (so " +
          "check-migrate-coverage still passes), but a shorter/longer length " +
          "than the schema declares can silently truncate data or diverge from " +
          "what shared/schema.ts (and drizzle's runtime validation) expects. " +
          "Double-check the ADD COLUMN IF NOT EXISTS statement in " +
          "scripts/db-migrate.sh matches the schema's length/precision exactly, " +
          "or intentionally use a bare type (e.g. 'varchar' with no length) to " +
          "avoid this check. Note: once the column reaches production, " +
          "scripts/check-schema-drift.ts may independently catch a live-DB " +
          "length mismatch too.",
      );
    }

    console.log(
      "check-migrate-coverage: OK — every text-vs-integer/boolean column already " +
        "has a matching db-migrate.sh cast block, every new column (of any " +
        "type) on an existing table has a matching ADD COLUMN IF NOT EXISTS guard, " +
        "and every brand-new table with integer/boolean columns has a matching " +
        "CREATE TABLE IF NOT EXISTS fallback.\n" +
        "Reminder: those guards only reach the DEVELOPMENT database via " +
        "post-merge. If shared/schema.ts changed a column's type or is " +
        "otherwise expected to trigger a schema diff, run " +
        "`npm run db:check-drift:production` and follow the 'Before you " +
        "Publish' checklist in replit.md before clicking Publish.",
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("check-migrate-coverage: unexpected error:", err);
  process.exit(1);
});
