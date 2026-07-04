import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Portal session store — multi-instance safety (Task #123)
//
// Portal session tokens used to live in a per-process Map, which under
// Replit autoscale meant:
//   • a user signed in on instance A would 401 if their next request was
//     served by instance B, and
//   • admin "Force logout" only dropped sessions from the instance that
//     processed the click.
//
// Moving the rows into Postgres fixes both. This file simulates the
// two-instance setup by re-importing the session-store module with a
// fresh module cache (so each "instance" has its own module-level state)
// while both go through the same shared `storage` mock — mirroring how
// real instances share a Postgres table.
// ============================================================================

const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) =>
      portalSessionStore.get(token),
    ),
    deletePortalSession: vi.fn(async (token: string) => {
      portalSessionStore.delete(token);
    }),
    deletePortalSessionsByCaseId: vi.fn(async (caseId: string) => {
      let n = 0;
      for (const [t, row] of Array.from(portalSessionStore.entries())) {
        if (row.caseId === caseId) {
          portalSessionStore.delete(t);
          n++;
        }
      }
      return n;
    }),
    deleteExpiredPortalSessions: vi.fn(async () => 0),
  }),
}));

describe("Portal session store — Postgres-backed, multi-instance safe", () => {
  beforeEach(() => {
    portalSessionStore.clear();
    vi.resetModules();
  });

  it("a session minted on instance A is validated by instance B", async () => {
    const instanceA = await import("../services/session-store");
    const token = await instanceA.createSession("case-1", "ACCESS-1");

    vi.resetModules();
    const instanceB = await import("../services/session-store");
    expect(instanceB).not.toBe(instanceA);

    const session = await instanceB.validateSession(token);
    expect(session).not.toBeNull();
    expect(session!.caseId).toBe("case-1");
    expect(session!.accessCode).toBe("ACCESS-1");
  });

  it("admin force-logout on instance A invalidates the session on instance B", async () => {
    const instanceA = await import("../services/session-store");
    const token = await instanceA.createSession("case-7", "ACCESS-7");

    // Sanity: instance A sees it.
    expect(await instanceA.validateSession(token)).not.toBeNull();

    // Admin clicks "Force logout" — the request happens to land on
    // instance A and clears every portal session for the case.
    const dropped = await instanceA.deleteSessionsByCaseId("case-7");
    expect(dropped).toBe(1);

    // The user's next refresh now lands on instance B. Because the rows
    // live in Postgres, instance B sees the deletion immediately and the
    // stale token is rejected (it would have remained valid under the
    // old per-process Map).
    vi.resetModules();
    const instanceB = await import("../services/session-store");
    const session = await instanceB.validateSession(token);
    expect(session).toBeNull();
  });

  it("deleteSession on instance A is honoured on instance B (single-token revocation)", async () => {
    const instanceA = await import("../services/session-store");
    const tokenA = await instanceA.createSession("case-9", "ACCESS-9");
    const tokenB = await instanceA.createSession("case-9", "ACCESS-9");

    await instanceA.deleteSession(tokenA);

    vi.resetModules();
    const instanceB = await import("../services/session-store");
    expect(await instanceB.validateSession(tokenA)).toBeNull();
    // The other session for the same case remains valid.
    expect(await instanceB.validateSession(tokenB)).not.toBeNull();
  });

  it("expired sessions are rejected and pruned on validate", async () => {
    const instanceA = await import("../services/session-store");
    const token = await instanceA.createSession("case-x", "ACCESS-X");

    // Backdate the row past its TTL by mutating the shared store
    // directly (simulates the natural passage of time).
    const row = portalSessionStore.get(token);
    row.expiresAt = new Date(Date.now() - 1_000);

    expect(await instanceA.validateSession(token)).toBeNull();
  });
});
