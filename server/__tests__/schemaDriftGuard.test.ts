import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { getTableName, getTableColumns, isTable } from "drizzle-orm";
import * as schema from "../../shared/schema";
import {
  hasCastBlock,
  hasAddColumnGuard,
  hasCreateTableGuard,
  findAddColumnGuardPrecisionMismatch,
} from "../../scripts/migrateGuardMatchers";

// ============================================================================
// Schema Drift Guard
//
// WHY THIS TEST EXISTS
// drizzle-kit `db:push` cannot automatically cast text → integer.  When a
// column is created as `text` in the DB but the schema defines it as
// `integer`, every subsequent `db:push` crashes, silently blocking schema
// migrations until someone notices and fixes it manually.
//
// This happened with `community_threads.view_count` and `reply_count`: both
// columns lived in the DB as `text` while `shared/schema.ts` declared them as
// `integer`, which caused `db:push` to error with:
//   "column 'view_count' cannot be cast automatically to type integer"
//
// The fix is `scripts/db-migrate.sh`, which applies an explicit USING cast
// before `db:push` runs.  This test asserts that the migration script:
//   1. Exists and is non-empty.
//   2. Contains an idempotent type-cast block for view_count.
//   3. Contains an idempotent type-cast block for reply_count.
//   4. Contains ADD COLUMN IF NOT EXISTS guards for is_flagged / flag_reason
//      on both community_threads and community_posts.
//   5. Is referenced in scripts/post-merge.sh so it runs automatically after
//      every merge.
//
// To catch NEW drift before it can ever block db:push, a separate live script
// (`scripts/check-schema-drift.ts`) parses the drizzle schema via
// drizzle-orm introspection and cross-checks every column's declared type
// against information_schema.columns in the live database.  The assertions
// below (group 2) verify this script exists, is wired into post-merge.sh
// before db:push, and contains the key logic proofs.
//
// This is a static source-assertion test — no DB connection needed.
// ============================================================================

const MIGRATE_SH = path.resolve(
  __dirname,
  "../../scripts/db-migrate.sh",
);
const POST_MERGE_SH = path.resolve(
  __dirname,
  "../../scripts/post-merge.sh",
);
const CHECK_DRIFT_TS = path.resolve(
  __dirname,
  "../../scripts/check-schema-drift.ts",
);
const CHECK_MIGRATE_COVERAGE_TS = path.resolve(
  __dirname,
  "../../scripts/check-migrate-coverage.ts",
);

describe("Schema Drift Guard — scripts/db-migrate.sh", () => {
  it("scripts/db-migrate.sh exists and is non-empty", () => {
    expect(
      fs.existsSync(MIGRATE_SH),
      "scripts/db-migrate.sh must exist. Create it with idempotent ALTER TABLE " +
        "migrations to fix any column-type drift that drizzle-kit cannot auto-cast.",
    ).toBe(true);

    const content = fs.readFileSync(MIGRATE_SH, "utf-8").trim();
    expect(
      content.length,
      "scripts/db-migrate.sh must not be empty.",
    ).toBeGreaterThan(0);
  });

  it("db-migrate.sh casts community_threads.view_count from text to integer", () => {
    const content = fs.readFileSync(MIGRATE_SH, "utf-8");

    expect(
      content,
      "scripts/db-migrate.sh must contain an ALTER COLUMN view_count TYPE integer " +
        "statement for community_threads.  This cast fixes the text→integer drift " +
        "that breaks db:push.",
    ).toMatch(/ALTER.*view_count.*TYPE\s+integer/s);

    expect(
      content,
      "The view_count cast must use USING view_count::integer so existing text " +
        "values are coerced rather than failing the cast.",
    ).toMatch(/USING\s+view_count::integer/);
  });

  it("db-migrate.sh casts community_threads.reply_count from text to integer", () => {
    const content = fs.readFileSync(MIGRATE_SH, "utf-8");

    expect(
      content,
      "scripts/db-migrate.sh must contain an ALTER COLUMN reply_count TYPE integer " +
        "statement for community_threads.",
    ).toMatch(/ALTER.*reply_count.*TYPE\s+integer/s);

    expect(
      content,
      "The reply_count cast must use USING reply_count::integer.",
    ).toMatch(/USING\s+reply_count::integer/);
  });

  it("db-migrate.sh has ADD COLUMN IF NOT EXISTS guard for community_threads.is_flagged", () => {
    const content = fs.readFileSync(MIGRATE_SH, "utf-8");

    expect(
      content,
      "scripts/db-migrate.sh must contain ADD COLUMN IF NOT EXISTS is_flagged for " +
        "community_threads so the column is always present even when db:push was " +
        "previously skipped.",
    ).toMatch(/community_threads.*ADD COLUMN IF NOT EXISTS.*is_flagged/s);
  });

  it("db-migrate.sh has ADD COLUMN IF NOT EXISTS guard for community_posts.is_flagged", () => {
    const content = fs.readFileSync(MIGRATE_SH, "utf-8");

    expect(
      content,
      "scripts/db-migrate.sh must contain ADD COLUMN IF NOT EXISTS is_flagged for " +
        "community_posts.",
    ).toMatch(/community_posts.*ADD COLUMN IF NOT EXISTS.*is_flagged/s);
  });

  it("db-migrate.sh has ADD COLUMN IF NOT EXISTS guard for community_threads.flag_reason", () => {
    const content = fs.readFileSync(MIGRATE_SH, "utf-8");

    expect(
      content,
      "scripts/db-migrate.sh must contain ADD COLUMN IF NOT EXISTS flag_reason for " +
        "community_threads so the moderation reason column is always present.",
    ).toMatch(/community_threads.*ADD COLUMN IF NOT EXISTS.*flag_reason/s);
  });

  it("db-migrate.sh has ADD COLUMN IF NOT EXISTS guard for community_posts.flag_reason", () => {
    const content = fs.readFileSync(MIGRATE_SH, "utf-8");

    expect(
      content,
      "scripts/db-migrate.sh must contain ADD COLUMN IF NOT EXISTS flag_reason for " +
        "community_posts.",
    ).toMatch(/community_posts.*ADD COLUMN IF NOT EXISTS.*flag_reason/s);
  });

  it("post-merge.sh invokes db-migrate.sh before db:push", () => {
    expect(
      fs.existsSync(POST_MERGE_SH),
      "scripts/post-merge.sh must exist.",
    ).toBe(true);

    const content = fs.readFileSync(POST_MERGE_SH, "utf-8");

    expect(
      content,
      "scripts/post-merge.sh must call db-migrate.sh (e.g. 'bash scripts/db-migrate.sh') " +
        "so idempotent migrations run automatically after every merge.",
    ).toMatch(/db-migrate\.sh/);

    const migrateIdx = content.indexOf("db-migrate.sh");
    const pushIdx = content.indexOf("db:push");

    expect(
      migrateIdx,
      "db-migrate.sh must appear before db:push in post-merge.sh so migrations " +
        "are applied before drizzle-kit tries to push the schema.",
    ).toBeLessThan(pushIdx);
  });
});

describe("Schema Drift Guard — scripts/check-schema-drift.ts", () => {
  it("scripts/check-schema-drift.ts exists and is non-empty", () => {
    expect(
      fs.existsSync(CHECK_DRIFT_TS),
      "scripts/check-schema-drift.ts must exist. It queries information_schema.columns " +
        "and cross-checks against the drizzle schema to catch text-vs-integer (and other) " +
        "column type mismatches before db:push is attempted.",
    ).toBe(true);

    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8").trim();
    expect(
      content.length,
      "scripts/check-schema-drift.ts must not be empty.",
    ).toBeGreaterThan(0);
  });

  it("check-schema-drift.ts queries information_schema.columns", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "scripts/check-schema-drift.ts must query information_schema.columns to " +
        "obtain the live column types from the database.",
    ).toMatch(/information_schema\.columns/);
  });

  it("check-schema-drift.ts uses drizzle getTableColumns for schema introspection", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "scripts/check-schema-drift.ts must import and use getTableColumns from " +
        "drizzle-orm so it derives expected types directly from the schema " +
        "declarations rather than a hand-maintained list.",
    ).toMatch(/getTableColumns/);
  });

  it("check-schema-drift.ts maps drizzle serial to postgres integer type", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "check-schema-drift.ts must map the drizzle 'serial' type to 'integer' " +
        "because PostgreSQL stores serial columns as integer in information_schema.",
    ).toMatch(/serial.*integer/s);
  });

  it("check-schema-drift.ts exits non-zero when mismatches are found", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "check-schema-drift.ts must call process.exit(1) when mismatches are detected " +
        "so the post-merge pipeline aborts before db:push is attempted.",
    ).toMatch(/process\.exit\(1\)/);
  });

  it("check-schema-drift.ts wraps client.connect() in a try/catch that exits non-zero", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "check-schema-drift.ts must catch client.connect() failures explicitly " +
        "(auth failure, connection refused, timeout, DNS failure) and exit " +
        "non-zero, rather than treating a set-but-unreachable DATABASE_URL " +
        "the same as an unset one.",
    ).toMatch(/catch[\s\S]*?FAILED to connect[\s\S]*?process\.exit\(1\)/);
  });

  it("check-schema-drift.ts sets a bounded connectionTimeoutMillis", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "check-schema-drift.ts must set connectionTimeoutMillis on the pg " +
        "Client so an unreachable (blackholed) host fails loudly within a " +
        "bounded time instead of hanging the post-merge pipeline forever.",
    ).toMatch(/connectionTimeoutMillis/);
  });

  it("DATABASE_URL set but connection refused: script exits non-zero with a clear message", () => {
    const result = spawnSync("npx", ["tsx", CHECK_DRIFT_TS], {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://user:pass@127.0.0.1:1/nonexistent",
      },
      timeout: 15_000,
    });
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(
      result.status,
      "check-schema-drift.ts must exit non-zero when DATABASE_URL is set " +
        "but the database connection is refused — a misconfigured URL must " +
        "never be treated the same as a gracefully-skipped unset URL.",
    ).not.toBe(0);

    expect(
      combined,
      "check-schema-drift.ts must print a clear, loud failure message " +
        "distinguishing a failed connection from an unset DATABASE_URL.",
    ).toMatch(/FAILED to connect/);
  }, 20_000);

  it("DATABASE_URL unset: script still exits 0 (graceful skip preserved)", () => {
    const env = { ...process.env };
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    delete (env as Record<string, string | undefined>).NEON_DATABASE_URL;

    const result = spawnSync("npx", ["tsx", CHECK_DRIFT_TS], {
      encoding: "utf-8",
      env,
      timeout: 15_000,
    });
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(
      result.status,
      "check-schema-drift.ts must still exit 0 when DATABASE_URL / " +
        "NEON_DATABASE_URL are absent — this is the intentional graceful " +
        "skip for environments (like CI unit tests) with no database.",
    ).toBe(0);

    expect(combined).toMatch(/not set — skipping/);
  }, 20_000);

  it("check-schema-drift.ts reads a configurable connect timeout from SCHEMA_DRIFT_CONNECT_TIMEOUT_MS", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "check-schema-drift.ts must read SCHEMA_DRIFT_CONNECT_TIMEOUT_MS from " +
        "process.env so the connection timeout can be tuned without editing " +
        "the script.",
    ).toMatch(/SCHEMA_DRIFT_CONNECT_TIMEOUT_MS/);

    expect(
      content,
      "check-schema-drift.ts must keep 10000ms (10_000) as the default " +
        "connectionTimeoutMillis when SCHEMA_DRIFT_CONNECT_TIMEOUT_MS is unset.",
    ).toMatch(/10_000/);
  });

  it("check-schema-drift.ts classifies connection failures into distinct failure modes", () => {
    const content = fs.readFileSync(CHECK_DRIFT_TS, "utf-8");

    expect(
      content,
      "check-schema-drift.ts must distinguish a refused connection from a " +
        "timeout so a maintainer can tell 'fast rejection' apart from 'slow, " +
        "near the timeout ceiling'.",
    ).toMatch(/ECONNREFUSED/);

    expect(content, "must detect timeouts (ETIMEDOUT or message text).").toMatch(
      /ETIMEDOUT/,
    );

    expect(
      content,
      "must detect DNS resolution failures (ENOTFOUND/EAI_AGAIN).",
    ).toMatch(/ENOTFOUND/);

    expect(
      content,
      "must detect auth failures (pg code 28P01/28000 or the standard message).",
    ).toMatch(/28P01/);
  });

  it("connection refused with a custom SCHEMA_DRIFT_CONNECT_TIMEOUT_MS still fails fast and reports the refused failure mode", () => {
    const result = spawnSync("npx", ["tsx", CHECK_DRIFT_TS], {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://user:pass@127.0.0.1:1/nonexistent",
        SCHEMA_DRIFT_CONNECT_TIMEOUT_MS: "2000",
      },
      timeout: 15_000,
    });
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(
      result.status,
      "must still exit non-zero when a custom timeout is supplied via env var.",
    ).not.toBe(0);

    expect(
      combined,
      "a refused connection must be classified as CONNECTION REFUSED, not a timeout.",
    ).toMatch(/CONNECTION REFUSED/);
  }, 20_000);

  it("post-merge.sh invokes check-schema-drift.ts before db:push", () => {
    const content = fs.readFileSync(POST_MERGE_SH, "utf-8");

    expect(
      content,
      "scripts/post-merge.sh must invoke check-schema-drift.ts (e.g. via " +
        "'npx tsx scripts/check-schema-drift.ts') before db:push so that any " +
        "new text-vs-integer drift is caught before drizzle-kit errors.",
    ).toMatch(/check-schema-drift/);

    const driftIdx = content.indexOf("check-schema-drift");
    const pushIdx = content.indexOf("db:push");

    expect(
      driftIdx,
      "check-schema-drift must appear before db:push in post-merge.sh.",
    ).toBeLessThan(pushIdx);
  });
});

describe("Schema Drift Guard — scripts/check-migrate-coverage.ts", () => {
  it("scripts/check-migrate-coverage.ts exists and is non-empty", () => {
    expect(
      fs.existsSync(CHECK_MIGRATE_COVERAGE_TS),
      "scripts/check-migrate-coverage.ts must exist. It cross-references " +
        "check-schema-drift.ts-style mismatches against scripts/db-migrate.sh " +
        "so a missing USING cast block is caught before it can silently block " +
        "db:push post-merge.",
    ).toBe(true);

    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8").trim();
    expect(
      content.length,
      "scripts/check-migrate-coverage.ts must not be empty.",
    ).toBeGreaterThan(0);
  });

  it("check-migrate-coverage.ts uses drizzle getTableColumns for schema introspection", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must import and use getTableColumns " +
        "from drizzle-orm so the integer/boolean column list is derived from " +
        "the schema declarations, not a hand-maintained list.",
    ).toMatch(/getTableColumns/);
  });

  it("check-migrate-coverage.ts queries information_schema.columns for live DB types", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must query information_schema.columns " +
        "to know each column's actual live type before deciding a cast block is needed.",
    ).toMatch(/information_schema\.columns/);
  });

  it("check-migrate-coverage.ts reads scripts/db-migrate.sh to look for existing cast blocks", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must read scripts/db-migrate.sh " +
        "(e.g. via readFileSync(MIGRATE_SH, ...)) so it can check whether a " +
        "USING cast block already exists for each flagged column.",
    ).toMatch(/db-migrate\.sh/);

    expect(
      content,
      "scripts/check-migrate-coverage.ts must search for a USING cast pattern " +
        "when deciding whether a column is already covered.",
    ).toMatch(/USING/);
  });

  it("check-migrate-coverage.ts excludes brand-new tables and columns not yet in the DB", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must skip tables that do not yet exist " +
        "in the live DB (db:push creates them fresh with the correct type, so no " +
        "cast is needed).",
    ).toMatch(/[Bb]rand-new table/);

    expect(
      content,
      "scripts/check-migrate-coverage.ts must skip columns that do not yet exist " +
        "on an existing DB table (db:push adds them fresh with the correct type).",
    ).toMatch(/[Bb]rand-new column/);
  });

  it("check-migrate-coverage.ts fails with a message naming the specific table.column and type", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must build an error message that " +
        "interpolates the table name, column name, and target type so the " +
        "developer knows exactly which column needs a db-migrate.sh cast block.",
    ).toMatch(/\$\{tableName\}\.\$\{colName\}/);

    expect(
      content,
      "scripts/check-migrate-coverage.ts must exit non-zero when a column is " +
        "missing its db-migrate.sh cast block coverage.",
    ).toMatch(/process\.exit\(1\)/);
  });

  it("post-merge.sh invokes check-migrate-coverage.ts before db:push", () => {
    const content = fs.readFileSync(POST_MERGE_SH, "utf-8");

    expect(
      content,
      "scripts/post-merge.sh must invoke check-migrate-coverage.ts (e.g. via " +
        "'npx tsx scripts/check-migrate-coverage.ts') so a missing db-migrate.sh " +
        "cast block is caught before db:push runs.",
    ).toMatch(/check-migrate-coverage/);

    const coverageIdx = content.indexOf("check-migrate-coverage");
    const pushIdx = content.indexOf("db:push");

    expect(
      coverageIdx,
      "check-migrate-coverage must appear before db:push in post-merge.sh.",
    ).toBeLessThan(pushIdx);
  });

  it("check-migrate-coverage.ts defines (or imports) a hasAddColumnGuard helper for brand-new integer/boolean columns", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must define or import a " +
        "hasAddColumnGuard function that scans scripts/db-migrate.sh for an " +
        "existing 'ADD COLUMN IF NOT EXISTS <col> <type>' guard, mirroring " +
        "hasCastBlock for the text-vs-integer/boolean cast case.",
    ).toMatch(/function\s+hasAddColumnGuard|hasAddColumnGuard\s*}?\s*from/);

    const MATCHERS_TS = path.resolve(
      __dirname,
      "../../scripts/migrateGuardMatchers.ts",
    );
    const matchersContent = fs.readFileSync(MATCHERS_TS, "utf-8");
    expect(
      matchersContent,
      "hasAddColumnGuard must search for the literal 'ADD COLUMN IF NOT EXISTS' " +
        "convention already used in scripts/db-migrate.sh.",
    ).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  it("check-migrate-coverage.ts flags brand-new integer/boolean columns missing an ADD COLUMN guard, instead of silently skipping them", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must call hasAddColumnGuard when a " +
        "column does not yet exist in the live DB (i.e. !actualType), so a " +
        "brand-new integer/boolean column on an existing table without a " +
        "db-migrate.sh ADD COLUMN IF NOT EXISTS guard is reported, not silently " +
        "skipped. db:push can fail or be skipped in some environments, so this " +
        "convention must not bit-rot.",
    ).toMatch(/!actualType[\s\S]*?hasAddColumnGuard\(/);

    expect(
      content,
      "check-migrate-coverage.ts must still exclude brand-new tables entirely " +
        "(db:push creates the whole table fresh with correct types).",
    ).toMatch(/[Bb]rand-new table/);
  });

  it("check-migrate-coverage.ts names the specific table.column when an ADD COLUMN guard is missing", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "The uncovered-column message for a missing ADD COLUMN IF NOT EXISTS " +
        "guard must interpolate the table and column name so a developer knows " +
        "exactly which column to add a guard for.",
    ).toMatch(/no matching ADD COLUMN IF NOT EXISTS guard/);
  });

  it("check-migrate-coverage.ts defines (or imports) a hasCreateTableGuard helper and flags brand-new tables with integer/boolean columns", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "scripts/check-migrate-coverage.ts must define or import a " +
        "hasCreateTableGuard function that scans scripts/db-migrate.sh for " +
        "an existing 'CREATE TABLE IF NOT EXISTS <table>' fallback, mirroring " +
        "hasAddColumnGuard for the brand-new-table case.",
    ).toMatch(/hasCreateTableGuard/);

    const MATCHERS_TS = path.resolve(
      __dirname,
      "../../scripts/migrateGuardMatchers.ts",
    );
    const matchersContent = fs.readFileSync(MATCHERS_TS, "utf-8");
    expect(
      matchersContent,
      "hasCreateTableGuard must search for the literal " +
        "'CREATE TABLE IF NOT EXISTS' convention.",
    ).toMatch(/CREATE TABLE IF NOT EXISTS/);

    expect(
      content,
      "check-migrate-coverage.ts must name the exact table when a brand-new " +
        "table with integer/boolean columns is missing a CREATE TABLE guard.",
    ).toMatch(/brand-new table \(not yet present in the live DB\) with/);
  });

  it("package.json exposes a db:check-migrate-coverage script", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };

    expect(
      pkg.scripts?.["db:check-migrate-coverage"],
      "package.json must define a 'db:check-migrate-coverage' script that " +
        "runs scripts/check-migrate-coverage.ts.",
    ).toMatch(/check-migrate-coverage\.ts/);
  });

  it("check-migrate-coverage.ts wraps client.connect() in a try/catch that exits non-zero", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "check-migrate-coverage.ts must catch client.connect() failures " +
        "explicitly (auth failure, connection refused, timeout, DNS " +
        "failure) and exit non-zero, rather than treating a " +
        "set-but-unreachable DATABASE_URL the same as an unset one.",
    ).toMatch(/catch[\s\S]*?FAILED to connect[\s\S]*?process\.exit\(1\)/);
  });

  it("check-migrate-coverage.ts sets a bounded connectionTimeoutMillis", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "check-migrate-coverage.ts must set connectionTimeoutMillis on the " +
        "pg Client so an unreachable (blackholed) host fails loudly within " +
        "a bounded time instead of hanging the post-merge pipeline forever.",
    ).toMatch(/connectionTimeoutMillis/);
  });

  it("check-migrate-coverage.ts reads a configurable connect timeout from SCHEMA_DRIFT_CONNECT_TIMEOUT_MS", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "check-migrate-coverage.ts must read SCHEMA_DRIFT_CONNECT_TIMEOUT_MS " +
        "(shared with check-schema-drift.ts) from process.env so the " +
        "connection timeout can be tuned without editing the script.",
    ).toMatch(/SCHEMA_DRIFT_CONNECT_TIMEOUT_MS/);

    expect(
      content,
      "check-migrate-coverage.ts must keep 10000ms (10_000) as the default " +
        "connectionTimeoutMillis when SCHEMA_DRIFT_CONNECT_TIMEOUT_MS is unset.",
    ).toMatch(/10_000/);
  });

  it("check-migrate-coverage.ts classifies connection failures into distinct failure modes", () => {
    const content = fs.readFileSync(CHECK_MIGRATE_COVERAGE_TS, "utf-8");

    expect(
      content,
      "check-migrate-coverage.ts must distinguish a refused connection from " +
        "a timeout so a maintainer can tell 'fast rejection' apart from " +
        "'slow, near the timeout ceiling'.",
    ).toMatch(/ECONNREFUSED/);

    expect(content, "must detect timeouts (ETIMEDOUT or message text).").toMatch(
      /ETIMEDOUT/,
    );

    expect(
      content,
      "must detect DNS resolution failures (ENOTFOUND/EAI_AGAIN).",
    ).toMatch(/ENOTFOUND/);

    expect(
      content,
      "must detect auth failures (pg code 28P01/28000 or the standard message).",
    ).toMatch(/28P01/);
  });

  it("DATABASE_URL set but connection refused: check-migrate-coverage.ts exits non-zero with a clear message", () => {
    const result = spawnSync("npx", ["tsx", CHECK_MIGRATE_COVERAGE_TS], {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://user:pass@127.0.0.1:1/nonexistent",
      },
      timeout: 15_000,
    });
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(
      result.status,
      "check-migrate-coverage.ts must exit non-zero when DATABASE_URL is " +
        "set but the database connection is refused — a misconfigured URL " +
        "must never be treated the same as a gracefully-skipped unset URL.",
    ).not.toBe(0);

    expect(
      combined,
      "check-migrate-coverage.ts must print a clear, loud failure message " +
        "distinguishing a failed connection from an unset DATABASE_URL.",
    ).toMatch(/FAILED to connect/);
  }, 20_000);

  it("connection refused with a custom SCHEMA_DRIFT_CONNECT_TIMEOUT_MS still fails fast and reports the refused failure mode (check-migrate-coverage.ts)", () => {
    const result = spawnSync("npx", ["tsx", CHECK_MIGRATE_COVERAGE_TS], {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://user:pass@127.0.0.1:1/nonexistent",
        SCHEMA_DRIFT_CONNECT_TIMEOUT_MS: "2000",
      },
      timeout: 15_000,
    });
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(
      result.status,
      "must still exit non-zero when a custom timeout is supplied via env var.",
    ).not.toBe(0);

    expect(
      combined,
      "a refused connection must be classified as CONNECTION REFUSED, not a timeout.",
    ).toMatch(/CONNECTION REFUSED/);
  }, 20_000);
});

// ============================================================================
// Runtime behavior of scripts/check-migrate-coverage.ts
//
// The static assertions above only check that the script *contains* the
// right logic patterns. These tests exercise the script's actual runtime
// behavior end-to-end by mocking the `pg` Client (so no live database is
// needed) and controlling the contents of db-migrate.sh, then dynamically
// importing the module fresh for each scenario:
//   1. A column that is `text` in the (mocked) DB but `integer` in the
//      schema, with NO matching cast block in db-migrate.sh -> the script
//      must exit non-zero and name the exact `table.column`.
//   2. The same drifted column, but WITH a matching cast block present ->
//      the script must report success and must not exit non-zero.
//
// community_threads.view_count is used as the target column because it is
// already declared as `integer` in shared/schema.ts (see group 1 above), so
// no schema changes are required to exercise this.
// ============================================================================
// Fixture-based tests for the matching logic itself
//
// The suites above only assert that scripts/check-migrate-coverage.ts
// *contains* certain source patterns, or exercise it end-to-end against the
// real, current db-migrate.sh. Neither would catch a subtle regex bug in
// hasCastBlock / hasAddColumnGuard that started silently matching (or
// failing to match) the wrong table/column/type — e.g. matching a guard
// written for a different table just because the column name happens to
// appear nearby.
//
// These tests import hasCastBlock / hasAddColumnGuard directly from
// scripts/migrateGuardMatchers.ts and run them against small synthetic
// db-migrate.sh snippets, independent of the real file's contents.
// ============================================================================
describe("Schema Drift Guard — hasCastBlock matcher (fixture-based)", () => {
  it("returns true for a correct cast block (right table, right column, right type)", () => {
    const snippet =
      "DO $$ BEGIN\n" +
      "  ALTER TABLE community_threads ALTER COLUMN view_count TYPE integer USING view_count::integer;\n" +
      "END $$;\n";

    expect(
      hasCastBlock(snippet, "community_threads", "view_count", "integer"),
    ).toBe(true);
  });

  it("returns false when the cast block is for a different table", () => {
    const snippet =
      "DO $$ BEGIN\n" +
      "  ALTER TABLE community_posts ALTER COLUMN view_count TYPE integer USING view_count::integer;\n" +
      "END $$;\n";

    expect(
      hasCastBlock(snippet, "community_threads", "view_count", "integer"),
    ).toBe(false);
  });

  it("returns false when the cast block targets the wrong type", () => {
    const snippet =
      "DO $$ BEGIN\n" +
      "  ALTER TABLE community_threads ALTER COLUMN view_count TYPE boolean USING view_count::boolean;\n" +
      "END $$;\n";

    expect(
      hasCastBlock(snippet, "community_threads", "view_count", "integer"),
    ).toBe(false);
  });

  it("returns false when there is no cast block at all", () => {
    const snippet = "# db-migrate.sh with no cast blocks at all\n";

    expect(
      hasCastBlock(snippet, "community_threads", "view_count", "integer"),
    ).toBe(false);
  });

  it("returns false when the column is mentioned but TYPE/USING clauses are missing (malformed statement)", () => {
    const snippet =
      "DO $$ BEGIN\n" +
      "  -- TODO: cast community_threads.view_count to integer\n" +
      "END $$;\n";

    expect(
      hasCastBlock(snippet, "community_threads", "view_count", "integer"),
    ).toBe(false);
  });
});

describe("Schema Drift Guard — hasAddColumnGuard matcher (fixture-based)", () => {
  it("returns true for a correct ADD COLUMN IF NOT EXISTS guard (right table, right column, right type)", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS is_flagged boolean DEFAULT false;"\n';

    expect(
      hasAddColumnGuard(snippet, "community_threads", "is_flagged", "boolean"),
    ).toBe(true);
  });

  it("returns false when the ADD COLUMN guard is for a different table", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_flagged boolean DEFAULT false;"\n';

    expect(
      hasAddColumnGuard(snippet, "community_threads", "is_flagged", "boolean"),
    ).toBe(false);
  });

  it("returns false when the ADD COLUMN guard targets the wrong type", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS is_flagged integer DEFAULT 0;"\n';

    expect(
      hasAddColumnGuard(snippet, "community_threads", "is_flagged", "boolean"),
    ).toBe(false);
  });

  it("returns false when there is no ADD COLUMN guard at all", () => {
    const snippet = "# db-migrate.sh with no ADD COLUMN guards at all\n";

    expect(
      hasAddColumnGuard(snippet, "community_threads", "is_flagged", "boolean"),
    ).toBe(false);
  });

  it("returns false for a malformed statement missing the IF NOT EXISTS clause", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN is_flagged boolean DEFAULT false;"\n';

    expect(
      hasAddColumnGuard(snippet, "community_threads", "is_flagged", "boolean"),
    ).toBe(false);
  });

  // Non-integer/boolean types: the ADD COLUMN guard check must not be
  // limited to the two "non-castable" types. A brand-new text/varchar/
  // timestamp/jsonb column on an existing table is just as silently missing
  // if db:push fails, so hasAddColumnGuard must work generically for any
  // declared type.
  it("returns true for a correct ADD COLUMN IF NOT EXISTS guard for a 'text' column", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS flag_reason text;"\n';

    expect(
      hasAddColumnGuard(snippet, "community_threads", "flag_reason", "text"),
    ).toBe(true);
  });

  it("returns true for a correct ADD COLUMN IF NOT EXISTS guard for a 'timestamp' column", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS last_activity_at timestamp NOT NULL DEFAULT now();"\n';

    expect(
      hasAddColumnGuard(
        snippet,
        "community_threads",
        "last_activity_at",
        "timestamp",
      ),
    ).toBe(true);
  });

  it("matches a 'varchar(255)' target type against a bare 'varchar' guard (length modifiers ignored)", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS author_handle varchar;"\n';

    expect(
      hasAddColumnGuard(
        snippet,
        "community_threads",
        "author_handle",
        "varchar(255)",
      ),
    ).toBe(true);
  });

  it("returns false when no ADD COLUMN guard exists for a non-integer/boolean column", () => {
    const snippet = "# db-migrate.sh with no ADD COLUMN guards at all\n";

    expect(
      hasAddColumnGuard(snippet, "community_threads", "flag_reason", "text"),
    ).toBe(false);
  });
});

// ============================================================================
// findAddColumnGuardPrecisionMismatch — flags a mismatched length/precision
// modifier on an otherwise-valid ADD COLUMN IF NOT EXISTS guard (Task #2432).
// hasAddColumnGuard() only compares base type names, so it treats
// "varchar(50)" and "varchar(255)" as equivalent — this helper is the
// separate, softer signal that catches when the guard's modifier disagrees
// with shared/schema.ts.
// ============================================================================
describe("Schema Drift Guard — findAddColumnGuardPrecisionMismatch matcher (fixture-based)", () => {
  it("returns a mismatch when the guard's varchar length differs from the schema's", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS author_handle varchar(50);"\n';

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "community_threads",
        "author_handle",
        "varchar(255)",
      ),
    ).toEqual({
      schemaType: "varchar(255)",
      guardType: "varchar(50)",
    });
  });

  it("returns null when the guard's varchar length matches the schema's", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS author_handle varchar(255);"\n';

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "community_threads",
        "author_handle",
        "varchar(255)",
      ),
    ).toBeNull();
  });

  it("returns null when the guard omits the length modifier entirely (ambiguous, not flagged)", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS author_handle varchar;"\n';

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "community_threads",
        "author_handle",
        "varchar(255)",
      ),
    ).toBeNull();
  });

  it("returns null when the schema type itself has no length/precision to compare", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_threads ADD COLUMN IF NOT EXISTS flag_reason text(50);"\n';

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "community_threads",
        "flag_reason",
        "text",
      ),
    ).toBeNull();
  });

  it("returns null when no matching guard exists at all", () => {
    const snippet = "# db-migrate.sh with no ADD COLUMN guards at all\n";

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "community_threads",
        "author_handle",
        "varchar(255)",
      ),
    ).toBeNull();
  });

  it("returns null when the guard is for a different table even if the length differs", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS author_handle varchar(50);"\n';

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "community_threads",
        "author_handle",
        "varchar(255)",
      ),
    ).toBeNull();
  });

  it("flags a mismatched numeric precision/scale modifier (e.g. numeric(10,2) vs numeric(12,2))", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"ALTER TABLE cases ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2);"\n';

    expect(
      findAddColumnGuardPrecisionMismatch(
        snippet,
        "cases",
        "refund_amount",
        "numeric(12,2)",
      ),
    ).toEqual({
      schemaType: "numeric(12,2)",
      guardType: "numeric(10,2)",
    });
  });
});

describe("Schema Drift Guard — hasCreateTableGuard matcher (fixture-based)", () => {
  it("returns true for a CREATE TABLE IF NOT EXISTS statement naming the table", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"CREATE TABLE IF NOT EXISTS widget_orders (id serial PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);"\n';

    expect(hasCreateTableGuard(snippet, "widget_orders")).toBe(true);
  });

  it("returns false when the CREATE TABLE guard is for a different table", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"CREATE TABLE IF NOT EXISTS other_table (id serial PRIMARY KEY);"\n';

    expect(hasCreateTableGuard(snippet, "widget_orders")).toBe(false);
  });

  it("returns false when there is no CREATE TABLE guard at all", () => {
    const snippet = "# db-migrate.sh with no CREATE TABLE guards at all\n";

    expect(hasCreateTableGuard(snippet, "widget_orders")).toBe(false);
  });

  it("returns false for a CREATE TABLE statement missing the IF NOT EXISTS clause", () => {
    const snippet =
      'psql "$DATABASE_URL" -c "CREATE TABLE widget_orders (id serial PRIMARY KEY);"\n';

    expect(hasCreateTableGuard(snippet, "widget_orders")).toBe(false);
  });

  it("does not match a table name that is only a substring of another identifier", () => {
    const snippet =
      'psql "$DATABASE_URL" -c ' +
      '"CREATE TABLE IF NOT EXISTS widget_orders_archive (id serial PRIMARY KEY);"\n';

    expect(hasCreateTableGuard(snippet, "widget_orders")).toBe(false);
  });
});

describe("Schema Drift Guard — check-migrate-coverage.ts runtime behavior (mocked pg Client)", () => {
  const SCRIPT_MODULE_PATH = "../../scripts/check-migrate-coverage";

  let originalDatabaseUrl: string | undefined;
  let originalNeonUrl: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNeonUrl = process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/testdb";
    delete (process.env as Record<string, string | undefined>)
      .NEON_DATABASE_URL;
  });

  afterEach(() => {
    vi.doUnmock("pg");
    vi.doUnmock("fs");
    vi.restoreAllMocks();
    if (originalDatabaseUrl === undefined) {
      delete (process.env as Record<string, string | undefined>)
        .DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalNeonUrl === undefined) {
      delete (process.env as Record<string, string | undefined>)
        .NEON_DATABASE_URL;
    } else {
      process.env.NEON_DATABASE_URL = originalNeonUrl;
    }
  });

  function mockPgWithRow(row: {
    table_name: string;
    column_name: string;
    data_type: string;
  }) {
    mockPgWithRows([row]);
  }

  function mockPgWithRows(
    rows: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>,
  ) {
    vi.doMock("pg", () => ({
      Client: function MockClient() {
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          query: vi.fn().mockResolvedValue({ rows }),
          end: vi.fn().mockResolvedValue(undefined),
        };
      },
    }));
  }

  function mockMigrateShContent(content: string) {
    vi.doMock("fs", async () => {
      const actual = await vi.importActual<typeof import("fs")>("fs");
      const readFileSync = vi.fn((filePath: unknown, enc?: unknown) => {
        if (typeof filePath === "string" && filePath.endsWith("db-migrate.sh")) {
          return content;
        }
        return (actual.readFileSync as (...args: unknown[]) => unknown)(
          filePath,
          enc,
        );
      });
      return {
        ...actual,
        default: { ...actual, readFileSync },
        readFileSync,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Baseline row builder — since check-migrate-coverage.ts now also flags
  // brand-new TABLES (not just columns) that are missing from the mocked
  // `information_schema.columns` result, every runtime test below must
  // account for EVERY real table declared in shared/schema.ts, or every
  // table other than the one under test would be (correctly, but
  // unhelpfully for these targeted tests) reported as an uncovered
  // brand-new table. Rather than hand-listing dozens of tables, this
  // builds one row per real schema column (using the schema's own
  // declared SQL type, which is never 'text' unless the column actually is
  // text — see note below), so by default every table/column is already
  // "covered". Individual tests then delete/override specific rows to
  // simulate the exact drift/missing-column/missing-table scenario they
  // are testing, via rowsWithout / rowsWithoutTable / rowsWithOverride.
  // ---------------------------------------------------------------------
  type Row = { table_name: string; column_name: string; data_type: string };

  function buildBaselineRows(): Row[] {
    const rows: Row[] = [];
    for (const value of Object.values(
      schema as Record<string, unknown>,
    )) {
      if (!isTable(value)) continue;
      const tableName = getTableName(value);
      const cols = getTableColumns(value);
      for (const col of Object.values(cols)) {
        const sqlType = (col as { getSQLType(): string })
          .getSQLType()
          .toLowerCase();
        rows.push({
          table_name: tableName,
          column_name: (col as { name: string }).name,
          // Use the declared type verbatim so every column is treated as
          // "already covered" by default (actualType is present, and for
          // integer/boolean/serial columns it isn't the string 'text').
          data_type: sqlType,
        });
      }
    }
    return rows;
  }

  function rowsWithout(
    rows: Row[],
    tableName: string,
    columnName: string,
  ): Row[] {
    return rows.filter(
      (r) => !(r.table_name === tableName && r.column_name === columnName),
    );
  }

  function rowsWithoutTable(rows: Row[], tableName: string): Row[] {
    return rows.filter((r) => r.table_name !== tableName);
  }

  function rowsWithOverride(
    rows: Row[],
    tableName: string,
    columnName: string,
    dataType: string,
  ): Row[] {
    return rows.map((r) =>
      r.table_name === tableName && r.column_name === columnName
        ? { ...r, data_type: dataType }
        : r,
    );
  }

  it("exits non-zero and names the exact table.column when a drifted text column has no matching cast block", async () => {
    mockPgWithRows(
      rowsWithOverride(
        buildBaselineRows(),
        "community_threads",
        "view_count",
        "text",
      ),
    );
    mockMigrateShContent("# db-migrate.sh with no cast blocks at all\n");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (
        code?: number,
      ) => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await import(SCRIPT_MODULE_PATH);

    await vi.waitFor(
      () => {
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
      { timeout: 5000 },
    );

    const combined = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(
      combined,
      "the script must name the exact table.column and target type in its " +
        "failure output",
    ).toMatch(
      /community_threads\.view_count: DB has 'text', schema expects 'integer'/,
    );
  });

  it("passes and does not exit non-zero when a matching cast block already exists in db-migrate.sh", async () => {
    mockPgWithRows(
      rowsWithOverride(
        buildBaselineRows(),
        "community_threads",
        "view_count",
        "text",
      ),
    );
    mockMigrateShContent(
      "DO $$ BEGIN\n" +
        "  ALTER TABLE community_threads ALTER COLUMN view_count TYPE integer USING view_count::integer;\n" +
        "END $$;\n",
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (
        code?: number,
      ) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import(SCRIPT_MODULE_PATH);

    await vi.waitFor(
      () => {
        expect(logSpy).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );

    expect(
      exitSpy,
      "the script must not exit(1) when the drifted column already has a " +
        "matching db-migrate.sh cast block",
    ).not.toHaveBeenCalledWith(1);

    const combined = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(combined).toMatch(
      /OK — every text-vs-integer\/boolean column already/,
    );
  });

  it("exits non-zero and names the exact table.column when a brand-new non-integer/boolean column has no ADD COLUMN guard", async () => {
    // Every community_threads column is reported as already present EXCEPT
    // flag_reason (a plain `text` column, not integer/boolean), and
    // db-migrate.sh has no ADD COLUMN IF NOT EXISTS guard for it. Before the
    // ADD COLUMN guard check was broadened beyond integer/boolean, this scenario
    // would have been silently skipped.
    mockPgWithRows(
      rowsWithout(buildBaselineRows(), "community_threads", "flag_reason"),
    );
    mockMigrateShContent("# db-migrate.sh with no ADD COLUMN guards at all\n");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (
        code?: number,
      ) => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await import(SCRIPT_MODULE_PATH);

    await vi.waitFor(
      () => {
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
      { timeout: 5000 },
    );

    const combined = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(
      combined,
      "the script must flag a brand-new non-integer/boolean column missing " +
        "an ADD COLUMN IF NOT EXISTS guard, not just integer/boolean ones",
    ).toMatch(
      /community_threads\.flag_reason: new 'text' column not yet present in the live DB.*no matching ADD COLUMN IF NOT EXISTS guard/,
    );
  });

  it("exits non-zero and names the exact table when a brand-new table with integer/boolean columns has no CREATE TABLE guard", async () => {
    // community_threads is entirely absent from the (mocked) live DB and
    // declares several integer/boolean columns (view_count, reply_count,
    // is_pinned, is_locked, is_flagged), and db-migrate.sh has no
    // CREATE TABLE IF NOT EXISTS fallback for it. Before this check
    // existed, a whole missing table would have been silently skipped.
    mockPgWithRows(rowsWithoutTable(buildBaselineRows(), "community_threads"));
    mockMigrateShContent("# db-migrate.sh with no CREATE TABLE guards at all\n");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (
        code?: number,
      ) => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await import(SCRIPT_MODULE_PATH);

    await vi.waitFor(
      () => {
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
      { timeout: 5000 },
    );

    const combined = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(
      combined,
      "the script must flag a brand-new table with integer/boolean columns " +
        "that is missing a db-migrate.sh CREATE TABLE IF NOT EXISTS fallback, " +
        "naming the exact table.",
    ).toMatch(
      /community_threads: brand-new table \(not yet present in the live DB\) with integer\/boolean column\(s\), but scripts\/db-migrate\.sh has no matching 'CREATE TABLE IF NOT EXISTS community_threads/,
    );
  });

  it("passes and does not exit non-zero when a brand-new table already has a matching CREATE TABLE IF NOT EXISTS fallback", async () => {
    mockPgWithRows(rowsWithoutTable(buildBaselineRows(), "community_threads"));
    mockMigrateShContent(
      'psql "$DATABASE_URL" -c ' +
        '"CREATE TABLE IF NOT EXISTS community_threads (id serial PRIMARY KEY, view_count integer NOT NULL DEFAULT 0, reply_count integer NOT NULL DEFAULT 0, is_pinned boolean NOT NULL DEFAULT false, is_locked boolean NOT NULL DEFAULT false, is_flagged boolean NOT NULL DEFAULT false);"\n',
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (
        code?: number,
      ) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import(SCRIPT_MODULE_PATH);

    await vi.waitFor(
      () => {
        expect(logSpy).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );

    expect(
      exitSpy,
      "the script must not exit(1) when the missing table already has a " +
        "matching db-migrate.sh CREATE TABLE IF NOT EXISTS fallback",
    ).not.toHaveBeenCalledWith(1);
  });
});
