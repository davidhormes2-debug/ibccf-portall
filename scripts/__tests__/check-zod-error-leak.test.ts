/**
 * Tests for scripts/check-zod-error-leak.sh
 *
 * Each test creates a minimal "repo" temp directory with the following layout:
 *
 *   <tmpdir>/
 *     scripts/
 *       check-zod-error-leak.sh  → symlink to the real script
 *     server/
 *       fixture.ts               → TypeScript fixture content under test
 *
 * Because the script derives REPO_ROOT as the parent of its own `scripts/`
 * directory, this layout makes it scan only the fixture files — the real
 * project source is never touched during testing.
 *
 * Cases covered:
 *
 *   Pass A — whole-array / direct property forwarding (same-line):
 *     1. .errors forwarded directly in .json() → must exit 1.
 *     2. .issues forwarded directly in .json() → must exit 1.
 *     3. Same-line with suppression annotation → must exit 0.
 *     4. Safe indexed access .errors[0].message on same line → must exit 0.
 *
 *   Pass B — spread-based forwarding:
 *     5. ...err.errors spread inside .json() → must exit 1.
 *     6. ...parsed.error.issues spread inside .json() → must exit 1.
 *     7. Spread violation suppressed with // zod-error-leak-ok → must exit 0.
 *
 *   Pass C — multi-line / dataflow forwarding:
 *     8.  Variable assigned from .errors, forwarded through .json() next line → exit 1.
 *     9.  Suppressed assignment line → exit 0.
 *     10. Safe indexed access (.errors[0].message) across two lines → exit 0.
 *     11. Multi-line violation with .issues → exit 1.
 *     12. Suppressed .issues assignment line → exit 0.
 *     13. Safe indexed access (.issues[0].message) across two lines → exit 0.
 *
 *   Pass D — helper-function / intermediate-call forwarding:
 *     14. Named function returns .errors array; .json() calls it → exit 1.
 *     15. Arrow function returns .issues array; .json() calls it → exit 1.
 *     16. Helper function suppressed with // zod-error-leak-ok on return → exit 0.
 */

import { execFileSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

const REAL_SCRIPT = path.resolve(__dirname, "..", "check-zod-error-leak.sh");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * Create an isolated repo skeleton in a fresh temp directory.
 * Returns a `run(fixtureContent)` function bound to that directory
 * and a `cleanup()` function to remove it when done.
 *
 * Each concurrent test calls this to get its own environment so tests
 * never share tmpDir state.
 */
function createFixtureEnv(): {
  run: (fixtureContent: string) => RunResult;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zod-leak-test-"));
  const scriptsDir = path.join(tmpDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.symlinkSync(REAL_SCRIPT, path.join(scriptsDir, "check-zod-error-leak.sh"));

  const serverDir = path.join(tmpDir, "server");
  fs.mkdirSync(serverDir, { recursive: true });

  fs.mkdirSync(path.join(tmpDir, "shared"), { recursive: true });

  function run(fixtureContent: string): RunResult {
    fs.writeFileSync(path.join(serverDir, "fixture.ts"), fixtureContent, "utf8");

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      stdout = execFileSync(
        "bash",
        [path.join(tmpDir, "scripts", "check-zod-error-leak.sh")],
        { encoding: "utf8" },
      );
    } catch (err: unknown) {
      const e = err as SpawnSyncReturns<string> & {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      exitCode = typeof e.status === "number" ? e.status : 1;
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
    }

    return { exitCode, stdout, stderr, output: stdout + stderr };
  }

  function cleanup() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { run, cleanup };
}

describe("check-zod-error-leak.sh", () => {
  // ===========================================================================
  // Pass A — whole-array / direct property forwarding (same line)
  // ===========================================================================

  // -------------------------------------------------------------------------
  // Case 1: Pass A violation — .errors on the same line as .json()
  // -------------------------------------------------------------------------
  it.concurrent("Pass A: flags .errors forwarded directly inside .json() on the same line", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ error: err.errors });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 2: Pass A violation — .issues on the same line as .json()
  // -------------------------------------------------------------------------
  it.concurrent("Pass A: flags .issues forwarded directly inside .json() on the same line", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ details: parseResult.error.issues });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 3: Pass A suppression — annotation on the same line clears the flag
  // -------------------------------------------------------------------------
  it.concurrent("Pass A: does not flag a same-line violation annotated with // zod-error-leak-ok", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ error: err.errors }); // zod-error-leak-ok
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 4: Pass A safe — indexed access on the same line is not a violation
  // -------------------------------------------------------------------------
  it.concurrent("Pass A: does not flag safe indexed access .errors[0].message on the same line as .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ error: err.errors[0].message });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 5: Pass A — same-line violation reported exactly once (no double-
  // counting between Pass A and Pass C, which explicitly skips same-line cases)
  // -------------------------------------------------------------------------
  it.concurrent("Pass A: flags a same-line violation exactly once (Pass C does not double-report)", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ error: err.errors });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);

      // Count fixture.ts lines in stderr — must be exactly one.
      const fixtureLines = result.stderr
        .split("\n")
        .filter((line) => line.includes("fixture.ts"));
      expect(fixtureLines).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  // ===========================================================================
  // Pass B — spread-based forwarding
  // ===========================================================================

  // -------------------------------------------------------------------------
  // Case 6: Pass B violation — ...err.errors spread inside .json()
  // -------------------------------------------------------------------------
  it.concurrent("Pass B: flags ...err.errors spread directly inside .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ ...err.errors });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 7: Pass B violation — ...parseResult.error.issues spread inside .json()
  // -------------------------------------------------------------------------
  it.concurrent("Pass B: flags ...parsed.error.issues spread directly inside .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, parsed: any) {
  res.status(400).json({ ...parsed.error.issues });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 8: Pass B suppression — annotation on the spread line clears the flag
  // -------------------------------------------------------------------------
  it.concurrent("Pass B: does not flag a spread violation annotated with // zod-error-leak-ok", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json({ ...err.errors }); // zod-error-leak-ok
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // ===========================================================================
  // Pass C — multi-line / dataflow forwarding
  // ===========================================================================

  // -------------------------------------------------------------------------
  // Case 9: Pass C violation — .errors assigned to variable, forwarded via .json()
  // -------------------------------------------------------------------------
  it.concurrent("Pass C: flags a multi-line violation where .errors is assigned to a variable then forwarded through .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  const body = { error: err.errors };
  res.status(400).json(body);
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 10: Pass C suppression — annotation on the assignment line
  // -------------------------------------------------------------------------
  it.concurrent("Pass C: does not flag a multi-line pattern suppressed with // zod-error-leak-ok", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  const body = { error: err.errors }; // zod-error-leak-ok
  res.status(400).json(body);
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 11: Pass C safe — indexed access (.errors[0].message) across two lines
  // -------------------------------------------------------------------------
  it.concurrent("Pass C: does not flag safe indexed access (.errors[0].message) even when forwarded through .json() on the next line", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  const msg = err.errors[0].message;
  res.status(400).json({ error: msg });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 11: Pass C violation — .issues across two lines
  // -------------------------------------------------------------------------
  it.concurrent("Pass C: flags a multi-line violation where .issues is assigned to a variable then forwarded through .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  const body = { details: err.issues };
  res.status(400).json(body);
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 12: Pass C suppression — annotation on the .issues assignment line
  // -------------------------------------------------------------------------
  it.concurrent("Pass C: does not flag a multi-line .issues violation suppressed with // zod-error-leak-ok on the assignment line", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  const body = { details: err.issues }; // zod-error-leak-ok
  res.status(400).json(body);
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 13: Pass C safe — indexed access (.issues[0].message) across two lines
  // -------------------------------------------------------------------------
  it.concurrent("Pass C: does not flag safe indexed access (.issues[0].message) even when forwarded through .json() on the next line", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

export function handler(req: Request, res: Response, err: any) {
  const msg = err.issues[0].message;
  res.status(400).json({ error: msg });
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });

  // ===========================================================================
  // Pass D — helper-function / intermediate-call forwarding
  // ===========================================================================

  // -------------------------------------------------------------------------
  // Case 14: Pass D violation — named function returns .errors; .json() calls it
  // -------------------------------------------------------------------------
  it.concurrent("Pass D: flags a named helper function that returns .errors when its result is passed to .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

function makeErr(e: any) {
  return { error: e.errors };
}

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json(makeErr(err));
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 15: Pass D violation — arrow function returns .issues; .json() calls it
  // -------------------------------------------------------------------------
  it.concurrent("Pass D: flags an arrow function that returns .issues when its result is passed to .json()", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

const buildBody = (r: any) => ({ details: r.error.issues });

export function handler(req: Request, res: Response, parsed: any) {
  res.status(400).json(buildBody(parsed));
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/fixture\.ts/);
    } finally {
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Case 16: Pass D suppression — annotation on the return line in the helper
  // -------------------------------------------------------------------------
  it.concurrent("Pass D: does not flag a helper function whose return is annotated with // zod-error-leak-ok", async () => {
    const { run, cleanup } = createFixtureEnv();
    try {
      const fixture = `
import { Request, Response } from "express";

function makeErr(e: any) {
  return { error: e.errors }; // zod-error-leak-ok
}

export function handler(req: Request, res: Response, err: any) {
  res.status(400).json(makeErr(err));
}
`.trimStart();

      const result = run(fixture);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/no raw ZodError forwarding found/);
    } finally {
      cleanup();
    }
  });
});
