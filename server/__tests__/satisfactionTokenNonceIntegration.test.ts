import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

// ============================================================================
// Integration coverage for storage.claimSatisfactionTokenNonce /
// deleteExpiredSatisfactionTokenNonces against real Postgres.
//
// The unit tests in satisfactionToken.test.ts prove the token itself is
// correctly signed/expired/bound; this test proves the separate single-use
// enforcement layer (the DB-backed nonce claim) that
// POST /api/visitors/satisfaction relies on:
//
//   1. The first claim of a fresh nonce succeeds.
//   2. Replaying the exact same nonce afterwards fails (returns false),
//      simulating a captured token being resubmitted — including a scenario
//      where SESSION_SECRET has since rotated (the nonce store doesn't care
//      about the secret at all, so rotation can't resurrect a claimed nonce
//      or un-claim one).
//   3. Concurrent claims of the same nonce (simulating two autoscale
//      instances racing on a replayed token) resolve to exactly one winner.
//   4. deleteExpiredSatisfactionTokenNonces only removes rows whose
//      expiresAt has passed, leaving live rows (and their single-use
//      guarantee) intact.
//
// Skips with a clear message when no DATABASE_URL / NEON_DATABASE_URL is
// configured, mirroring other *Integration.test.ts files in this suite.
// ============================================================================

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[satisfactionTokenNonceIntegration] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB nonce-claim checks.",
  );
}

const { storage } = await import("../storage");
const { db } = await import("../db");
const { satisfactionTokenNonces } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");

function futureExpiry(msFromNow = 60_000): Date {
  return new Date(Date.now() + msFromNow);
}

describeIfDb(
  "storage.claimSatisfactionTokenNonce — real Postgres single-use enforcement",
  () => {
    const createdNonces: string[] = [];

    afterEach(async () => {
      for (const nonce of createdNonces) {
        await db.delete(satisfactionTokenNonces).where(eq(satisfactionTokenNonces.nonce, nonce));
      }
      createdNonces.length = 0;
    });

    it("allows the first claim of a fresh nonce", async () => {
      const nonce = `itest-${randomUUID()}`;
      createdNonces.push(nonce);
      const claimed = await storage.claimSatisfactionTokenNonce(nonce, futureExpiry());
      expect(claimed).toBe(true);
    });

    it("rejects a replay of the same nonce", async () => {
      const nonce = `itest-${randomUUID()}`;
      createdNonces.push(nonce);
      const first = await storage.claimSatisfactionTokenNonce(nonce, futureExpiry());
      const second = await storage.claimSatisfactionTokenNonce(nonce, futureExpiry());
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it("still rejects a replay even with a different expiresAt (simulating a secret rotation retry)", async () => {
      const nonce = `itest-${randomUUID()}`;
      createdNonces.push(nonce);
      const first = await storage.claimSatisfactionTokenNonce(nonce, futureExpiry(60_000));
      const second = await storage.claimSatisfactionTokenNonce(nonce, futureExpiry(120_000));
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it("resolves concurrent claims of the same nonce to exactly one winner", async () => {
      const nonce = `itest-${randomUUID()}`;
      createdNonces.push(nonce);
      const results = await Promise.all([
        storage.claimSatisfactionTokenNonce(nonce, futureExpiry()),
        storage.claimSatisfactionTokenNonce(nonce, futureExpiry()),
        storage.claimSatisfactionTokenNonce(nonce, futureExpiry()),
      ]);
      const winners = results.filter((r) => r === true);
      expect(winners).toHaveLength(1);
    });

    it("deleteExpiredSatisfactionTokenNonces removes only past-expiry rows", async () => {
      const expiredNonce = `itest-expired-${randomUUID()}`;
      const liveNonce = `itest-live-${randomUUID()}`;
      createdNonces.push(expiredNonce, liveNonce);

      await db.insert(satisfactionTokenNonces).values({
        nonce: expiredNonce,
        expiresAt: new Date(Date.now() - 60_000),
      });
      await db.insert(satisfactionTokenNonces).values({
        nonce: liveNonce,
        expiresAt: futureExpiry(),
      });

      await storage.deleteExpiredSatisfactionTokenNonces();

      const [expiredRow] = await db
        .select()
        .from(satisfactionTokenNonces)
        .where(eq(satisfactionTokenNonces.nonce, expiredNonce));
      const [liveRow] = await db
        .select()
        .from(satisfactionTokenNonces)
        .where(eq(satisfactionTokenNonces.nonce, liveNonce));

      expect(expiredRow).toBeUndefined();
      expect(liveRow).toBeDefined();

      // The live nonce's row already exists in the table (presence IS the
      // claim — there's no separate "unclaimed" state), so a second claim
      // attempt correctly conflicts.
      const claimed = await storage.claimSatisfactionTokenNonce(liveNonce, futureExpiry());
      expect(claimed).toBe(false);
    });
  },
);
