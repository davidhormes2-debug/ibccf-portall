/**
 * CI guard: server-module mock completeness
 *
 * For each module in MODULE_SPECS, every exported binding (functions and
 * const values) must appear as a key in the `vi.mock()` factory block of
 * every test file that mocks that module.  Missing keys silently fall
 * through to the real implementation (or produce an undefined stub), which
 * causes hard-to-debug test failures whenever a new export is added without
 * updating the mocks.
 *
 * Runs automatically as part of `npm test` (vitest run) because vitest.config.ts
 * already includes `scripts/**\/*.test.ts`.  Can also be run in isolation with:
 *   npm run check:emailnotify-mocks
 *
 * To add a new module to the guard:
 *   1. Add an entry to MODULE_SPECS below.
 *   2. Run the tests — any existing test file that mocks the module but is
 *      missing a new export will be caught immediately.
 */

import { readFileSync, readdirSync } from "fs";
import { join, resolve, relative } from "path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// Module guard specification
// ---------------------------------------------------------------------------

interface ModuleGuardSpec {
  /** Short name used in describe() blocks and error messages */
  displayName: string;
  /** Path components from ROOT to the source module */
  sourcePath: string[];
  /**
   * Regex to extract exported binding names from source.
   * Defaults to DEFAULT_EXPORT_RE (export function/const).
   * Must have a capture group [1] for the binding name.
   */
  exportRegex?: RegExp;
  /** Matches a vi.mock() call targeting this module */
  mockCallPattern: RegExp;
  /** Representative import path shown in fix-hint examples */
  exampleImportPath: string;
}

/**
 * Matches top-level `export [async] function NAME` and `export const NAME`
 * declarations.  Does not match `export class` or `export interface` —
 * class instances exported as `export const` are still caught, which is the
 * common pattern for singleton service exports.
 */
const DEFAULT_EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;

/**
 * Modules whose mock completeness is enforced.
 *
 * Adding an entry here is sufficient — no other changes are needed.
 * The test generator below will create one test case per
 * (module export × test file that mocks the module).
 */
const MODULE_SPECS: ModuleGuardSpec[] = [
  // ── emailNotify ──────────────────────────────────────────────────────────
  // Original guard module: every exported function/helper must be listed in
  // every test that mocks it so callers never fall through to real SMTP.
  {
    displayName: "emailNotify",
    sourcePath: ["server", "services", "emailNotify.ts"],
    mockCallPattern: /vi\.mock\(\s*["'][^"']*emailNotify["']/,
    exampleImportPath: "../services/emailNotify",
  },

  // ── EmailService ─────────────────────────────────────────────────────────
  // Singleton service instance (`emailService`).  Tests that mock
  // EmailService must include `emailService` in their factory so callers
  // never accidentally fire real SMTP.
  {
    displayName: "EmailService",
    sourcePath: ["server", "services", "EmailService.ts"],
    mockCallPattern: /vi\.mock\(\s*["'][^"']*EmailService["']/,
    exampleImportPath: "../services/EmailService",
  },

  // ── NotificationService ──────────────────────────────────────────────────
  // Singleton service instance (`notificationService`).  Tests that mock
  // NotificationService must include `notificationService` in their factory
  // so notification side-effects stay under test control.
  {
    displayName: "NotificationService",
    sourcePath: ["server", "services", "NotificationService.ts"],
    mockCallPattern: /vi\.mock\(\s*["'][^"']*NotificationService["']/,
    exampleImportPath: "../services/NotificationService",
  },
];

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Walk a directory tree and collect all *.test.ts files. */
function collectTestFiles(dir: string): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

/** Extract all binding names that match the given export regex from source. */
function extractExports(src: string, re: RegExp): string[] {
  const names: string[] = [];
  const pattern = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Return the region of `fileSrc` that starts at the vi.mock() call matching
 * `pattern` and spans the next 40 lines — ample for any factory block.
 */
function getMockRegion(fileSrc: string, pattern: RegExp): string {
  const idx = fileSrc.search(pattern);
  if (idx === -1) return "";
  const chunk = fileSrc.slice(idx);
  return chunk.split("\n").slice(0, 40).join("\n");
}

/** Return all server test files whose source contains a vi.mock() for spec. */
function getTestFilesWithMock(spec: ModuleGuardSpec): string[] {
  const serverTestFiles = collectTestFiles(join(ROOT, "server"));
  return serverTestFiles.filter((f) =>
    spec.mockCallPattern.test(readFileSync(f, "utf8")),
  );
}

// ---------------------------------------------------------------------------
// Dynamic test generation — one describe() block per module spec
// ---------------------------------------------------------------------------

for (const spec of MODULE_SPECS) {
  const sourceSrc = readFileSync(join(ROOT, ...spec.sourcePath), "utf8");
  const exportedNames = extractExports(
    sourceSrc,
    spec.exportRegex ?? DEFAULT_EXPORT_RE,
  );
  const testFiles = getTestFilesWithMock(spec);

  describe(`${spec.displayName} mock completeness`, () => {
    it(`${spec.displayName} source exports at least one binding (sanity check)`, () => {
      expect(exportedNames.length).toBeGreaterThan(0);
    });

    it(`at least one test file mocks ${spec.displayName} (sanity check)`, () => {
      expect(testFiles.length).toBeGreaterThan(0);
    });

    for (const file of testFiles) {
      const rel = relative(ROOT, file);
      const src = readFileSync(file, "utf8");
      const mockRegion = getMockRegion(src, spec.mockCallPattern);

      for (const name of exportedNames) {
        it(`${rel} — mock factory includes "${name}"`, () => {
          const keyRE = new RegExp(`\\b${name}\\b`);
          expect(
            keyRE.test(mockRegion),
            [
              `Mock factory in ${rel} is missing "${name}".`,
              ``,
              `Add "${name}" to the vi.mock() factory:`,
              ``,
              `  vi.mock("${spec.exampleImportPath}", () => ({`,
              `    ${name}: vi.fn(async () => { /* ... */ }),`,
              `    // ...other exports...`,
              `  }));`,
              ``,
              `Every export in ${spec.sourcePath.join("/")} must be listed in`,
              `every test file that mocks the module so callers never silently`,
              `fall through to the real implementation during tests.`,
            ].join("\n"),
          ).toBe(true);
        });
      }
    }
  });
}
