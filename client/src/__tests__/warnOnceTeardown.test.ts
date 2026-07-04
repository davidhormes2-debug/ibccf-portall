import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ============================================================================
// Source-assertion: warnOnce dedup reset in test teardown (client-side scan)
//
// WHY THIS TEST EXISTS
// `warnOnce` in `server/lib/warnOnce.ts` deduplicates repeated warn messages
// using a module-level Map with a 60-second TTL. If a client-side test file
// ever imports `warnOnce` (or a future client-local equivalent) without fully
// mocking the module, the dedup Map will suppress warn calls that a subsequent
// test within the same 60-second window expects — a subtle cross-test bleed
// that produces flaky assertion failures.
//
// `__resetWarnDedupForTests()` exists solely to clear that map before each
// test, but callers must remember to invoke it in `beforeEach`. This test
// ensures no future client test file silently forgets:
//
//   Any test file that REFERENCES `warnOnce` without fully mocking the module
//   MUST also contain an invocation of `__resetWarnDedupForTests(`.
//
// WHAT COUNTS AS "FULLY MOCKED"
// Files that do `vi.mock(…/lib/warnOnce…)` (single or double quotes, with or
// without trailing content) replace the real module entirely — the dedup Map
// is never touched, so no reset is required. Those files are excluded.
//
// SCOPE
// The scan covers all `*.test.ts` and `*.test.tsx` files under `client/`
// recursively, matching the Vitest `include` glob from vitest.config.ts
// (`client/**/*.test.{ts,tsx}`).
// ============================================================================

const CLIENT_ROOT = path.resolve(__dirname, "../..");

// Recursively collect all *.test.ts and *.test.tsx files under a directory.
function collectTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
    ) {
      results.push(full);
    }
  }
  return results;
}

// Detects a full vi.mock of the warnOnce module, using either quote style.
// Matches: vi.mock('./lib/warnOnce', …) / vi.mock("../lib/warnOnce") / etc.
const FULL_MOCK_RE = /vi\.mock\(['"]([^'"]*\/lib\/warnOnce)['"]/;

describe("warnOnce dedup-reset teardown guard (client)", () => {
  it("every client test file that uses warnOnce without a full vi.mock also invokes __resetWarnDedupForTests()", () => {
    const thisFile = path.resolve(__filename);

    const files = collectTestFiles(CLIENT_ROOT).filter(
      // Exclude this source-assertion file itself — it references "warnOnce"
      // in string literals and comments for documentation, not as a runtime dep.
      (f) => f !== thisFile,
    );

    const violators: string[] = [];

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf-8");

      const mentionsWarnOnce = source.includes("warnOnce");
      const hasFullMock = FULL_MOCK_RE.test(source);
      // Require a call (opening paren), not just the symbol being mentioned.
      const hasResetCall = source.includes("__resetWarnDedupForTests(");

      if (mentionsWarnOnce && !hasFullMock && !hasResetCall) {
        violators.push(path.relative(CLIENT_ROOT, filePath));
      }
    }

    expect(
      violators,
      [
        "The following client test files reference warnOnce without a full vi.mock but do",
        "not invoke __resetWarnDedupForTests() — add it to beforeEach to prevent the",
        "60-second dedup window from bleeding across tests:",
        ...violators.map((f) => `  client/${f}`),
      ].join("\n"),
    ).toEqual([]);
  });
});
