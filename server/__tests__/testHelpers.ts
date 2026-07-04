import { vi } from "vitest";

/**
 * Typed mock helpers for Vitest test files.
 *
 * Prefer these over `(...args: any[]) => any` declarations, which bypass
 * TypeScript's type checker and force ugly casts at call sites.
 */

// ── process.exit mock ────────────────────────────────────────────────────────

/**
 * Type for a `vi.fn()` mock of `process.exit`.
 *
 * `process.exit` is typed `(code?: number | string | null) => never`, so any
 * mock variable that is passed in its place must satisfy that signature.
 * Intersecting with `ReturnType<typeof vi.fn>` preserves the full Vitest mock
 * API (`.mock`, `.mockImplementation`, `.toHaveBeenCalledWith`, etc.).
 *
 * Usage:
 *   let mockExit: ProcessExitMock;
 *   beforeEach(() => { mockExit = createProcessExitMock(); });
 *   emitStartupSecurityWarnings(mockStorage, mockExit);
 */
export type ProcessExitMock = ((_code?: number | string | null) => never) &
  ReturnType<typeof vi.fn>;

/**
 * Creates a fresh `ProcessExitMock` for each test.
 *
 * The implementation returns `undefined as never` so TypeScript is satisfied
 * even though `process.exit` normally diverges; in tests we capture the call
 * instead of actually terminating the process.
 */
export function createProcessExitMock(): ProcessExitMock {
  return vi.fn(
    (_code?: number | string | null) => undefined as never,
  ) as ProcessExitMock;
}
