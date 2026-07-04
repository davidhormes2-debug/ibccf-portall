/**
 * scripts/migrateGuardMatchers.ts
 *
 * Pure, side-effect-free matcher functions shared by
 * scripts/check-migrate-coverage.ts. Extracted into their own module so
 * tests can import them directly without triggering the parent script's
 * top-level DB connection / process.exit side effects (that script runs
 * `main()` unconditionally at import time).
 */

export function hasCastBlock(
  migrateSql: string,
  tableName: string,
  columnName: string,
  targetType: "integer" | "boolean",
): boolean {
  // A cast block is considered present when db-migrate.sh mentions the table
  // and column together with a `TYPE <targetType>` change and a
  // `USING <columnName>::<targetType>` (or ::integer/::boolean) coercion.
  // We don't require a single exact regex across the whole file since blocks
  // are hand-written DO $$ ... $$ statements; instead we scan line-by-line
  // "windows" around every occurrence of the column name.
  const colRegex = new RegExp(`\\b${columnName}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = colRegex.exec(migrateSql)) !== null) {
    const windowStart = Math.max(0, match.index - 400);
    const windowEnd = Math.min(migrateSql.length, match.index + 400);
    const window = migrateSql.slice(windowStart, windowEnd);

    const mentionsTable = new RegExp(`\\b${tableName}\\b`).test(window);
    const mentionsTypeChange = new RegExp(
      `TYPE\\s+${targetType}`,
      "i",
    ).test(window);
    const mentionsUsingCast = new RegExp(
      `USING\\s+${columnName}::${targetType}`,
      "i",
    ).test(window);

    if (mentionsTable && mentionsTypeChange && mentionsUsingCast) {
      return true;
    }
  }
  return false;
}

export function hasCreateTableGuard(
  migrateSql: string,
  tableName: string,
): boolean {
  // A CREATE TABLE guard is considered present when db-migrate.sh contains a
  // "CREATE TABLE IF NOT EXISTS <tableName>" statement. Unlike hasCastBlock /
  // hasAddColumnGuard, no column/type window-matching is needed here — a
  // brand-new table either has a fallback creation statement naming it, or
  // it doesn't. This mirrors the ADD COLUMN IF NOT EXISTS convention already
  // used for columns added to an EXISTING table, extended to cover the case
  // of an entire new table missing from the live DB (see check-migrate-coverage.ts).
  const regex = new RegExp(
    `CREATE TABLE IF NOT EXISTS\\s+${tableName}\\b`,
    "i",
  );
  return regex.test(migrateSql);
}

export function hasAddColumnGuard(
  migrateSql: string,
  tableName: string,
  columnName: string,
  targetType: string,
): boolean {
  // An ADD COLUMN guard is considered present when db-migrate.sh contains an
  // "ADD COLUMN IF NOT EXISTS <columnName> <targetType>" statement scoped to
  // the right table. As with hasCastBlock, we scan windows around every
  // occurrence of the column name rather than requiring one exact regex
  // across the whole file, since these are hand-written psql -c statements.
  //
  // targetType is intentionally a plain `string`, not just "integer" |
  // "boolean" — a brand-new column on an existing table can be any drizzle
  // type (text, varchar, timestamp, jsonb, numeric, ...), not only the two
  // types that require a cast when converting FROM text. Only the base type
  // name is matched (e.g. "varchar(255)" -> "varchar") since db-migrate.sh's
  // hand-written statements may omit length/precision modifiers, and any
  // regex-special characters in the type are escaped since it is
  // interpolated directly into a RegExp.
  const baseType = targetType.split("(")[0].trim();
  const escapedBaseType = baseType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const colRegex = new RegExp(
    `ADD COLUMN IF NOT EXISTS\\s+${columnName}\\b`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = colRegex.exec(migrateSql)) !== null) {
    const windowStart = Math.max(0, match.index - 400);
    const windowEnd = Math.min(migrateSql.length, match.index + 400);
    const window = migrateSql.slice(windowStart, windowEnd);

    const mentionsTable = new RegExp(`\\b${tableName}\\b`).test(window);
    const mentionsType = new RegExp(
      `${columnName}\\s+${escapedBaseType}\\b`,
      "i",
    ).test(window);

    if (mentionsTable && mentionsType) {
      return true;
    }
  }
  return false;
}

export interface PrecisionMismatch {
  /** The full type as declared in shared/schema.ts, e.g. "varchar(255)". */
  schemaType: string;
  /** The full type as written in the matching db-migrate.sh guard, e.g. "varchar(50)". */
  guardType: string;
}

/**
 * Looks for an ADD COLUMN IF NOT EXISTS guard that already satisfies
 * hasAddColumnGuard (same table/column/base-type), but whose length/precision
 * modifier — e.g. the "(50)" in "varchar(50)" — does not match the one
 * declared in shared/schema.ts.
 *
 * hasAddColumnGuard intentionally only compares base type names (see its
 * comment above) so that a guard which omits the modifier entirely (a bare
 * "varchar") is not treated as missing. This function catches the narrower,
 * genuinely-suspicious case where the guard DOES specify a modifier and it
 * disagrees with the schema — e.g. schema says varchar(255) but the guard
 * adds varchar(50), silently truncating future inserts relative to what
 * drizzle validates in application code.
 *
 * Returns null when:
 *   - the schema type has no modifier to compare (nothing to mismatch), or
 *   - no matching guard is found at all (that's hasAddColumnGuard's concern), or
 *   - the guard omits its modifier (ambiguous, not flagged — same reasoning
 *     as hasAddColumnGuard's base-type-only comparison), or
 *   - the guard's modifier matches the schema's.
 *
 * This is intentionally a soft, informational signal (see
 * check-migrate-coverage.ts) rather than a hard failure: a mismatch here
 * would often also be caught post-push by check-schema-drift.ts once the
 * column actually exists in the DB, so treating it as a build-breaking error
 * here would be redundant in the common case.
 */
export function findAddColumnGuardPrecisionMismatch(
  migrateSql: string,
  tableName: string,
  columnName: string,
  targetType: string,
): PrecisionMismatch | null {
  const schemaModifierMatch = targetType.match(/\(([^)]+)\)/);
  if (!schemaModifierMatch) return null;
  const schemaPrecision = schemaModifierMatch[1].trim();

  const baseType = targetType.split("(")[0].trim();
  const escapedBaseType = baseType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const colRegex = new RegExp(
    `ADD COLUMN IF NOT EXISTS\\s+${columnName}\\b`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = colRegex.exec(migrateSql)) !== null) {
    const windowStart = Math.max(0, match.index - 400);
    const windowEnd = Math.min(migrateSql.length, match.index + 400);
    const window = migrateSql.slice(windowStart, windowEnd);

    const mentionsTable = new RegExp(`\\b${tableName}\\b`).test(window);
    if (!mentionsTable) continue;

    const typeMatch = new RegExp(
      `${columnName}\\s+${escapedBaseType}\\b(\\s*\\(([^)]+)\\))?`,
      "i",
    ).exec(window);
    if (!typeMatch) continue;

    const guardPrecision = typeMatch[2];
    if (guardPrecision === undefined) {
      // Guard omits the modifier entirely — ambiguous, not a mismatch.
      continue;
    }

    if (guardPrecision.trim() !== schemaPrecision) {
      return {
        schemaType: targetType,
        guardType: `${baseType}(${guardPrecision.trim()})`,
      };
    }
  }
  return null;
}
