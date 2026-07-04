import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkHasActiveSession,
  buildRotateAccessCodeConfirmMessage,
  buildLockAccountConfirmMessage,
  buildForceLogoutConfirmMessage,
  buildResetPinConfirmMessage,
  postAccessCodeAction,
} from "../rotateAccessCodeSession";

describe("buildLockAccountConfirmMessage", () => {
  it("uses the stronger active-session warning when the user is mid-session", () => {
    const msg = buildLockAccountConfirmMessage("Jane Doe", {
      hasActiveSession: true,
      lastActivityAt: null,
    });
    expect(msg).toContain("Jane Doe");
    expect(msg).toMatch(/currently active in the portal/i);
    expect(msg).toMatch(/sign them out immediately/i);
  });

  it("includes the last-active detail when a timestamp is available", () => {
    const msg = buildLockAccountConfirmMessage("Jane Doe", {
      hasActiveSession: true,
      lastActivityAt: new Date(Date.now() - 5 * 60000).toISOString(),
    });
    expect(msg).toMatch(/last active 5 minutes ago/i);
  });

  it("falls back to the plain confirmation when there is no active session", () => {
    const msg = buildLockAccountConfirmMessage("Jane Doe", {
      hasActiveSession: false,
      lastActivityAt: null,
    });
    expect(msg).toContain("Jane Doe");
    expect(msg).not.toMatch(/currently active in the portal/i);
  });
});

describe("buildForceLogoutConfirmMessage", () => {
  it("uses the stronger active-session warning when the user is mid-session", () => {
    const msg = buildForceLogoutConfirmMessage("Jane Doe", {
      hasActiveSession: true,
      lastActivityAt: null,
    });
    expect(msg).toContain("Jane Doe");
    expect(msg).toMatch(/currently active in the portal/i);
  });

  it("includes the last-active detail when a timestamp is available", () => {
    const msg = buildForceLogoutConfirmMessage("Jane Doe", {
      hasActiveSession: true,
      lastActivityAt: new Date(Date.now() - 5 * 60000).toISOString(),
    });
    expect(msg).toMatch(/last active 5 minutes ago/i);
  });

  it("falls back to the plain confirmation when there is no active session", () => {
    const msg = buildForceLogoutConfirmMessage("Jane Doe", {
      hasActiveSession: false,
      lastActivityAt: null,
    });
    expect(msg).toContain("Jane Doe");
    expect(msg).not.toMatch(/currently active in the portal/i);
  });
});

describe("buildResetPinConfirmMessage", () => {
  it("uses the stronger active-session warning when the user is mid-session", () => {
    const msg = buildResetPinConfirmMessage("Jane Doe", {
      hasActiveSession: true,
      lastActivityAt: null,
    });
    expect(msg).toContain("Jane Doe");
    expect(msg).toMatch(/currently active in the portal/i);
    expect(msg).toMatch(/log them out immediately/i);
  });

  it("includes the last-active detail when a timestamp is available", () => {
    const msg = buildResetPinConfirmMessage("Jane Doe", {
      hasActiveSession: true,
      lastActivityAt: new Date(Date.now() - 5 * 60000).toISOString(),
    });
    expect(msg).toMatch(/last active 5 minutes ago/i);
  });

  it("falls back to the plain confirmation when there is no active session", () => {
    const msg = buildResetPinConfirmMessage("Jane Doe", {
      hasActiveSession: false,
      lastActivityAt: null,
    });
    expect(msg).toContain("Jane Doe");
    expect(msg).not.toMatch(/currently active in the portal/i);
  });
});

describe("checkHasActiveSession", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns true when the endpoint reports an active session", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ hasActiveSession: true, lastActivityAt: "2026-07-01T00:00:00.000Z" }),
    })) as unknown as typeof fetch;

    await expect(checkHasActiveSession("case-1", "tok")).resolves.toEqual({
      hasActiveSession: true,
      lastActivityAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("returns false when the request fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(checkHasActiveSession("case-1", "tok")).resolves.toEqual({
      hasActiveSession: false,
      lastActivityAt: null,
    });
  });

  it("returns false when the response is not ok", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(checkHasActiveSession("case-1", "tok")).resolves.toEqual({
      hasActiveSession: false,
      lastActivityAt: null,
    });
  });
});

describe("buildRotateAccessCodeConfirmMessage (existing behavior unchanged)", () => {
  it("still warns about an active session", () => {
    expect(
      buildRotateAccessCodeConfirmMessage("Jane Doe", { hasActiveSession: true, lastActivityAt: null }),
    ).toMatch(/currently active/i);
  });
});

describe("postAccessCodeAction", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the parsed body on success", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ accessCode: "NEW-CODE" }),
    })) as unknown as typeof fetch;

    const onFail = vi.fn();
    const result = await postAccessCodeAction("case-1", "tok", "rotate-access-code", "Failed", onFail);
    expect(result).toEqual({ accessCode: "NEW-CODE" });
    expect(onFail).not.toHaveBeenCalled();
  });

  it("calls onFail and returns null on a non-ok response", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as typeof fetch;

    const onFail = vi.fn();
    const result = await postAccessCodeAction("case-1", "tok", "reset-pin", "Failed", onFail);
    expect(result).toBeNull();
    expect(onFail).toHaveBeenCalledWith("Failed", "boom");
  });
});
