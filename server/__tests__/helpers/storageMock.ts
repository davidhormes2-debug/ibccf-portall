import { vi } from "vitest";

/**
 * Builds a resilient mock for `server/storage`'s `storage` object.
 *
 * The problem this solves: route handlers (e.g. `server/routes/deposits.ts`)
 * are routinely extended to call additional `storage.*` methods. A hand-written
 * mock that only lists the methods a test currently knows about will throw
 * `storage.someNewMethod is not a function` the moment the route adds a call,
 * surfacing as an opaque 500 in the test instead of a clear assertion failure.
 *
 * `createStorageMock` returns a Proxy: any method the route reaches for that the
 * test did NOT explicitly override is auto-stubbed as a `vi.fn()` that resolves
 * to `undefined` (a safe no-op for async DB calls). Explicit `overrides` always
 * win, so tests keep full control over the behavior they actually assert on.
 *
 * Usage inside a `vi.mock` factory:
 *
 *   vi.mock("../storage", () => ({
 *     storage: createStorageMock({
 *       getDepositReceiptById: vi.fn(async () => receiptRow),
 *     }),
 *   }));
 *
 * Because the overrides object is read on every access, mutating the override
 * `vi.fn()`s (or the closure variables they read) after construction still works.
 */
export function createStorageMock<T extends Record<string, any>>(
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
