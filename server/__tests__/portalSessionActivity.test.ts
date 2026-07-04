import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// Task #2353 — validateSession() must bump portal_sessions.last_activity_at
// on every successful validation so admins can see how recently the user was
// active, not just that the token is technically still valid.
// ============================================================================

const {
  getPortalSessionMock,
  updatePortalSessionActivityMock,
  deletePortalSessionMock,
} = vi.hoisted(() => ({
  getPortalSessionMock: vi.fn(),
  updatePortalSessionActivityMock: vi.fn(async () => {}),
  deletePortalSessionMock: vi.fn(async () => {}),
}));

vi.mock("../storage", () => ({
  storage: {
    getPortalSession: getPortalSessionMock,
    updatePortalSessionActivity: updatePortalSessionActivityMock,
    deletePortalSession: deletePortalSessionMock,
  },
}));

import { validateSession } from "../services/session-store";

describe("validateSession — last-activity tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bumps last-activity for a valid, non-expired session", async () => {
    getPortalSessionMock.mockResolvedValue({
      token: "tok-active",
      caseId: "case-1",
      accessCode: "CODE-1",
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      isMirror: false,
      lastActivityAt: new Date(Date.now() - 60_000),
    });

    const session = await validateSession("tok-active");
    expect(session).not.toBeNull();

    // Fire-and-forget — flush microtasks so the .catch() chain resolves.
    await new Promise((resolve) => setImmediate(resolve));
    expect(updatePortalSessionActivityMock).toHaveBeenCalledWith("tok-active");
  });

  it("does not bump last-activity for an expired session", async () => {
    getPortalSessionMock.mockResolvedValue({
      token: "tok-expired",
      caseId: "case-1",
      accessCode: "CODE-1",
      createdAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
      isMirror: false,
      lastActivityAt: new Date(Date.now() - 120_000),
    });

    const session = await validateSession("tok-expired");
    expect(session).toBeNull();

    await new Promise((resolve) => setImmediate(resolve));
    expect(updatePortalSessionActivityMock).not.toHaveBeenCalled();
    expect(deletePortalSessionMock).toHaveBeenCalledWith("tok-expired");
  });

  it("does not bump last-activity for a missing session", async () => {
    getPortalSessionMock.mockResolvedValue(undefined);

    const session = await validateSession("tok-missing");
    expect(session).toBeNull();

    await new Promise((resolve) => setImmediate(resolve));
    expect(updatePortalSessionActivityMock).not.toHaveBeenCalled();
  });
});
