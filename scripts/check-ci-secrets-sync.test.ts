/**
 * Tests for scripts/check-ci-secrets-sync.sh
 *
 * Each test writes minimal fixture files to a temporary directory, then
 * invokes the sync script with WORKFLOW_FILE / DOCS_FILE / SERVER_ENV_FILE
 * overridden to point at those fixtures.  We assert both the exit code and
 * that key diagnostic phrases appear (or are absent) in the combined output.
 */

import { execFileSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "check-ci-secrets-sync.sh");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

function run(env: Record<string, string>): RunResult {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync("bash", [SCRIPT], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  } catch (err: unknown) {
    const e = err as SpawnSyncReturns<string> & { status?: number; stdout?: string; stderr?: string };
    exitCode = typeof e.status === "number" ? e.status : 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }
  return { exitCode, stdout, stderr, output: stdout + stderr };
}

function workflowFixture(
  secrets: string[],
  count: number = secrets.length
): string {
  const secretLine = secrets.join(" ");
  return `
jobs:
  validate-secrets:
    name: Validate Required Secrets
    steps:
      - name: Check all required secrets are present
        run: |
          secrets=(${secretLine})
          echo "All ${count} required secrets are present."
`;
}

function docsFixture(
  secrets: string[],
  count: number = secrets.length
): string {
  const rows = secrets
    .map((s) => `| \`${s}\` | description | example | where |`)
    .join("\n");
  return `
# CI Setup

The smoke test requires **${count} GitHub repository secrets**.

## Required secrets

| Secret name | Description | Example value | Where to obtain |
|---|---|---|---|
${rows}

## Next section
`;
}

function serverEnvFixture(secrets: string[]): string {
  const refs = secrets.map((s) => `  const _${s} = process.env.${s};`).join("\n");
  return `
export function validateEnv() {
${refs}
}
`;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmp(filename: string, content: string): string {
  const fullPath = path.join(tmpDir, filename);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

function makeEnv(
  workflowContent: string,
  docsContent: string,
  serverContent: string
): Record<string, string> {
  return {
    WORKFLOW_FILE: writeTmp("smoke-test.yml", workflowContent),
    DOCS_FILE: writeTmp("CI_SETUP.md", docsContent),
    SERVER_ENV_FILE: writeTmp("env.ts", serverContent),
  };
}

describe("check-ci-secrets-sync.sh", () => {
  const BASE = ["DATABASE_URL", "SESSION_SECRET", "ADMIN_PASSWORD"];

  describe("happy path", () => {
    it("exits 0 when all three sources agree", () => {
      const env = makeEnv(
        workflowFixture(BASE),
        docsFixture(BASE),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("All checks passed");
    });
  });

  describe("workflow vs docs drift", () => {
    it("exits 1 when a secret is only in the workflow (missing from docs)", () => {
      const workflowSecrets = [...BASE, "EXTRA_SECRET"];
      const env = makeEnv(
        workflowFixture(workflowSecrets, workflowSecrets.length),
        docsFixture(BASE, BASE.length),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("DRIFT DETECTED");
      expect(result.output).toContain("EXTRA_SECRET");
      expect(result.output).toMatch(/MISSING from.*CI_SETUP\.md|MISSING from.*DOCS_FILE/i);
    });

    it("exits 1 when a secret is only in docs (missing from workflow)", () => {
      const docsSecrets = [...BASE, "DOCS_ONLY_SECRET"];
      const env = makeEnv(
        workflowFixture(BASE, BASE.length),
        docsFixture(docsSecrets, docsSecrets.length),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("DRIFT DETECTED");
      expect(result.output).toContain("DOCS_ONLY_SECRET");
      expect(result.output).toMatch(/MISSING from.*smoke-test\.yml|MISSING from.*WORKFLOW_FILE/i);
    });
  });

  describe("server env vs workflow drift", () => {
    it("exits 1 when a secret is only in server/env.ts (missing from workflow)", () => {
      const serverSecrets = [...BASE, "SERVER_ONLY_SECRET"];
      const env = makeEnv(
        workflowFixture(BASE, BASE.length),
        docsFixture(BASE, BASE.length),
        serverEnvFixture(serverSecrets)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("DRIFT DETECTED");
      expect(result.output).toContain("SERVER_ONLY_SECRET");
      expect(result.output).toMatch(
        /MISSING from.*smoke-test\.yml|MISSING from.*WORKFLOW_FILE/i
      );
    });

    it("exits 1 when a secret is in docs+workflow but missing from server/env.ts validateEnv()", () => {
      const workflowAndDocSecrets = [...BASE, "DOCS_WORKFLOW_ONLY"];
      const env = makeEnv(
        workflowFixture(workflowAndDocSecrets, workflowAndDocSecrets.length),
        docsFixture(workflowAndDocSecrets, workflowAndDocSecrets.length),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("DRIFT DETECTED");
      expect(result.output).toContain("DOCS_WORKFLOW_ONLY");
      expect(result.output).toMatch(/NOT validated by validateEnv/i);
    });

    it("exits 0 when a docs+workflow secret is exempted via DOCS_NOT_STARTUP_VALIDATED", () => {
      const workflowAndDocSecrets = [...BASE, "DEPLOY_URL"];
      const env = {
        ...makeEnv(
          workflowFixture(workflowAndDocSecrets, workflowAndDocSecrets.length),
          docsFixture(workflowAndDocSecrets, workflowAndDocSecrets.length),
          serverEnvFixture(BASE)
        ),
        DOCS_NOT_STARTUP_VALIDATED: "DEPLOY_URL",
      };
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("All checks passed");
    });
  });

  describe("hardcoded count mismatches", () => {
    it("exits 1 when the docs count is wrong", () => {
      const wrongCount = BASE.length + 5;
      const env = makeEnv(
        workflowFixture(BASE),
        docsFixture(BASE, wrongCount),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("COUNT MISMATCH");
      expect(result.output).toContain(String(wrongCount));
    });

    it("exits 1 when the workflow echo count is wrong", () => {
      const wrongCount = BASE.length + 99;
      const env = makeEnv(
        workflowFixture(BASE, wrongCount),
        docsFixture(BASE),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("COUNT MISMATCH");
      expect(result.output).toContain(String(wrongCount));
    });
  });

  describe("ALLOW_* and NODE_ENV vars are excluded from server secrets", () => {
    it("does not flag ALLOW_WEAK_* or NODE_ENV as missing from workflow", () => {
      const serverSecrets = [...BASE, "ALLOW_WEAK_SESSION_SECRET", "NODE_ENV", "PORT"];
      const env = makeEnv(
        workflowFixture(BASE),
        docsFixture(BASE),
        serverEnvFixture(serverSecrets)
      );
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("ALLOW_WEAK_SESSION_SECRET");
      expect(result.output).not.toContain("NODE_ENV");
    });
  });

  describe("missing source files", () => {
    it("exits 1 with an error when the workflow file is missing", () => {
      const env = {
        WORKFLOW_FILE: path.join(tmpDir, "nonexistent.yml"),
        DOCS_FILE: writeTmp("CI_SETUP.md", docsFixture(BASE)),
        SERVER_ENV_FILE: writeTmp("env.ts", serverEnvFixture(BASE)),
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/ERROR.*not found/i);
    });

    it("exits 1 with an error when the docs file is missing", () => {
      const env = {
        WORKFLOW_FILE: writeTmp("smoke-test.yml", workflowFixture(BASE)),
        DOCS_FILE: path.join(tmpDir, "nonexistent.md"),
        SERVER_ENV_FILE: writeTmp("env.ts", serverEnvFixture(BASE)),
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/ERROR.*not found/i);
    });

    it("exits 1 with an error when the server env file is missing", () => {
      const env = {
        WORKFLOW_FILE: writeTmp("smoke-test.yml", workflowFixture(BASE)),
        DOCS_FILE: writeTmp("CI_SETUP.md", docsFixture(BASE)),
        SERVER_ENV_FILE: path.join(tmpDir, "nonexistent.ts"),
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/ERROR.*not found/i);
    });
  });

  describe("inverse-gap check (docs secret not validated at startup)", () => {
    // A fresh dummy secret that is NOT in the default DOCS_NOT_STARTUP_VALIDATED
    // list and NOT referenced inside validateEnv() — simulates a developer who
    // documented and wired up a secret in the workflow but forgot to add a
    // startup check.
    const DUMMY = "DUMMY_XYZ_SECRET";

    it("exits 1 with 'NOT validated by validateEnv' when a documented secret has no validateEnv() ref and no exclusion entry", () => {
      const allSecrets = [...BASE, DUMMY];
      const env = makeEnv(
        workflowFixture(allSecrets, allSecrets.length),
        docsFixture(allSecrets, allSecrets.length),
        serverEnvFixture(BASE) // DUMMY is intentionally absent from validateEnv()
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("DRIFT DETECTED");
      expect(result.output).toContain(DUMMY);
      expect(result.output).toMatch(/NOT validated by validateEnv/i);
    });

    it("exits 0 when the same dummy secret is present in DOCS_NOT_STARTUP_VALIDATED", () => {
      const allSecrets = [...BASE, DUMMY];
      const env = {
        ...makeEnv(
          workflowFixture(allSecrets, allSecrets.length),
          docsFixture(allSecrets, allSecrets.length),
          serverEnvFixture(BASE) // DUMMY still absent from validateEnv() — exclusion covers it
        ),
        // Override the exclusion list via the env var supported by the script
        DOCS_NOT_STARTUP_VALIDATED: DUMMY,
      };
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("All checks passed");
      expect(result.output).not.toContain("NOT validated by validateEnv");
    });
  });

  describe("multiple simultaneous drift sources", () => {
    it("reports all drift sources in one run", () => {
      const workflowSecrets = [...BASE, "WORKFLOW_ONLY"];
      const docsSecrets = [...BASE, "DOCS_ONLY"];
      const serverSecrets = [...BASE, "SERVER_ONLY"];
      const env = makeEnv(
        workflowFixture(workflowSecrets, workflowSecrets.length),
        docsFixture(docsSecrets, docsSecrets.length),
        serverEnvFixture(serverSecrets)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("DRIFT DETECTED");
      expect(result.output).toContain("SERVER_ONLY");
    });
  });

  describe("TODO placeholder check", () => {
    function docsFixtureWithTodoRow(
      fullyFilledSecrets: string[],
      skeletonSecrets: string[]
    ): string {
      const filledRows = fullyFilledSecrets
        .map((s) => `| \`${s}\` | description | example | where |`)
        .join("\n");
      const skeletonRows = skeletonSecrets
        .map(
          (s) =>
            `| \`${s}\` | _TODO: description | _TODO: example value | _TODO: where to obtain |`
        )
        .join("\n");
      const allSecrets = [...fullyFilledSecrets, ...skeletonSecrets];
      return `
# CI Setup

The smoke test requires **${allSecrets.length} GitHub repository secrets**.

## Required secrets

| Secret name | Description | Example value | Where to obtain |
|---|---|---|---|
${filledRows}
${skeletonRows}

## Next section
`;
    }

    it("exits 1 with 'TODO PLACEHOLDERS FOUND' when a Required secrets row still contains _TODO:", () => {
      const skeletonSecret = "NEW_AUTO_INSERTED_SECRET";
      const allSecrets = [...BASE, skeletonSecret];
      const env = makeEnv(
        workflowFixture(allSecrets, allSecrets.length),
        docsFixtureWithTodoRow(BASE, [skeletonSecret]),
        serverEnvFixture(allSecrets)
      );
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("TODO PLACEHOLDERS FOUND");
      expect(result.output).toContain("_TODO:");
    });

    it("exits 0 when all Required secrets rows are fully filled in (no _TODO: placeholders)", () => {
      const env = makeEnv(
        workflowFixture(BASE),
        docsFixture(BASE),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(
        "No _TODO: placeholders found in the Required secrets table"
      );
      expect(result.output).not.toContain("TODO PLACEHOLDERS FOUND");
    });
  });

  describe("DOCS_NOT_STARTUP_VALIDATED comment enforcement (Pass E)", () => {
    function exclusionListFixture(
      tokens: string[],
      commentedTokens: string[]
    ): string {
      const comments = commentedTokens
        .map((t) => `# ${t} — test reason for exclusion`)
        .join("\n");
      const list = tokens.join(" ");
      return [
        comments,
        `DOCS_NOT_STARTUP_VALIDATED="\${DOCS_NOT_STARTUP_VALIDATED:-${list}}"`,
        "",
      ].join("\n");
    }

    it("exits 1 when a token in the built-in list has no comment line", () => {
      const tokens = ["COMMENTED_TOKEN", "BARE_TOKEN"];
      const exclusionFile = writeTmp(
        "exclusion-list.sh",
        exclusionListFixture(tokens, ["COMMENTED_TOKEN"])
      );
      const env = {
        ...makeEnv(
          workflowFixture(BASE),
          docsFixture(BASE),
          serverEnvFixture(BASE)
        ),
        EXCLUSION_LIST_FILE: exclusionFile,
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("EXCLUSION COMMENT MISSING");
      expect(result.output).toContain("BARE_TOKEN");
      expect(result.output).not.toContain("COMMENTED_TOKEN");
    });

    it("exits 1 when ALL tokens in the built-in list are bare (no comments)", () => {
      const tokens = ["ALPHA_SECRET", "BETA_SECRET"];
      const exclusionFile = writeTmp(
        "exclusion-list.sh",
        exclusionListFixture(tokens, [])
      );
      const env = {
        ...makeEnv(
          workflowFixture(BASE),
          docsFixture(BASE),
          serverEnvFixture(BASE)
        ),
        EXCLUSION_LIST_FILE: exclusionFile,
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("EXCLUSION COMMENT MISSING");
      expect(result.output).toContain("ALPHA_SECRET");
      expect(result.output).toContain("BETA_SECRET");
    });

    it("exits 0 when all tokens in the built-in list have a comment line", () => {
      const tokens = ["TOKEN_ONE", "TOKEN_TWO"];
      const exclusionFile = writeTmp(
        "exclusion-list.sh",
        exclusionListFixture(tokens, tokens)
      );
      const env = {
        ...makeEnv(
          workflowFixture(BASE),
          docsFixture(BASE),
          serverEnvFixture(BASE)
        ),
        EXCLUSION_LIST_FILE: exclusionFile,
      };
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("All checks passed");
      expect(result.output).not.toContain("EXCLUSION COMMENT MISSING");
    });

    it("exits 0 for the real script file — all built-in exclusions are commented", () => {
      const env = makeEnv(
        workflowFixture(BASE),
        docsFixture(BASE),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("EXCLUSION COMMENT MISSING");
    });
  });

  describe("NON_SECRET_ENV_VARS comment enforcement (Pass F)", () => {
    function nonSecretListFixture(
      tokens: string[],
      commentedTokens: string[]
    ): string {
      const comments = commentedTokens
        .map((t) => `# ${t} — test reason for non-secret`)
        .join("\n");
      const list = tokens.join(" ");
      return [
        comments,
        `NON_SECRET_ENV_VARS="\${NON_SECRET_ENV_VARS:-${list}}"`,
        "",
      ].join("\n");
    }

    it("exits 1 when a token in the built-in list has no comment line", () => {
      const tokens = ["COMMENTED_VAR", "BARE_VAR"];
      const nonSecretFile = writeTmp(
        "non-secret-list.sh",
        nonSecretListFixture(tokens, ["COMMENTED_VAR"])
      );
      const env = {
        ...makeEnv(
          workflowFixture(BASE),
          docsFixture(BASE),
          serverEnvFixture(BASE)
        ),
        NON_SECRET_ENV_VARS_FILE: nonSecretFile,
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("NON_SECRET COMMENT MISSING");
      expect(result.output).toContain("BARE_VAR");
      expect(result.output).not.toContain("COMMENTED_VAR");
    });

    it("exits 1 when ALL tokens in the built-in list are bare (no comments)", () => {
      const tokens = ["ALPHA_VAR", "BETA_VAR"];
      const nonSecretFile = writeTmp(
        "non-secret-list.sh",
        nonSecretListFixture(tokens, [])
      );
      const env = {
        ...makeEnv(
          workflowFixture(BASE),
          docsFixture(BASE),
          serverEnvFixture(BASE)
        ),
        NON_SECRET_ENV_VARS_FILE: nonSecretFile,
      };
      const result = run(env);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("NON_SECRET COMMENT MISSING");
      expect(result.output).toContain("ALPHA_VAR");
      expect(result.output).toContain("BETA_VAR");
    });

    it("exits 0 when all tokens in the built-in list have a comment line", () => {
      const tokens = ["NS_ONE", "NS_TWO"];
      const nonSecretFile = writeTmp(
        "non-secret-list.sh",
        nonSecretListFixture(tokens, tokens)
      );
      const env = {
        ...makeEnv(
          workflowFixture(BASE),
          docsFixture(BASE),
          serverEnvFixture(BASE)
        ),
        NON_SECRET_ENV_VARS_FILE: nonSecretFile,
      };
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("All checks passed");
      expect(result.output).not.toContain("NON_SECRET COMMENT MISSING");
    });

    it("exits 0 for the real script file — all built-in non-secret vars are commented", () => {
      const env = makeEnv(
        workflowFixture(BASE),
        docsFixture(BASE),
        serverEnvFixture(BASE)
      );
      const result = run(env);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("NON_SECRET COMMENT MISSING");
    });
  });
});
