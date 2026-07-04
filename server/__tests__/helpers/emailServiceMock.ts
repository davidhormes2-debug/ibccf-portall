import { vi } from "vitest";

/**
 * Builds a resilient mock for `server/services/EmailService`'s `emailService`
 * singleton, mirroring `createStorageMock` (see `./storageMock.ts`).
 *
 * The problem this solves: `EmailService` is routinely extended with new
 * `send*`/`build*` methods, and routes/services under test call them as part
 * of best-effort, non-blocking email dispatch (wrapped in try/catch). A
 * hand-written mock listing only the methods a test currently knows about
 * silently produces `emailService.someNewMethod is not a function` inside
 * that try/catch — the error is swallowed instead of surfacing as a clear
 * test failure, exactly like the missing `sendAccountReactivationNotification`
 * stub that originally motivated this helper.
 *
 * `createEmailServiceMock` returns a Proxy: any method the code under test
 * reaches for that the test did NOT explicitly override is auto-stubbed as a
 * `vi.fn()` that resolves to `undefined` (a safe no-op for a best-effort send).
 * Explicit `overrides` always win, so tests keep full control over the
 * behavior they actually assert on.
 *
 * Usage inside a `vi.mock` factory:
 *
 *   vi.mock("../services/EmailService", () => ({
 *     emailService: createEmailServiceMock({
 *       sendCaseEmailFailureAlert: vi.fn(async (opts) => {
 *         sendCalls.push(opts);
 *       }),
 *     }),
 *   }));
 *
 * Because the overrides object is read on every access, mutating the override
 * `vi.fn()`s (or the closure variables they read) after construction still works.
 */
export function createEmailServiceMock<T extends Record<string, any>>(
  overrides: T = {} as T,
): Record<string, any> {
  const autoStubs = new Map<string | symbol, ReturnType<typeof vi.fn>>();

  return new Proxy({} as Record<string | symbol, any>, {
    get(_target, prop) {
      if (prop in overrides) {
        return (overrides as Record<string | symbol, any>)[prop];
      }
      if (typeof prop === "symbol") {
        return undefined;
      }
      let stub = autoStubs.get(prop);
      if (!stub) {
        stub = vi.fn(async () => undefined);
        autoStubs.set(prop, stub);
      }
      return stub;
    },
    has(_target, prop) {
      return prop in overrides || autoStubs.has(prop);
    },
  });
}
