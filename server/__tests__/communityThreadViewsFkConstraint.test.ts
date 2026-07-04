import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

// Lightweight real-DB introspection test confirming that the
// community_thread_views.thread_id FK was created with ON DELETE CASCADE.
//
// The constraint appears in migration 0021_community_thread_views.sql, but
// Drizzle schema declarations only take effect if db:push (or the migration)
// was actually executed after the declaration was added.  This test closes
// that gap by querying information_schema directly, so a missing or
// incorrectly-specified rule will be caught in CI rather than silently
// orphaning view rows when a thread is deleted.
//
// Live production DB verification (June 2026):
// The following query was executed against the production Neon database and
// returned exactly one row confirming the constraint is applied:
//
//   SELECT tc.constraint_name, tc.table_name, kcu.column_name, rc.delete_rule
//   FROM information_schema.table_constraints tc
//   JOIN information_schema.key_column_usage kcu ...
//   JOIN information_schema.referential_constraints rc ...
//   WHERE tc.constraint_type = 'FOREIGN KEY'
//     AND tc.table_name = 'community_thread_views'
//
//   Result:
//     constraint_name: community_thread_views_thread_id_community_threads_id_fk
//     table_name:      community_thread_views
//     column_name:     thread_id
//     delete_rule:     CASCADE  ✓
//
// No db:push or additional migration was required — migration
// 0021_community_thread_views.sql already included ON DELETE CASCADE from
// the table's initial creation, so the constraint was never missing.
//
// Remediation (not needed, documented for reference):
// If the delete_rule had been NO ACTION instead of CASCADE, the fix would
// be: run `npm run db:push` (which re-diffs shared/schema.ts against the
// live DB and emits an ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …
// statement), then re-run this verification query.
//
// Skips with a clear message when no DATABASE_URL / NEON_DATABASE_URL is
// configured (mirrors the pattern used by other real-DB integration tests in
// this directory).

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[communityThreadViewsFkConstraint] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB constraint checks.",
  );
}

let pool: Pool;

describeIfDb(
  "community_thread_views FK cascade constraint — real Postgres introspection",
  () => {
    beforeAll(() => {
      pool = new Pool({
        connectionString: TEST_DB_URL,
        ssl: TEST_DB_URL!.includes("sslmode=require")
          ? { rejectUnauthorized: true }
          : false,
      });
    });

    afterAll(async () => {
      await pool.end();
    });

    it("community_thread_views.thread_id FK has delete_rule = CASCADE", async () => {
      const result = await pool.query<{
        constraint_name: string;
        table_name: string;
        column_name: string;
        delete_rule: string;
      }>(
        `SELECT
           tc.constraint_name,
           tc.table_name,
           kcu.column_name,
           rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema   = kcu.table_schema
         JOIN information_schema.referential_constraints rc
           ON tc.constraint_name  = rc.constraint_name
          AND tc.table_schema     = rc.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_name      = 'community_thread_views'
           AND kcu.column_name    = 'thread_id'`,
      );

      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row.table_name).toBe("community_thread_views");
      expect(row.column_name).toBe("thread_id");
      expect(row.delete_rule).toBe("CASCADE");
    });
  },
);
