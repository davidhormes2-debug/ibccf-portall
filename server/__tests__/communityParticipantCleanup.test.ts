import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

// Task #129 — automated coverage for the cascade + sweep introduced in Task #126.
// This file covers two storage-level behaviours:
//   1. storage.pruneCommunityParticipantsForInactiveCases drops participants
//      attached to sealed / completed cases past the cutoff, leaves active
//      cases alone, and ignores NULL-case_id rows (admin / bot scaffolding).
//   2. caseRepository.delete removes the case's participant row, which in turn
//      cascades to community_reactions and earned_badges via the FKs added in
//      migration 0013. We mirror the cascade in our in-memory db mock and also
//      assert the SQL itself declares ON DELETE CASCADE so a future migration
//      can't silently drop the constraint.

type CaseRow = {
  id: string;
  status: string;
  sealedAt: Date | null;
  updatedAt: Date;
};
type ParticipantRow = { id: number; caseId: string | null; anonymousHandle: string };
type ReactionRow = { id: number; participantId: number };
type BadgeRow = { id: number; participantId: number };

const state = vi.hoisted(() => ({
  cases: [] as Array<{
    id: string;
    status: string;
    sealedAt: Date | null;
    updatedAt: Date;
  }>,
  participants: [] as Array<{
    id: number;
    caseId: string | null;
    anonymousHandle: string;
  }>,
  reactions: [] as Array<{ id: number; participantId: number }>,
  badges: [] as Array<{ id: number; participantId: number }>,
  deleteOps: [] as Array<{ table: string; caseId: string }>,
}));

function findFirstStringParam(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as Record<string, unknown>;
  if (typeof n.value === "string") return n.value;
  const chunks = n.queryChunks;
  if (Array.isArray(chunks)) {
    for (const c of chunks) {
      const v = findFirstStringParam(c);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function findFirstDateParam(node: unknown): Date | undefined {
  if (node instanceof Date) return node;
  if (!node || typeof node !== "object") return undefined;
  const n = node as Record<string, unknown>;
  if (n.value instanceof Date) return n.value;
  const chunks = n.queryChunks;
  if (Array.isArray(chunks)) {
    for (const c of chunks) {
      const v = findFirstDateParam(c);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

vi.mock("../db", async () => {
  const schema = await import("@shared/schema");
  const tableNameOf = (t: unknown): string => {
    if (t === schema.communityParticipants) return "community_participants";
    if (t === schema.communityReactions) return "community_reactions";
    if (t === schema.cases) return "cases";
    if (t === schema.depositReceipts) return "deposit_receipts";
    if (t === schema.adminMessages) return "admin_messages";
    if (t === schema.chatMessages) return "chat_messages";
    if (t === schema.caseSubmissions) return "case_submissions";
    if (t === schema.caseLetters) return "case_letters";
    return "unknown";
  };
  return {
    db: {
      delete(table: unknown) {
        const name = tableNameOf(table);
        return {
          async where(predicate: unknown) {
            const caseId = findFirstStringParam(predicate) ?? "";
            state.deleteOps.push({ table: name, caseId });
            if (name === "community_participants") {
              const removed = state.participants.filter(
                (p: ParticipantRow) => p.caseId === caseId,
              );
              const ids = new Set(removed.map((p: ParticipantRow) => p.id));
              state.participants = state.participants.filter(
                (p: ParticipantRow) => !ids.has(p.id),
              );
              // Simulate the FK ON DELETE CASCADE added in migration 0013.
              state.reactions = state.reactions.filter(
                (r: ReactionRow) => !ids.has(r.participantId),
              );
              state.badges = state.badges.filter(
                (b: BadgeRow) => !ids.has(b.participantId),
              );
            } else if (name === "cases") {
              state.cases = state.cases.filter(
                (c: CaseRow) => c.id !== caseId,
              );
            }
            // Other case-scoped tables (receipts, messages, etc.) are no-ops
            // for this test — we only care about the community side.
          },
        };
      },
      async execute(query: unknown) {
        const cutoff = findFirstDateParam(query);
        if (!cutoff) return { rows: [] };
        const toRemove = state.participants.filter((p: ParticipantRow) => {
          if (p.caseId === null) return false;
          const c = state.cases.find((x: CaseRow) => x.id === p.caseId);
          if (!c) return false;
          const inactive =
            c.sealedAt !== null ||
            c.status === "completed" ||
            c.status === "sealed";
          if (!inactive) return false;
          return c.updatedAt.getTime() < cutoff.getTime();
        });
        const ids = new Set(toRemove.map((p: ParticipantRow) => p.id));
        state.participants = state.participants.filter(
          (p: ParticipantRow) => !ids.has(p.id),
        );
        state.reactions = state.reactions.filter(
          (r: ReactionRow) => !ids.has(r.participantId),
        );
        state.badges = state.badges.filter(
          (b: BadgeRow) => !ids.has(b.participantId),
        );
        return { rows: toRemove.map((p: ParticipantRow) => ({ case_id: p.caseId })) };
      },
    },
  };
});

beforeEach(() => {
  state.cases.length = 0;
  state.participants.length = 0;
  state.reactions.length = 0;
  state.badges.length = 0;
  state.deleteOps.length = 0;
});

describe("storage.pruneCommunityParticipantsForInactiveCases", () => {
  it("prunes participants for sealed/completed cases past the cutoff, leaves active cases alone, ignores NULL case_id rows", async () => {
    const { storage } = await import("../storage");

    const now = new Date("2026-05-01T00:00:00Z");
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const longAgo = new Date("2025-01-01T00:00:00Z");

    state.cases.push(
      // Sealed > 90 days ago → should prune
      { id: "sealed-old", status: "active", sealedAt: longAgo, updatedAt: longAgo },
      // Completed status, long-inactive → should prune
      { id: "completed-old", status: "completed", sealedAt: null, updatedAt: longAgo },
      // Status=sealed but recent activity → keep (within retention window)
      { id: "sealed-fresh", status: "sealed", sealedAt: now, updatedAt: now },
      // Plain active case → keep
      { id: "active-fresh", status: "active", sealedAt: null, updatedAt: now },
      // Long-inactive but neither sealed nor completed → keep
      { id: "abandoned-but-open", status: "active", sealedAt: null, updatedAt: longAgo },
    );
    state.participants.push(
      { id: 1, caseId: "sealed-old", anonymousHandle: "h1" },
      { id: 2, caseId: "completed-old", anonymousHandle: "h2" },
      { id: 3, caseId: "sealed-fresh", anonymousHandle: "h3" },
      { id: 4, caseId: "active-fresh", anonymousHandle: "h4" },
      { id: 5, caseId: "abandoned-but-open", anonymousHandle: "h5" },
      // NULL case_id rows (admin handles / bot scaffolding) must never be touched.
      { id: 6, caseId: null, anonymousHandle: "admin-bot" },
    );

    const result = await storage.pruneCommunityParticipantsForInactiveCases(cutoff);

    expect(result.removed).toBe(2);
    expect([...result.caseIds].sort()).toEqual(["completed-old", "sealed-old"]);

    const remaining = state.participants.map((p) => p.id).sort((a, b) => a - b);
    expect(remaining).toEqual([3, 4, 5, 6]);
  });
});

describe("storage.deleteCase / caseRepository.delete", () => {
  it("storage.deleteCase removes the matching community_participants row and cascades reactions / earned_badges", async () => {
    const { storage } = await import("../storage");

    const now = new Date();
    state.cases.push(
      { id: "case-A", status: "active", sealedAt: null, updatedAt: now },
      { id: "case-B", status: "active", sealedAt: null, updatedAt: now },
    );
    state.participants.push(
      { id: 30, caseId: "case-A", anonymousHandle: "anonA" },
      { id: 40, caseId: "case-B", anonymousHandle: "anonB" },
    );
    state.reactions.push(
      { id: 300, participantId: 30 },
      { id: 400, participantId: 40 },
    );
    state.badges.push(
      { id: 3000, participantId: 30 },
      { id: 4000, participantId: 40 },
    );

    await storage.deleteCase("case-A");

    const participantDelete = state.deleteOps.find(
      (o) => o.table === "community_participants",
    );
    expect(participantDelete).toBeDefined();
    expect(participantDelete?.caseId).toBe("case-A");

    expect(state.participants.map((p) => p.id)).toEqual([40]);
    expect(state.reactions.map((r) => r.id)).toEqual([400]);
    expect(state.badges.map((b) => b.id)).toEqual([4000]);
    expect(state.cases.find((c) => c.id === "case-A")).toBeUndefined();
    expect(state.cases.find((c) => c.id === "case-B")).toBeDefined();
  });

  it("caseRepository.delete removes the matching community_participants row and cascades reactions / earned_badges", async () => {
    const { caseRepository } = await import("../repositories/CaseRepository");

    const now = new Date();
    state.cases.push(
      { id: "case-A", status: "active", sealedAt: null, updatedAt: now },
      { id: "case-B", status: "active", sealedAt: null, updatedAt: now },
    );
    state.participants.push(
      { id: 10, caseId: "case-A", anonymousHandle: "anonA" },
      { id: 20, caseId: "case-B", anonymousHandle: "anonB" },
    );
    state.reactions.push(
      { id: 100, participantId: 10 },
      { id: 101, participantId: 10 },
      { id: 200, participantId: 20 },
    );
    state.badges.push(
      { id: 1000, participantId: 10 },
      { id: 2000, participantId: 20 },
    );

    await caseRepository.delete("case-A");

    // Repo explicitly issued the participant delete for case-A (belt-and-braces
    // alongside the FK cascade).
    const participantDelete = state.deleteOps.find(
      (o) => o.table === "community_participants",
    );
    expect(participantDelete).toBeDefined();
    expect(participantDelete?.caseId).toBe("case-A");

    // Case A's participant is gone, its reactions and earned badges cascaded
    // away with it, and case B's data is completely untouched.
    expect(state.participants.map((p) => p.id)).toEqual([20]);
    expect(state.reactions.map((r) => r.id)).toEqual([200]);
    expect(state.badges.map((b) => b.id)).toEqual([2000]);
    expect(state.cases.find((c) => c.id === "case-A")).toBeUndefined();
    expect(state.cases.find((c) => c.id === "case-B")).toBeDefined();
  });

  it("migration 0013 declares ON DELETE CASCADE for participants, reactions, and earned badges", () => {
    // Belt-and-braces for the cascade behaviour above: the in-memory mock
    // simulates cascade semantics, but the real cascade lives in the migration
    // SQL. Asserting the SQL guards against an accidental constraint drop in a
    // later migration / db:push round-trip.
    const sqlText = fs.readFileSync(
      path.resolve(process.cwd(), "migrations/0013_community_participants_cascade.sql"),
      "utf8",
    );
    expect(sqlText).toMatch(
      /community_participants[\s\S]*REFERENCES "cases"\("id"\) ON DELETE CASCADE/,
    );
    expect(sqlText).toMatch(
      /community_reactions[\s\S]*REFERENCES "community_participants"\("id"\) ON DELETE CASCADE/,
    );
    expect(sqlText).toMatch(
      /earned_badges[\s\S]*REFERENCES "community_participants"\("id"\) ON DELETE CASCADE/,
    );
  });
});
