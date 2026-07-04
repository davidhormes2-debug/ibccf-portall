#!/usr/bin/env tsx
/**
 * scripts/notify-post-merge-failure.ts
 *
 * Sends a visible alert (Slack webhook and/or email) when a post-merge
 * schema-safety step fails — specifically scripts/db-migrate.sh or
 * scripts/check-schema-drift.ts, invoked from scripts/post-merge.sh.
 *
 * Why this exists:
 *   scripts/post-merge.sh runs with `set -e`, so a failure in either script
 *   aborts the pipeline and `npm run db:push` never runs. That already fails
 *   loudly in the post-merge log, but if nobody is actively watching that
 *   log, the skipped db:push can go unnoticed until someone hits a broken
 *   deploy (missing column / stale schema). This script surfaces that
 *   failure immediately via Slack and/or email, independent of whether the
 *   database itself is reachable (the notification path does not depend on
 *   the app's DB connection).
 *
 * Usage (called from scripts/post-merge.sh):
 *   npx tsx scripts/notify-post-merge-failure.ts \
 *     --step "check-schema-drift.ts" \
 *     --exit-code 1 \
 *     --output-file /tmp/post-merge-step-output.log
 *
 * Channels (best-effort, never throws — failing to notify must not mask the
 * original failure or change the post-merge exit code):
 *   - Slack: posted to SLACK_WEBHOOK_URL if set (same secret used by
 *     .github/workflows/branch-protection.yml for drift-alert notifications).
 *   - Email: sent via the same seven SMTP_* vars the app already uses
 *     (SMTP_HOST/PORT/USER/PASSWORD/FROM_NAME/FROM_ADDRESS/REPLY_TO), to
 *     SMTP_REPLY_TO (the same ops inbox branch-protection.yml alerts land in).
 *
 * If neither channel is configured, this script prints a clear warning to
 * stderr so the gap is visible in the post-merge log itself, and exits 0
 * (it must never be the reason post-merge reports a different failure than
 * the real one).
 */

import { readFileSync, existsSync } from "fs";
import nodemailer from "nodemailer";

interface Args {
  step: string;
  exitCode: string;
  outputFile?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--step") args.step = argv[++i];
    else if (arg === "--exit-code") args.exitCode = argv[++i];
    else if (arg === "--output-file") args.outputFile = argv[++i];
  }
  if (!args.step || !args.exitCode) {
    console.error(
      "notify-post-merge-failure: --step and --exit-code are required",
    );
    process.exit(0);
  }
  return args as Args;
}

const MAX_OUTPUT_CHARS = 4000;

export function readTailOutput(outputFile: string | undefined): string {
  if (!outputFile || !existsSync(outputFile)) {
    return "(no captured output)";
  }
  try {
    const raw = readFileSync(outputFile, "utf8").trim();
    if (!raw) return "(step produced no output)";
    return raw.length > MAX_OUTPUT_CHARS
      ? `…(truncated)…\n${raw.slice(-MAX_OUTPUT_CHARS)}`
      : raw;
  } catch (err) {
    return `(failed to read captured output: ${(err as Error).message})`;
  }
}

export async function sendSlackAlert(
  webhookUrl: string,
  step: string,
  exitCode: string,
  output: string,
): Promise<boolean> {
  try {
    const text =
      `:rotating_light: *Post-merge schema-safety step failed*\n` +
      `*Step:* \`${step}\`\n` +
      `*Exit code:* ${exitCode}\n` +
      `*Effect:* \`npm run db:push\` was skipped — the live database schema may now be out of sync with \`shared/schema.ts\`.\n` +
      "*Output (tail):*\n```" +
      output.slice(-3000) +
      "```";
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(
        `notify-post-merge-failure: Slack webhook responded with ${res.status}`,
      );
      return false;
    }
    console.log("notify-post-merge-failure: Slack alert sent.");
    return true;
  } catch (err) {
    console.error(
      "notify-post-merge-failure: failed to send Slack alert:",
      (err as Error).message,
    );
    return false;
  }
}

export async function sendEmailAlert(
  step: string,
  exitCode: string,
  output: string,
): Promise<boolean> {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASSWORD,
    SMTP_FROM_NAME,
    SMTP_FROM_ADDRESS,
    SMTP_REPLY_TO,
  } = process.env;

  if (
    !SMTP_HOST ||
    !SMTP_USER ||
    !SMTP_PASSWORD ||
    !SMTP_FROM_ADDRESS ||
    !SMTP_REPLY_TO
  ) {
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT ? Number(SMTP_PORT) : 465,
      secure: SMTP_PORT ? Number(SMTP_PORT) === 465 : true,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });

    const fromName = SMTP_FROM_NAME || "IBCCF Ops Alerts";
    const safeOutput = output
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    await transporter.sendMail({
      from: `"${fromName}" <${SMTP_FROM_ADDRESS}>`,
      to: SMTP_REPLY_TO,
      subject: `[IBCCF] Post-merge schema-safety step failed: ${step}`,
      text:
        `A post-merge schema-safety step failed.\n\n` +
        `Step: ${step}\n` +
        `Exit code: ${exitCode}\n` +
        `Effect: npm run db:push was skipped — the live database schema may now be out of sync with shared/schema.ts.\n\n` +
        `Output (tail):\n${output.slice(-3000)}\n`,
      html:
        `<p>A post-merge schema-safety step failed.</p>` +
        `<p><strong>Step:</strong> ${step}<br/>` +
        `<strong>Exit code:</strong> ${exitCode}<br/>` +
        `<strong>Effect:</strong> <code>npm run db:push</code> was skipped &mdash; the live database schema may now be out of sync with <code>shared/schema.ts</code>.</p>` +
        `<p><strong>Output (tail):</strong></p>` +
        `<pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:6px;">${safeOutput.slice(-3000)}</pre>`,
    });
    console.log(`notify-post-merge-failure: email alert sent to ${SMTP_REPLY_TO}.`);
    return true;
  } catch (err) {
    console.error(
      "notify-post-merge-failure: failed to send email alert:",
      (err as Error).message,
    );
    return false;
  }
}

async function main(): Promise<void> {
  const { step, exitCode, outputFile } = parseArgs(process.argv.slice(2));
  const output = readTailOutput(outputFile);

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const smtpConfigured = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.SMTP_FROM_ADDRESS &&
      process.env.SMTP_REPLY_TO,
  );
  let sentAny = false;

  if (webhookUrl) {
    sentAny = (await sendSlackAlert(webhookUrl, step, exitCode, output)) || sentAny;
  }

  if (smtpConfigured) {
    sentAny = (await sendEmailAlert(step, exitCode, output)) || sentAny;
  }

  if (!sentAny) {
    if (!webhookUrl && !smtpConfigured) {
      console.error(
        "notify-post-merge-failure: WARNING — no notification channel is " +
          "configured (SLACK_WEBHOOK_URL and SMTP_* are not set). The " +
          `post-merge failure in "${step}" will only be visible in this log.\n` +
          "Set SLACK_WEBHOOK_URL and/or the SMTP_* secrets to enable alerts.",
      );
    } else {
      console.error(
        "notify-post-merge-failure: WARNING — a notification channel is " +
          "configured but delivery failed (see errors above). The " +
          `post-merge failure in "${step}" will only be visible in this log.`,
      );
    }
  }

  // Never change the exit code based on notification success/failure — the
  // real failure (drift check / migrate script) already determines that.
  process.exit(0);
}

// Only run main() when executed directly (npx tsx notify-post-merge-failure.ts),
// not when imported for unit testing.
const isDirectRun =
  process.argv[1] && process.argv[1].endsWith("notify-post-merge-failure.ts");
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error("notify-post-merge-failure: unexpected error:", err);
    process.exit(0);
  });
}
