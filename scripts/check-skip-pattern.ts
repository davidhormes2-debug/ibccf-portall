#!/usr/bin/env tsx
// scripts/check-skip-pattern.ts
//
// Self-test that proves the "Detect relevant changes" skip logic in
// .github/workflows/unit-tests.yml is correctly calibrated: a docs-only diff
// must set skip=true while a real source-code change must set skip=false.
//
// For every job in unit-tests.yml that has a PATTERN= line, this script
// extracts the pattern and runs it against a curated set of test vectors:
//
//   • "code" paths — must MATCH the pattern (→ skip=false, job runs)
//   • "docs" paths — must NOT match the pattern (→ skip=true, job skips)
//
// Test vectors are declared per job ID so that each job is tested against
// paths that are actually in its domain (not borrowed from another job's
// domain).
//
// Usage:
//   npx tsx scripts/check-skip-pattern.ts
//   npm run check:skip-pattern
//
// Exit codes:
//   0 — all assertions passed for every job pattern
//   1 — one or more assertions failed (pattern is too narrow or too broad)
//
// When this fails:
//   Update the PATTERN in the failing job inside unit-tests.yml so that it
//   matches the code paths listed below and does NOT match the docs paths.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const WORKFLOW = join(REPO_ROOT, ".github/workflows/unit-tests.yml");

// ---------------------------------------------------------------------------
// Test vector definitions, keyed by the exact job ID in unit-tests.yml.
//
// expectMatch: true  → path must trigger the job  (skip=false)
// expectMatch: false → path must NOT trigger the job (skip=true, docs-only)
// ---------------------------------------------------------------------------
interface Vector {
  path: string;
  expectMatch: boolean;
}

interface JobSpec {
  jobId: string;
  label: string;
  vectors: Vector[];
}

// Shared docs-only paths that should never trigger any standard code job.
const DOCS_PATHS: Vector[] = [
  { path: "README.md", expectMatch: false },
  { path: "RAILWAY_DEPLOY.md", expectMatch: false },
  { path: "HOSTINGER_DEPLOY.md", expectMatch: false },
  { path: "docs/architecture.md", expectMatch: false },
  { path: "attached_assets/screenshot.png", expectMatch: false },
];

// Shared code paths that should trigger every general code/test job.
const GENERAL_CODE_PATHS: Vector[] = [
  { path: "server/routes.ts", expectMatch: true },
  { path: "server/routes/cases.ts", expectMatch: true },
  { path: "client/src/App.tsx", expectMatch: true },
  { path: "client/src/pages/portal/Dashboard.tsx", expectMatch: true },
  { path: "shared/schema.ts", expectMatch: true },
  { path: "shared/types.ts", expectMatch: true },
  { path: "scripts/__tests__/check-skip-pattern.test.ts", expectMatch: true },
  { path: "server/services/auth.test.ts", expectMatch: true },
  { path: "client/src/hooks/useSession.spec.tsx", expectMatch: true },
];

// General code job: docs-only paths should skip, any of the above code paths
// should run the job. These jobs all share the same PATTERN.
const GENERAL_CODE_JOB_VECTORS: Vector[] = [
  ...GENERAL_CODE_PATHS,
  ...DOCS_PATHS,
  { path: "scripts/deploy.sh", expectMatch: false },
  { path: ".github/CODEOWNERS", expectMatch: false },
];

const JOB_SPECS: JobSpec[] = [
  // ── General code / test jobs ─────────────────────────────────────────────
  // All share PATTERN='(^server/|^client/|^shared/|/__tests__/|\.test\.|\.spec\.)'
  { jobId: "tutorial-video-route", label: "Tutorial Video Route Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "i18n-date-guard", label: "i18n Date Guard", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "admin-login-rate-limit", label: "Admin Login Rate Limit", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "security-flags-shape", label: "Security Flags Shape Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "community-thread-views-cleanup", label: "Community Thread Views Cleanup", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "pre-push-hook-install", label: "Pre-Push Hook Install", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "expandable-failure-list", label: "Expandable Failure List Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "cross-tab-sync-hook", label: "Cross-Tab Sync Hook Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "vitest", label: "Vitest", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "test-typecheck", label: "Test Suite Type Check", vectors: GENERAL_CODE_JOB_VECTORS },

  // ── ESLint — also triggers on any .ts/.tsx file change ──────────────────
  {
    jobId: "eslint",
    label: "ESLint",
    vectors: [
      ...GENERAL_CODE_PATHS,
      { path: "scripts/check-skip-pattern.ts", expectMatch: true },
      { path: "eslint.config.js", expectMatch: true },
      { path: ".eslintrc.cjs", expectMatch: true },
      ...DOCS_PATHS,
      { path: "scripts/deploy.sh", expectMatch: false },
    ],
  },

  // ── Skip-guard coverage — only fires for e2e/ and workflow file changes ──
  {
    jobId: "skip-guard-coverage",
    label: "Skip-Guard Coverage",
    vectors: [
      { path: "e2e/login.spec.ts", expectMatch: true },
      { path: "e2e/admin-analytics.spec.ts", expectMatch: true },
      { path: ".github/workflows/unit-tests.yml", expectMatch: true },
      { path: ".github/workflows/narration-fresh.yml", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "RAILWAY_DEPLOY.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: ".github/CODEOWNERS", expectMatch: false },
      { path: "scripts/deploy.sh", expectMatch: false },
    ],
  },

  // ── Recording validation — only video/ and withdrawal-video/ ─────────────
  {
    jobId: "recording-validation",
    label: "Recording Validation",
    vectors: [
      { path: "video/recorder.ts", expectMatch: true },
      { path: "video/scripts/check-recordings-fresh.mjs", expectMatch: true },
      { path: "client/src/components/portal/withdrawal-video/Widget.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── i18n namespace doc check — i18n JSON files and replit.md ─────────────
  {
    jobId: "i18n-namespace-doc-check",
    label: "i18n Namespace Doc Check",
    vectors: [
      { path: "client/src/i18n/index.ts", expectMatch: true },
      { path: "client/src/i18n/locales/en/common.json", expectMatch: true },
      { path: "replit.md", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/replit-guide.md", expectMatch: false },
    ],
  },

  // ── Narration freshness — narration scripts and video/ ───────────────────
  {
    jobId: "narration-freshness",
    label: "Narration Freshness",
    vectors: [
      { path: "video/plugins/narration-freshness.ts", expectMatch: true },
      { path: "scripts/generate-narration.ts", expectMatch: true },
      { path: "scripts/check-narration-fresh.ts", expectMatch: true },
      {
        path: "client/public/withdrawal-video/narration/narration.manifest.json",
        expectMatch: true,
      },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Narration path-filter sync — its own source files only ──────────────
  {
    jobId: "narration-path-filter-sync",
    label: "Narration Path Filter Sync",
    vectors: [
      { path: "scripts/check-narration-path-filters.ts", expectMatch: true },
      {
        path: "scripts/__tests__/check-narration-path-filters.test.ts",
        expectMatch: true,
      },
      { path: "scripts/check-narration-fresh.ts", expectMatch: true },
      {
        path: "client/src/components/portal/withdrawal-video/narrationFingerprint.ts",
        expectMatch: true,
      },
      { path: "shared/videoCaptions.ts", expectMatch: true },
      { path: ".github/workflows/narration-fresh.yml", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "e2e/login.spec.ts", expectMatch: false },
    ],
  },

  // ── Recordings path-filter sync — video/ plus its config files ───────────
  {
    jobId: "recordings-path-filter-sync",
    label: "Recordings Path Filter Sync",
    vectors: [
      { path: "video/recorder.ts", expectMatch: true },
      { path: "shared/videoCaptions.ts", expectMatch: true },
      {
        path: "client/src/components/portal/withdrawal-video/Widget.tsx",
        expectMatch: true,
      },
      { path: "scripts/check-recordings-path-filters.mjs", expectMatch: true },
      { path: ".github/workflows/unit-tests.yml", expectMatch: true },
      { path: "scripts/required-checks.txt", expectMatch: true },
      { path: "package.json", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "e2e/login.spec.ts", expectMatch: false },
    ],
  },

  // ── Sentinel comment guard — source files, test file, and check script ───
  {
    jobId: "sentinel-comment-guard",
    label: "Sentinel Comment Guard",
    vectors: [
      { path: "server/services/CaseService.ts", expectMatch: true },
      { path: "client/src/pages/portal/PortalShell.tsx", expectMatch: true },
      { path: "server/__tests__/maxStageReached.test.ts", expectMatch: true },
      { path: "scripts/check-sentinel-comments.mjs", expectMatch: true },
      { path: "client/src/components/admin/ContentManagement.tsx", expectMatch: true },
      { path: "client/src/pages/AdminDashboard.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/NewsletterDelete.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/NewsletterSelectionPruning.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/WithdrawalGuideToggle.test.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── replit.md annotation coverage — required-checks.txt and replit.md ───
  {
    jobId: "replit-md-annotation-coverage",
    label: "Replit.md Annotation Coverage",
    vectors: [
      { path: "scripts/__tests__/check-replit-md-annotations.test.ts", expectMatch: true },
      { path: "scripts/required-checks.txt", expectMatch: true },
      { path: "replit.md", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── CI checks doc coverage — required-checks.txt and docs/ci-checks.md ──
  {
    jobId: "ci-checks-doc-coverage",
    label: "CI Checks Doc Coverage",
    vectors: [
      { path: "scripts/__tests__/check-ci-checks-doc-coverage.test.ts", expectMatch: true },
      { path: "scripts/required-checks.txt", expectMatch: true },
      { path: "docs/ci-checks.md", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── Portal closure warning — feature-specific source files ──────────────
  {
    jobId: "portal-closure-warning",
    label: "Portal Closure Warning Tests",
    vectors: [
      { path: "client/src/pages/portal/usePortalAutoLogout.ts", expectMatch: true },
      { path: "client/src/pages/portal/PortalContext.tsx", expectMatch: true },
      { path: "client/src/pages/portal/PortalShell.tsx", expectMatch: true },
      { path: "client/src/components/portal/PortalWarningOverlay.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminPortalWarningPanel.tsx", expectMatch: true },
      { path: "server/__tests__/cases.portalWarning.test.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Bulk broadcast RBAC — CommunicationsTab + dedicated test file ───────
  {
    jobId: "bulk-broadcast-rbac",
    label: "Bulk Broadcast RBAC Tests",
    vectors: [
      { path: "client/src/components/admin/tabs/CommunicationsTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/BulkBroadcastPanelRBAC.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminDashboardContext.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
      { path: "server/routes/cases.ts", expectMatch: false },
    ],
  },

  // ── Portal lockout toast once — PortalContext + dedicated test file ─────
  {
    jobId: "portal-lockout-toast-once",
    label: "Portal Lockout Toast Once Tests",
    vectors: [
      {
        path: "client/src/pages/portal/__tests__/PortalContext.lockoutToast.test.ts",
        expectMatch: true,
      },
      { path: "client/src/pages/portal/PortalContext.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Deposit receipts dialog actioned — dialog + AdminDashboard source ────
  {
    jobId: "deposit-receipts-dialog-actioned",
    label: "Deposit Receipts Dialog Actioned Tests",
    vectors: [
      {
        path: "client/src/components/admin/__tests__/DepositReceiptsDialogActioned.test.tsx",
        expectMatch: true,
      },
      {
        path: "client/src/components/admin/DepositReceiptsDialog.tsx",
        expectMatch: true,
      },
      { path: "client/src/pages/AdminDashboard.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes/cases.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Reactivation receipt alert muted — harness + AdminDashboard source ──
  {
    jobId: "reactivation-receipt-alert-muted",
    label: "Reactivation Receipt Alert Muted Tests",
    vectors: [
      {
        path: "client/src/components/admin/__tests__/ReactivationReceiptAlertMuted.test.tsx",
        expectMatch: true,
      },
      { path: "client/src/pages/AdminDashboard.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes/cases.ts", expectMatch: false },
    ],
  },

  // ── Active warnings — endpoint + cases route ─────────────────────────────
  {
    jobId: "active-warnings-tests",
    label: "Active Warnings Tests",
    vectors: [
      { path: "server/__tests__/cases.activeWarnings.test.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Communications active-warnings badge — AdminGroupedNav + test file ────
  {
    jobId: "communications-active-warnings-badge",
    label: "Communications Active Warnings Badge Tests",
    vectors: [
      { path: "client/src/components/admin/__tests__/AdminGroupedNavActiveWarningsBadge.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminGroupedNav.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Sub-admin login and admin-users CRUD routes ───────────────────────────
  {
    jobId: "sub-admin-login-and-users",
    label: "Sub-Admin Login And Users Tests",
    vectors: [
      { path: "server/__tests__/subAdminLoginAndUsers.test.ts", expectMatch: true },
      { path: "server/routes/admin.ts", expectMatch: true },
      { path: "server/routes/adminUsers.ts", expectMatch: true },
      { path: "server/routes/middleware.ts", expectMatch: true },
      { path: "server/routes/adminPermissions.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Emails translations stub guard — locale emails.json files + test file ─
  {
    jobId: "emails-translations-stub-guard",
    label: "Emails Translations Stub Guard Tests",
    vectors: [
      { path: "client/src/i18n/locales/de/emails.json", expectMatch: true },
      { path: "client/src/i18n/locales/es/emails.json", expectMatch: true },
      { path: "client/src/i18n/__tests__/emailsTranslations.test.ts", expectMatch: true },
      { path: "client/src/i18n/locales/en/common.json", expectMatch: false },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Skip-pattern self-test — only its script and unit-tests.yml ──────────
  {
    jobId: "skip-pattern-self-test",
    label: "Skip Pattern Self Test",
    vectors: [
      { path: "scripts/check-skip-pattern.ts", expectMatch: true },
      { path: ".github/workflows/unit-tests.yml", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "e2e/login.spec.ts", expectMatch: false },
      { path: ".github/workflows/narration-fresh.yml", expectMatch: false },
    ],
  },

  // ── General code jobs (same broad PATTERN as other general jobs) ──────────
  { jobId: "public-get-rate-limit", label: "Public GET Rate Limit Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "public-post-rate-limit", label: "Public POST Rate Limit Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "community-view-cache-throttle", label: "Community View Cache Throttle Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "community-keyword-moderation", label: "Community Keyword Moderation Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "community-flagged-selection-pruning", label: "Community Flagged Selection Pruning Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "keyword-disable-toggle-fail", label: "Keyword Disable Toggle Fail Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "testimonials-saving", label: "Testimonials Saving Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "service-degraded-banner", label: "Service Degraded Banner Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "ai-chat-global-budget-snapshot", label: "AI Chat Global Budget Snapshot Tests", vectors: GENERAL_CODE_JOB_VECTORS },
  { jobId: "ai-chat-global-budget-window-snapshot", label: "AI Chat Global Budget Window Snapshot Tests", vectors: GENERAL_CODE_JOB_VECTORS },

  // ── SMTP SSL detection — server/ plus two Python helper scripts ───────────
  {
    jobId: "smtp-ssl-detection",
    label: "SMTP SSL Detection Tests",
    vectors: [
      { path: "server/services/EmailService.ts", expectMatch: true },
      { path: "server/routes/admin.ts", expectMatch: true },
      { path: "scripts/test_smtp_ssl_detection.py", expectMatch: true },
      { path: "scripts/check_smtp_ssl_sync.py", expectMatch: true },
      { path: ".github/workflows/unit-tests.yml", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Protection-checks sync — shell scripts and workflow files only ────────
  {
    jobId: "protection-checks-sync",
    label: "Protection Checks Sync",
    vectors: [
      { path: "scripts/check-protection-sync.sh", expectMatch: true },
      { path: "scripts/required-checks.txt", expectMatch: true },
      { path: "scripts/setup-github-protection.sh", expectMatch: true },
      { path: "scripts/check-github-protection.sh", expectMatch: true },
      { path: ".github/workflows/unit-tests.yml", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "e2e/login.spec.ts", expectMatch: false },
    ],
  },

  // ── Portal auto-logout — specific portal files only ───────────────────────
  {
    jobId: "portal-auto-logout",
    label: "Portal Auto-Logout Tests",
    vectors: [
      { path: "client/src/pages/portal/__tests__/PortalContext.autoLogout.test.ts", expectMatch: true },
      { path: "client/src/pages/portal/usePortalAutoLogout.ts", expectMatch: true },
      { path: "client/src/pages/portal/PortalContext.tsx", expectMatch: true },
      { path: "client/src/pages/portal/PortalShell.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── Portal lockout toast message — PortalContext + its dedicated test ─────
  {
    jobId: "portal-lockout-toast-message",
    label: "Portal Lockout Toast Message Tests",
    vectors: [
      { path: "client/src/__tests__/portalContextLockoutToast.test.ts", expectMatch: true },
      { path: "client/src/pages/portal/PortalContext.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── Portal warning expiry sweep — sweep service + cases route + schema ────
  {
    jobId: "portal-warning-expiry-sweep-tests",
    label: "Portal Warning Expiry Sweep Tests",
    vectors: [
      { path: "server/__tests__/portalWarningExpirySweep.test.ts", expectMatch: true },
      { path: "server/portal-warning-expiry-sweep.ts", expectMatch: true },
      { path: "server/services/pathwayReset.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Pathway reset — reset service + cases route + schema ──────────────────
  {
    jobId: "pathway-reset-tests",
    label: "Pathway Reset Tests",
    vectors: [
      { path: "server/__tests__/pathwayReset.test.ts", expectMatch: true },
      { path: "server/services/pathwayReset.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Secure portal lockout guard — SecurePortal + PortalContext ────────────
  {
    jobId: "secure-portal-lockout-guard-tests",
    label: "Secure Portal Lockout Guard Tests",
    vectors: [
      { path: "client/src/pages/portal/__tests__/SecurePortalLockoutGuard.test.tsx", expectMatch: true },
      { path: "client/src/pages/SecurePortal.tsx", expectMatch: true },
      { path: "client/src/pages/portal/PortalContext.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Disabled access 403 — test file + cases route + schema ───────────────
  {
    jobId: "disabled-access-403-tests",
    label: "Disabled Access 403 Tests",
    vectors: [
      { path: "server/__tests__/disabledAccess403.test.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Cases tab reactivation badge — tab + test + context + routes ──────────
  {
    jobId: "cases-tab-reactivation-badge",
    label: "Cases Tab Reactivation Badge Tests",
    vectors: [
      { path: "client/src/components/admin/tabs/CasesTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/CasesTabReactivationPendingBadge.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminDashboardContext.tsx", expectMatch: true },
      { path: "server/routes/deposits.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Reactivation pill sync — test + CasesTab + AdminGroupedNav + context ──
  {
    jobId: "reactivation-pill-sync",
    label: "Reactivation Pill Sync Tests",
    vectors: [
      { path: "client/src/components/admin/__tests__/ReactivationPillSync.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/tabs/CasesTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminGroupedNav.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminDashboardContext.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Reactivation pill sync integration — also watches AdminDashboard.tsx ──
  {
    jobId: "reactivation-pill-sync-integration",
    label: "Reactivation Pill Sync Integration Tests",
    vectors: [
      { path: "client/src/components/admin/__tests__/ReactivationPillSyncIntegration.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/ReactivationPillSync.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/tabs/CasesTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminGroupedNav.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminDashboardContext.tsx", expectMatch: true },
      { path: "client/src/pages/AdminDashboard.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Reactivation page message — test files + feature files + route + schema
  {
    jobId: "reactivation-page-message-tests",
    label: "Reactivation Page Message Tests",
    vectors: [
      { path: "server/__tests__/cases.reactivationPageMessage.test.ts", expectMatch: true },
      { path: "client/src/pages/portal/__tests__/ReactivationDepositView.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/AdminPortalWarningPanel.test.tsx", expectMatch: true },
      { path: "client/src/pages/portal/ReactivationDepositView.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminPortalWarningPanel.tsx", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── All receipts tab category filter — AllReceiptsTab + test + schema ─────
  {
    jobId: "all-receipts-tab-category-filter",
    label: "All Receipts Tab Category Filter Tests",
    vectors: [
      { path: "client/src/components/admin/AllReceiptsTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/AllReceiptsTabCategoryFilter.test.tsx", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── All receipts tab reactivation toast — AllReceiptsTab + test + schema ──
  {
    jobId: "all-receipts-tab-reactivation-toast",
    label: "All Receipts Tab Reactivation Toast Tests",
    vectors: [
      { path: "client/src/components/admin/AllReceiptsTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/AllReceiptsTabReactivationToast.test.tsx", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── All receipts tab inbox reactivation — AllReceiptsTab + test + lib ─────
  {
    jobId: "all-receipts-tab-inbox-reactivation",
    label: "All Receipts Tab Inbox Reactivation Tests",
    vectors: [
      { path: "client/src/components/admin/AllReceiptsTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/AllReceiptsTab.test.tsx", expectMatch: true },
      { path: "client/src/lib/receiptStatus.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── All receipts tab status chip — AllReceiptsTab + test + lib ───────────
  {
    jobId: "all-receipts-tab-status-chip",
    label: "All Receipts Tab Status Chip Tests",
    vectors: [
      { path: "client/src/components/admin/AllReceiptsTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/AllReceiptsTabStatusChip.test.tsx", expectMatch: true },
      { path: "client/src/lib/receiptStatus.ts", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
    ],
  },

  // ── App stage history source assertion — test + App.tsx + lib ────────────
  {
    jobId: "app-stage-history-source-assertion",
    label: "App Stage History Source Assertion Tests",
    vectors: [
      { path: "client/src/__tests__/appStageHistory.test.ts", expectMatch: true },
      { path: "client/src/App.tsx", expectMatch: true },
      { path: "client/src/lib/stageHistory.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── App payout wallet history source assertion — test + App.tsx + lib ─────
  {
    jobId: "app-payout-wallet-history-source-assertion",
    label: "App Payout Wallet History Source Assertion Tests",
    vectors: [
      { path: "client/src/__tests__/appPayoutWalletHistory.test.ts", expectMatch: true },
      { path: "client/src/App.tsx", expectMatch: true },
      { path: "client/src/lib/payoutWalletHistory.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── App wallet cleanup source assertion — test + App.tsx + lib ───────────
  {
    jobId: "app-wallet-cleanup-source-assertion",
    label: "App Wallet Cleanup Source Assertion Tests",
    vectors: [
      { path: "client/src/__tests__/appWalletCleanup.test.ts", expectMatch: true },
      { path: "client/src/App.tsx", expectMatch: true },
      { path: "client/src/lib/walletHistoryCleanup.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Sentinel self-test — check script + test files ────────────────────────
  {
    jobId: "sentinel-self-test",
    label: "Sentinel Self Test",
    vectors: [
      { path: "scripts/check-sentinel-comments.mjs", expectMatch: true },
      { path: "server/__tests__/sentinelSelfTest.test.ts", expectMatch: true },
      { path: "server/__tests__/maxStageReached.test.ts", expectMatch: true },
      { path: "server/__tests__/stageTransitionValidation.test.ts", expectMatch: true },
      { path: "client/src/components/admin/__tests__/CommunityFlaggedSelectionPruning.test.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Access key requests admin list — test + route + middleware + UI ────────
  {
    jobId: "access-key-requests-admin-list-tests",
    label: "Access Key Requests Admin List Tests",
    vectors: [
      { path: "server/__tests__/accessKeyRequests.adminList.test.ts", expectMatch: true },
      { path: "server/routes/access-key-requests.ts", expectMatch: true },
      { path: "server/routes/middleware.ts", expectMatch: true },
      { path: "client/src/components/admin/KeyRequestsManagement.tsx", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Key requests management auth header — test + component ───────────────
  {
    jobId: "key-requests-management-auth-header-tests",
    label: "Key Requests Management Auth Header Tests",
    vectors: [
      { path: "client/src/components/admin/__tests__/KeyRequestsManagementAuthHeader.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/KeyRequestsManagement.tsx", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── No-recipient email skip — test + cases/messages/content routes ────────
  {
    jobId: "no-recipient-email-skip",
    label: "No-Recipient Email Skip Tests",
    vectors: [
      { path: "server/__tests__/cases.noRecipientEmailSkip.test.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "server/routes/messages.ts", expectMatch: true },
      { path: "server/routes/content.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "shared/schema.ts", expectMatch: false },
    ],
  },

  // ── Sub-admin session revocation — test + adminUsers + middleware ──────────
  {
    jobId: "sub-admin-session-revocation",
    label: "Sub-Admin Session Revocation Tests",
    vectors: [
      { path: "server/__tests__/subAdminSessionRevocation.test.ts", expectMatch: true },
      { path: "server/routes/adminUsers.ts", expectMatch: true },
      { path: "server/routes/middleware.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Portal warning email retry — test + cases route + email services ──────
  {
    jobId: "portal-warning-email-retry-tests",
    label: "Portal Warning Email Retry Tests",
    vectors: [
      { path: "server/__tests__/cases.portalWarningEmailRetry.test.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "server/services/EmailService.ts", expectMatch: true },
      { path: "server/services/emailNotify.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Cases tab refund claim filter chip — tab + test + context + schema ────
  {
    jobId: "cases-tab-refund-claim-filter-chip",
    label: "Cases Tab Refund Claim Filter Chip Tests",
    vectors: [
      { path: "client/src/components/admin/tabs/CasesTab.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/CasesTabRefundClaimFilterChip.test.tsx", expectMatch: true },
      { path: "client/src/components/admin/AdminDashboardContext.tsx", expectMatch: true },
      { path: "shared/schema.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "server/routes.ts", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Community flagged bulk actions — test + moderation route ──────────────
  {
    jobId: "community-flagged-bulk-actions",
    label: "Community Flagged Bulk Actions Tests",
    vectors: [
      { path: "server/__tests__/communityFlaggedBulk.test.ts", expectMatch: true },
      { path: "server/routes/adminCommunityModeration.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },

  // ── Audit email tag coverage — emailNotify + cases + sweep + audit UI ─────
  {
    jobId: "audit-email-tag-coverage",
    label: "Audit Email Tag Coverage Tests",
    vectors: [
      { path: "server/services/emailNotify.ts", expectMatch: true },
      { path: "server/routes/cases.ts", expectMatch: true },
      { path: "server/portal-warning-expiry-sweep.ts", expectMatch: true },
      { path: "client/src/components/admin/auditValueFormatter.tsx", expectMatch: true },
      { path: "client/src/components/admin/__tests__/auditEmailTagCoverage.test.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
      { path: "attached_assets/screenshot.png", expectMatch: false },
    ],
  },

  // ── Chat template Quick Send — test + messages route + middleware/permissions
  {
    jobId: "chat-template-quick-send",
    label: "Chat Template Quick Send Tests",
    vectors: [
      { path: "server/__tests__/chatTemplateQuickSend.test.ts", expectMatch: true },
      { path: "server/routes/messages.ts", expectMatch: true },
      { path: "server/routes/middleware.ts", expectMatch: true },
      { path: "server/routes/adminPermissions.ts", expectMatch: true },
      { path: "README.md", expectMatch: false },
      { path: "client/src/App.tsx", expectMatch: false },
      { path: "docs/architecture.md", expectMatch: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// 1. Read the workflow file
// ---------------------------------------------------------------------------
if (!existsSync(WORKFLOW)) {
  console.error(`FAIL: ${WORKFLOW} does not exist.`);
  process.exit(1);
}

const workflowLines = readFileSync(WORKFLOW, "utf8").split("\n");

// ---------------------------------------------------------------------------
// 2. Extract all (jobId, pattern) pairs from the workflow
// ---------------------------------------------------------------------------
interface JobPattern {
  jobId: string;
  pattern: string;
}

const jobPatterns: JobPattern[] = [];
let currentJobId = "";

for (const line of workflowLines) {
  const jobMatch = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/);
  if (jobMatch) {
    currentJobId = jobMatch[1];
  }

  const patternMatch = line.match(/^\s+PATTERN='([^']+)'/);
  if (patternMatch && currentJobId) {
    const pattern = patternMatch[1];
    if (!jobPatterns.some((jp) => jp.jobId === currentJobId)) {
      jobPatterns.push({ jobId: currentJobId, pattern });
    }
  }
}

if (jobPatterns.length === 0) {
  console.error(
    "FAIL: No PATTERN= lines found in unit-tests.yml.\n" +
      "      Expected at least one line of the form:  PATTERN='...'",
  );
  process.exit(1);
}

const patternMap = new Map(jobPatterns.map((jp) => [jp.jobId, jp.pattern]));

console.log(
  `Extracted ${jobPatterns.length} PATTERN(s) from ${jobPatterns.length} job(s) in unit-tests.yml.\n`,
);

// ---------------------------------------------------------------------------
// 3. For each job spec, locate the pattern and run assertions
// ---------------------------------------------------------------------------
let totalFailed = 0;
let totalPassed = 0;
const testedJobIds = new Set<string>();

for (const spec of JOB_SPECS) {
  const pattern = patternMap.get(spec.jobId);

  if (pattern === undefined) {
    console.error(
      `FAIL: Job "${spec.jobId}" (${spec.label}) has no PATTERN= line in unit-tests.yml.\n` +
        "      Either the job was removed/renamed, or this script needs updating.",
    );
    totalFailed++;
    continue;
  }

  testedJobIds.add(spec.jobId);
  const re = new RegExp(pattern);
  let jobFailed = false;

  console.log(`Checking job: ${spec.jobId}  (${spec.label})`);
  console.log(`  Pattern: ${pattern}`);

  for (const { path, expectMatch } of spec.vectors) {
    const matched = re.test(path);
    if (matched === expectMatch) {
      const action = expectMatch ? "runs  " : "skips ";
      console.log(`  OK    ${action} "${path}"`);
      totalPassed++;
    } else {
      const wrongOutcome = expectMatch
        ? "skip=true  (job would skip, but it should run for this code change)"
        : "skip=false (job would run, but should skip for this docs-only change)";
      console.error(
        `  FAIL  "${path}"\n` +
          `        → pattern ${expectMatch ? "did not match" : "unexpectedly matched"} — would produce ${wrongOutcome}`,
      );
      totalFailed++;
      jobFailed = true;
    }
  }

  if (!jobFailed) {
    console.log(`  ✓ All ${spec.vectors.length} assertions passed.\n`);
  } else {
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// 4. Warn about any jobs whose pattern was not covered by any spec
// ---------------------------------------------------------------------------
const untestedJobIds = jobPatterns
  .map((jp) => jp.jobId)
  .filter((id) => !testedJobIds.has(id));

if (untestedJobIds.length > 0) {
  console.log(
    "Note: the following jobs have a PATTERN but no test vectors in this script:",
  );
  for (const jobId of untestedJobIds) {
    console.log(`  ${jobId}: ${patternMap.get(jobId)}`);
  }
  console.log(
    "  Consider adding a JOB_SPECS entry in scripts/check-skip-pattern.ts\n" +
      "  for each uncovered job.\n",
  );
}

// ---------------------------------------------------------------------------
// 5. Final report
// ---------------------------------------------------------------------------
console.log("─".repeat(60));
if (totalFailed > 0) {
  console.error(
    `Skip-pattern self-test FAILED — ${totalFailed} assertion(s) failed, ${totalPassed} passed.\n\n` +
      "When a docs-only diff (README.md, *.md, attached_assets/) triggers a job,\n" +
      "the PATTERN is too broad. When a code change (server/, client/, shared/)\n" +
      "fails to trigger a job, the PATTERN is too narrow.\n" +
      "Fix the PATTERN in the affected job(s) inside unit-tests.yml.",
  );
  process.exit(1);
} else {
  console.log(
    `Skip-pattern self-test OK — ${totalPassed} assertion(s) passed across ${testedJobIds.size} job(s).\n` +
      "Docs-only diffs correctly produce skip=true; code changes produce skip=false.",
  );
}
