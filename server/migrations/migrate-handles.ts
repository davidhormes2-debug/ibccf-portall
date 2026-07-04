/**
 * Migration: Update existing bot profile handles to the premium "Member #XXXXX" format.
 *
 * - Skips profiles whose handle already matches the new format (idempotent).
 * - Generates a globally unique new handle for each profile that needs updating.
 * - Propagates the rename to community_threads and community_posts via
 *   a JOIN on author_bot_id — a single bulk UPDATE per table (3 queries total).
 *
 * Run with:  npx tsx server/migrations/migrate-handles.ts
 */

import { db } from "../db";
import { botProfiles } from "@shared/schema";
import { sql } from "drizzle-orm";

const PREMIUM_HANDLE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PREMIUM_HANDLE_RE = /^Member #[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

function generatePremiumHandle(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += PREMIUM_HANDLE_CHARS[Math.floor(Math.random() * PREMIUM_HANDLE_CHARS.length)];
  }
  return `Member #${code}`;
}

async function run() {
  console.log("=== Handle migration started ===\n");

  // 1. Load all bot profiles
  const allBots = await db
    .select({ id: botProfiles.id, handle: botProfiles.handle })
    .from(botProfiles);

  const toMigrate = allBots.filter(b => !PREMIUM_HANDLE_RE.test(b.handle));

  if (toMigrate.length === 0) {
    console.log("✓ All handles are already in the premium format. Nothing to do.");
    process.exit(0);
  }

  console.log(`Found ${toMigrate.length} handle(s) to migrate (${allBots.length - toMigrate.length} already premium).\n`);

  // 2. Generate a unique new handle for each profile that needs one
  const takenHandles = new Set<string>(allBots.map(b => b.handle));

  function uniqueHandle(): string {
    let h: string;
    do { h = generatePremiumHandle(); } while (takenHandles.has(h));
    takenHandles.add(h);
    return h;
  }

  const renameMap = new Map<number, { oldHandle: string; newHandle: string }>();
  for (const bot of toMigrate) {
    renameMap.set(bot.id, { oldHandle: bot.handle, newHandle: uniqueHandle() });
  }

  // 3. Build a VALUES list for a single bulk UPDATE query on bot_profiles
  //    UPDATE bot_profiles AS t SET handle = v.handle
  //    FROM (VALUES (id, 'new_handle'), ...) AS v(id, handle)
  //    WHERE t.id = v.id
  const valueRows = [...renameMap.entries()]
    .map(([id, { newHandle }]) => `(${id}, '${newHandle.replace(/'/g, "''")}')`)
    .join(", ");

  await db.transaction(async (tx) => {
    // 3a. Bulk-update all bot_profiles handles in a single query
    await tx.execute(sql.raw(`
      UPDATE bot_profiles AS t
      SET handle = v.handle
      FROM (VALUES ${valueRows}) AS v(id, handle)
      WHERE t.id = CAST(v.id AS integer)
    `));

    // 3b. Sync community_threads: join on author_bot_id (single query)
    await tx.execute(sql.raw(`
      UPDATE community_threads ct
      SET author_handle = bp.handle
      FROM bot_profiles bp
      WHERE ct.author_bot_id = bp.id
        AND ct.author_handle != bp.handle
    `));

    // 3c. Sync community_posts: join on author_bot_id (single query)
    await tx.execute(sql.raw(`
      UPDATE community_posts cp
      SET author_handle = bp.handle
      FROM bot_profiles bp
      WHERE cp.author_bot_id = bp.id
        AND cp.author_handle != bp.handle
    `));
  });

  // 4. Verify
  const remaining = await db
    .select({ handle: botProfiles.handle })
    .from(botProfiles)
    .then(rows => rows.filter(r => !PREMIUM_HANDLE_RE.test(r.handle)));

  console.log(`Bot profiles migrated : ${toMigrate.length}`);
  if (remaining.length === 0) {
    console.log("✓ All bot_profiles handles are now in the premium format.");
  } else {
    console.warn(`⚠ ${remaining.length} handle(s) still in old format — check for conflicts.`);
  }
  console.log("\n=== Migration complete ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
