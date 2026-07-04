import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@shared/schema';

const rawConnectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error('DATABASE_URL or NEON_DATABASE_URL environment variable is not set');
}

// pg-connection-string v3 / pg v9 will tighten what `sslmode=require` means
// (it currently silently behaves like `verify-full` and emits a noisy startup
// warning). Opting in to `uselibpqcompat=true` pins us to the libpq semantics
// we already rely on and silences the warning until we're ready to migrate
// the conn-string to an explicit mode.
function withLibpqCompat(url: string): string {
  if (/[?&]uselibpqcompat=/.test(url)) return url;
  if (!/[?&]sslmode=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'uselibpqcompat=true';
}

const connectionString = withLibpqCompat(rawConnectionString);

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: true } : false,
});

export const db = drizzle(pool, { schema });

// A database "executor" — either the top-level `db` connection or a
// transaction handle yielded by `db.transaction(...)`. Storage and
// repository methods that accept an optional executor argument can be
// composed inside a single transaction by passing the `tx` through.
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];
