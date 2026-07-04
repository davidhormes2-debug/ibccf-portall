import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Group 1: static wiring assertions on scripts/post-merge.sh
//
// scripts/post-merge.sh has `set -e`, so a failed schema-safety step
// (db-migrate.sh / check-schema-drift.ts) must trigger an alert BEFORE the
// script exits, since nothing runs after `set -e` aborts a pipeline. These
// tests guard the wiring that makes that possible: pipefail (so the guard
// helper sees the real exit code instead of tee's), and both guarded steps
// routed through the alert-sending helper.
// ---------------------------------------------------------------------------
describe("Post-merge schema-safety failure alerting — scripts/post-merge.sh wiring", () => {
  const postMergePath = path.join(__dirname, "../../scripts/post-merge.sh");
  const content = readFileSync(postMergePath, "utf8");

  it("enables pipefail so a guarded command's failure isn't masked by a trailing tee", () => {
    expect(
      content,
      "scripts/post-merge.sh must `set -o pipefail` — otherwise a failing " +
        "guarded command piped into `tee` would still report success (tee's " +
        "own exit code), and the failure alert would never fire.",
    ).toMatch(/set -o pipefail/);
  });

  it("calls scripts/notify-post-merge-failure.ts on a guarded step failure", () => {
    expect(
      content,
      "scripts/post-merge.sh must invoke scripts/notify-post-merge-failure.ts " +
        "so a failed schema-safety step triggers an out-of-band alert.",
    ).toMatch(/notify-post-merge-failure\.ts/);
  });

  it("routes db-migrate.sh through the guarded-alert helper", () => {
    expect(
      content,
      "scripts/post-merge.sh must run db-migrate.sh via the run_guarded " +
        "helper so a failure there triggers an alert.",
    ).toMatch(/run_guarded\s+"db-migrate\.sh"\s+bash scripts\/db-migrate\.sh/);
  });

  it("routes check-schema-drift.ts through the guarded-alert helper", () => {
    expect(
      content,
      "scripts/post-merge.sh must run check-schema-drift.ts via the " +
        "run_guarded helper so a failure there triggers an alert.",
    ).toMatch(
      /run_guarded\s+"check-schema-drift\.ts"\s+npx tsx scripts\/check-schema-drift\.ts/,
    );
  });

  it("exits with the guarded step's own exit code on failure, not 0", () => {
    expect(
      content,
      "run_guarded must re-exit with the failing step's exit code so " +
        "post-merge still reports failure after sending the alert.",
    ).toMatch(/exit "\$\{exit_code\}"/);
  });

  it("still calls db:push only after both guarded steps and the coverage check", () => {
    const migrateIdx = content.indexOf('run_guarded "db-migrate.sh"');
    const driftIdx = content.indexOf('run_guarded "check-schema-drift.ts"');
    const coverageIdx = content.indexOf("check-migrate-coverage.ts");
    const pushIdx = content.indexOf("db:push");

    expect(migrateIdx).toBeGreaterThan(-1);
    expect(driftIdx).toBeGreaterThan(-1);
    expect(coverageIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(migrateIdx).toBeLessThan(driftIdx);
    expect(driftIdx).toBeLessThan(coverageIdx);
    expect(coverageIdx).toBeLessThan(pushIdx);
  });
});

describe("Post-merge schema-safety failure alerting — scripts/notify-post-merge-failure.ts", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_NAME;
    delete process.env.SMTP_FROM_ADDRESS;
    delete process.env.SMTP_REPLY_TO;

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a Slack message with step name, exit code, and output when SLACK_WEBHOOK_URL is set", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { sendSlackAlert } = await import(
      "../../scripts/notify-post-merge-failure"
    );

    const ok = await sendSlackAlert(
      "https://hooks.slack.test/webhook",
      "check-schema-drift.ts",
      "1",
      "mismatch found: cases.foo",
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.test/webhook");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("check-schema-drift.ts");
    expect(body.text).toContain("mismatch found: cases.foo");
  });

  it("returns false (not throw) when the Slack webhook responds with an error status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { sendSlackAlert } = await import(
      "../../scripts/notify-post-merge-failure"
    );

    const ok = await sendSlackAlert(
      "https://hooks.slack.test/webhook",
      "db-migrate.sh",
      "2",
      "some output",
    );

    expect(ok).toBe(false);
  });

  it("returns false (not throw) when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network unreachable"));
    const { sendSlackAlert } = await import(
      "../../scripts/notify-post-merge-failure"
    );

    const ok = await sendSlackAlert(
      "https://hooks.slack.test/webhook",
      "db-migrate.sh",
      "2",
      "some output",
    );

    expect(ok).toBe(false);
  });

  it("skips email delivery and returns false when SMTP_* env vars are not fully configured", async () => {
    const { sendEmailAlert } = await import(
      "../../scripts/notify-post-merge-failure"
    );

    const ok = await sendEmailAlert("db-migrate.sh", "1", "output here");

    expect(ok).toBe(false);
  });

  it("reads and truncates captured step output from the temp file", async () => {
    const { readTailOutput } = await import(
      "../../scripts/notify-post-merge-failure"
    );

    const tmpFile = path.join(__dirname, "__tmp-post-merge-output.log");
    const longOutput = "x".repeat(5000);
    writeFileSync(tmpFile, longOutput);

    try {
      const result = readTailOutput(tmpFile);
      expect(result.length).toBeLessThan(longOutput.length);
      expect(result).toContain("truncated");
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it("reports a placeholder when no output file was captured", async () => {
    const { readTailOutput } = await import(
      "../../scripts/notify-post-merge-failure"
    );

    expect(readTailOutput(undefined)).toBe("(no captured output)");
    expect(readTailOutput("/tmp/does-not-exist-12345.log")).toBe(
      "(no captured output)",
    );
  });
});
