// e2e/certificate-payment-history.spec.ts
//
// End-to-end regression guard: CertificateView renders real fee-payment rows
// seeded against the live server with the correct data-testid attributes and
// badge colour classes.
//
// Flow
// ────
// beforeAll (shared setup)
//   Case A — rejected + pending rows:
//     1. Create a case (certificateEnabled=true, withdrawalAmount set).
//     2. Enroll a PIN via POST /api/cases/set-pin → receive portal session token.
//     3. Upload fee-payment row 1 via portal session token.
//     4. Admin rejects row 1 → case status = "rejected", row 1 = "rejected".
//     5. Upload fee-payment row 2 (case is still uploadable when "rejected").
//        Row 2 is left pending → case status = "awaiting_admin_approval".
//
//   Case B — approved row:
//     1. Create a second case (same config).
//     2. Enroll a PIN → portal session token.
//     3. Upload fee-payment row 3.
//     4. Admin approves row 3 → row 3 = "approved".
//
// Tests:
//   1. Case A — navigate to /dashboard?view=certificate, log in, and assert
//      the rejected row testid + red badge and the pending row testid + amber
//      badge are both present in the DOM.
//   2. Case B — navigate and log in, assert the approved row testid + emerald
//      badge are present.
//
// Data lifecycle:
//   afterAll deletes both cases via DELETE /api/cases/:id?force=true so no
//   stale rows accumulate across test runs.  A unique random suffix on each
//   access code prevents collisions between parallel CI runs.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const TEST_PIN = "482916";

// Minimal 1×1 PNG encoded as a data URL — well within the 10 MB limit and
// passes the ALLOWED_RECEIPT_PREFIXES check in the server route.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function uniqueCode(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function uniqueEmail(): string {
  return `e2e-cert-${randomBytes(3).toString("hex")}@example.com`;
}

// ── Admin API helpers ─────────────────────────────────────────────────────────

async function loginAdminApi(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.status(), "admin login").toBe(200);
  const body = await res.json();
  expect(body.success, "admin login success").toBe(true);
  return body.token as string;
}

async function createCertCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const caseId = (await created.json()).id as string;

  // withdrawalAmount is required so the server can compute the certificate fee.
  // certificateEnabled=true unlocks the CertificateView in the portal.
  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      userName: "Cert E2E User",
      userEmail: uniqueEmail(),
      status: "active",
      withdrawalStage: "1",
      withdrawalAmount: "50000",
      certificateEnabled: true,
    },
  });
  expect(patched.status(), "patch case").toBe(200);
  return caseId;
}

async function deleteCase(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.delete(`/api/cases/${caseId}?force=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  // 200 = deleted, 404 = already gone — both are acceptable for cleanup.
  expect(
    [200, 404],
    `teardown delete case ${caseId} (status ${res.status()})`,
  ).toContain(res.status());
}

// ── Portal session helpers ────────────────────────────────────────────────────

/**
 * Enroll a PIN for the first time and return the portal session token issued
 * by POST /api/cases/set-pin.  This token is accepted on
 * x-portal-session-token and can be used immediately for portal-session-only
 * endpoints such as POST /api/cases/:id/certificate/fee-payments.
 */
async function enrollPinAndGetToken(
  api: APIRequestContext,
  accessCode: string,
  pin: string,
): Promise<string> {
  const res = await api.post("/api/cases/set-pin", {
    data: { accessCode, pin },
  });
  expect(res.status(), "enroll PIN").toBe(200);
  const body = await res.json();
  expect(typeof body.sessionToken, "set-pin sessionToken type").toBe("string");
  return body.sessionToken as string;
}

// ── Certificate fee-payment helpers ─────────────────────────────────────────

async function uploadFeePayment(
  api: APIRequestContext,
  caseId: string,
  portalToken: string,
  fileName: string,
): Promise<number> {
  const res = await api.post(
    `/api/cases/${caseId}/certificate/fee-payments`,
    {
      headers: { "x-portal-session-token": portalToken },
      data: {
        fileData: TINY_PNG_DATA_URL,
        fileName,
        notes: "E2E test receipt",
      },
    },
  );
  expect(res.status(), `upload fee-payment for case ${caseId}`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function approveFeePayment(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
  paymentId: number,
): Promise<void> {
  const res = await api.post(
    `/api/cases/${caseId}/certificate/fee-payments/${paymentId}/approve`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { adminNotes: "E2E approved" },
    },
  );
  expect(res.status(), `approve payment ${paymentId}`).toBe(200);
}

async function rejectFeePayment(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
  paymentId: number,
): Promise<void> {
  const res = await api.post(
    `/api/cases/${caseId}/certificate/fee-payments/${paymentId}/reject`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { adminNotes: "E2E rejected — please resubmit" },
    },
  );
  expect(res.status(), `reject payment ${paymentId}`).toBe(200);
}

// ── Browser login helper ──────────────────────────────────────────────────────

/**
 * Drive the two-step portal login form (access code → PIN).
 * The page must already be at the target URL before calling this.
 * Waits for the portal shell's logout button as the "fully authenticated"
 * signal.
 */
async function loginPortal(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(pin);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("button-logout")).toBeVisible({
    timeout: 20_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny 1×1 PNG as a raw Buffer (same pixel data as TINY_PNG_DATA_URL above,
// decoded so setInputFiles can inject it without a real file-system path).
const TINY_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// ─────────────────────────────────────────────────────────────────────────────

test.describe(
  "Portal Certificate view — empty state (no payment rows yet)",
  () => {
    test.beforeAll(() => {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the certificate e2e tests");
      }
    });

    let adminToken: string;
    let emptyCaseId: string;
    let emptyCaseCode: string;

    test.beforeAll(async ({ baseURL }) => {
      // Clear stale admin login-attempt rows to avoid lock-out from prior runs.
      if (DATABASE_URL) {
        const pg = new Client({ connectionString: DATABASE_URL });
        try {
          await pg.connect();
          await pg.query("DELETE FROM admin_login_attempts");
        } finally {
          await pg.end();
        }
      }

      const api = await request.newContext({ baseURL });
      try {
        adminToken = await loginAdminApi(api);

        // Create a case with certificateEnabled=true and a withdrawalAmount but
        // deliberately upload zero fee-payment rows — this is the empty-state
        // path that had no prior test coverage.
        emptyCaseCode = uniqueCode("E2E-CE");
        emptyCaseId = await createCertCase(api, adminToken, emptyCaseCode);

        // Enroll a PIN so the portal login form can authenticate — the token is
        // not used for uploads here because this test intentionally leaves the
        // payment table empty.
        await enrollPinAndGetToken(api, emptyCaseCode, TEST_PIN);
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async ({ baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        const token = adminToken || (await loginAdminApi(api));
        if (emptyCaseId) await deleteCase(api, token, emptyCaseId);
      } finally {
        await api.dispose();
      }
    });

    test("renders upload button and download button but no payment-history container or skeleton when zero rows exist", async ({
      page,
    }) => {
      await page.goto("/dashboard?view=certificate", {
        waitUntil: "domcontentloaded",
      });
      await loginPortal(page, emptyCaseCode, TEST_PIN);

      // Wait for the fee panel to appear — this is our signal that the
      // GET .../fee-payments request has completed and the component has
      // finished its loading cycle.
      const uploadButton = page.getByTestId("button-certificate-upload");
      await expect(uploadButton, "upload button must be visible").toBeVisible({
        timeout: 20_000,
      });

      // The download / preview button is always rendered regardless of payment
      // state, so it must also be present.
      const downloadButton = page.getByTestId("button-certificate-download");
      await expect(
        downloadButton,
        "download/preview button must be visible",
      ).toBeVisible();

      // With zero payment rows the history container must NOT be in the DOM.
      const historyContainer = page.getByTestId(
        "certificate-payment-history",
      );
      await expect(
        historyContainer,
        "history container must not exist when there are no rows",
      ).not.toBeAttached();

      // The skeleton is only shown while loading is true AND payments are
      // empty.  By the time the upload button is visible, loading has settled
      // to false, so the skeleton must also not be present.
      const skeleton = page.getByTestId(
        "certificate-payment-history-skeleton",
      );
      await expect(
        skeleton,
        "history skeleton must not exist after loading settles",
      ).not.toBeAttached();
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────

test.describe(
  "Portal Certificate view — payment history rendered from real server data",
  () => {
    test.beforeAll(() => {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the certificate e2e tests");
      }
    });

    // Shared state populated in beforeAll and cleaned up in afterAll.
    let adminToken: string;

    // Case A: rejected + pending rows.
    let caseAId: string;
    let caseACode: string;
    let rejectedPaymentId: number;
    let pendingPaymentId: number;

    // Case B: single approved row.
    let caseBId: string;
    let caseBCode: string;
    let approvedPaymentId: number;

    test.beforeAll(async ({ baseURL }) => {
      // Clear admin login-attempt rows so stale lock-outs from earlier runs
      // cannot trigger a 429 on the first login call.
      if (DATABASE_URL) {
        const pg = new Client({ connectionString: DATABASE_URL });
        try {
          await pg.connect();
          await pg.query("DELETE FROM admin_login_attempts");
        } finally {
          await pg.end();
        }
      }

      const api = await request.newContext({ baseURL });
      try {
        adminToken = await loginAdminApi(api);

        // ── Case A: one rejected row + one pending row ────────────────────────
        caseACode = uniqueCode("E2E-CA");
        caseAId = await createCertCase(api, adminToken, caseACode);

        // set-pin returns a portal session token usable immediately for
        // portal-session-only routes (POST .../certificate/fee-payments).
        const portalTokenA = await enrollPinAndGetToken(
          api,
          caseACode,
          TEST_PIN,
        );

        // Upload row 1 → admin rejects → case status = "rejected", row = "rejected".
        const row1 = await uploadFeePayment(
          api,
          caseAId,
          portalTokenA,
          "receipt-1.png",
        );
        await rejectFeePayment(api, adminToken, caseAId, row1);
        rejectedPaymentId = row1;

        // Upload row 2 — when case status is "rejected" re-uploads are allowed
        // (only "approved" blocks further uploads). Row 2 is intentionally left
        // pending (no admin review), leaving case status = "awaiting_admin_approval".
        const row2 = await uploadFeePayment(
          api,
          caseAId,
          portalTokenA,
          "receipt-2.png",
        );
        pendingPaymentId = row2;

        // ── Case B: one approved row ──────────────────────────────────────────
        caseBCode = uniqueCode("E2E-CB");
        caseBId = await createCertCase(api, adminToken, caseBCode);
        const portalTokenB = await enrollPinAndGetToken(
          api,
          caseBCode,
          TEST_PIN,
        );
        const row3 = await uploadFeePayment(
          api,
          caseBId,
          portalTokenB,
          "receipt-approved.png",
        );
        await approveFeePayment(api, adminToken, caseBId, row3);
        approvedPaymentId = row3;
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async ({ baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        const token = adminToken || (await loginAdminApi(api));
        if (caseAId) await deleteCase(api, token, caseAId);
        if (caseBId) await deleteCase(api, token, caseBId);
      } finally {
        await api.dispose();
      }
    });

    // ── Test 1: rejected + pending rows ──────────────────────────────────────

    test("renders rejected and pending payment-history rows with correct testids and badge colour classes", async ({
      page,
    }) => {
      // Navigate directly to ?view=certificate so PortalContext routes there
      // after authentication (the `view` query param is read on auto-login).
      await page.goto("/dashboard?view=certificate", {
        waitUntil: "domcontentloaded",
      });
      await loginPortal(page, caseACode, TEST_PIN);

      // The payment-history container renders once the GET .../fee-payments
      // response comes back with at least one row.
      const historyContainer = page.getByTestId("certificate-payment-history");
      await expect(historyContainer).toBeVisible({ timeout: 15_000 });

      // ── Rejected row ────────────────────────────────────────────────────────
      const rejectedRow = page.getByTestId(
        `certificate-payment-${rejectedPaymentId}`,
      );
      await expect(rejectedRow, "rejected row must be present").toBeVisible();

      const rejectedBadge = page.getByTestId(
        `certificate-payment-${rejectedPaymentId}-status`,
      );
      await expect(rejectedBadge, "rejected status badge must be present").toBeVisible();
      // CertificateView applies "bg-red-500/20 text-red-300 border-red-500/40"
      // to rejected badges — assert at least the distinguishing text class.
      await expect(rejectedBadge, "rejected badge must carry text-red-300").toHaveClass(
        /text-red-300/,
      );

      // ── Pending row ─────────────────────────────────────────────────────────
      const pendingRow = page.getByTestId(
        `certificate-payment-${pendingPaymentId}`,
      );
      await expect(pendingRow, "pending row must be present").toBeVisible();

      const pendingBadge = page.getByTestId(
        `certificate-payment-${pendingPaymentId}-status`,
      );
      await expect(pendingBadge, "pending status badge must be present").toBeVisible();
      // Pending badges carry "bg-amber-500/20 text-amber-300 border-amber-500/40".
      await expect(pendingBadge, "pending badge must carry text-amber-300").toHaveClass(
        /text-amber-300/,
      );
    });

    // ── Test 2: approved row ─────────────────────────────────────────────────

    test("renders approved payment-history row with correct testid and emerald badge class", async ({
      page,
    }) => {
      await page.goto("/dashboard?view=certificate", {
        waitUntil: "domcontentloaded",
      });
      await loginPortal(page, caseBCode, TEST_PIN);

      // For an approved case the fee-payment panel is hidden, but the payment
      // history list still renders showing the approved entry.
      const historyContainer = page.getByTestId("certificate-payment-history");
      await expect(historyContainer).toBeVisible({ timeout: 15_000 });

      const approvedRow = page.getByTestId(
        `certificate-payment-${approvedPaymentId}`,
      );
      await expect(approvedRow, "approved row must be present").toBeVisible();

      const approvedBadge = page.getByTestId(
        `certificate-payment-${approvedPaymentId}-status`,
      );
      await expect(approvedBadge, "approved status badge must be present").toBeVisible();
      // Approved badges carry "bg-emerald-500/20 text-emerald-300 border-emerald-500/40".
      await expect(
        approvedBadge,
        "approved badge must carry text-emerald-300",
      ).toHaveClass(/text-emerald-300/);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Third describe block: browser-driven file-input upload flow.
//
// Unlike the two blocks above (which seed payment rows via direct API calls),
// this block exercises the full browser path:
//   click "Upload Receipt" → hidden <input type="file"> receives a synthetic
//   PNG buffer via setInputFiles → handleFile reads it → POST
//   .../certificate/fee-payments → reload() → new row appears in DOM.
//
// Covers regressions in:
//   • the onClick → fileInputRef.current.click() indirection
//   • the FileReader → fetch → reload chain
//   • the data-testid structure of newly-inserted history rows
// ─────────────────────────────────────────────────────────────────────────────

test.describe(
  "Portal Certificate view — browser file-input upload renders new pending row",
  () => {
    test.beforeAll(() => {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the certificate e2e tests");
      }
    });

    let adminToken: string;
    let caseCId: string;
    let caseCCode: string;

    test.beforeAll(async ({ baseURL }) => {
      // Clear stale admin login-attempt rows to avoid 429s.
      if (DATABASE_URL) {
        const pg = new Client({ connectionString: DATABASE_URL });
        try {
          await pg.connect();
          await pg.query("DELETE FROM admin_login_attempts");
        } finally {
          await pg.end();
        }
      }

      const api = await request.newContext({ baseURL });
      try {
        adminToken = await loginAdminApi(api);

        // Case C — no fee-payment rows; the upload button must be visible.
        caseCCode = uniqueCode("E2E-CC");
        caseCId = await createCertCase(api, adminToken, caseCCode);

        // Enroll a PIN so the portal login step works in the browser test.
        // We don't need the returned token here because the browser session
        // manages its own credentials after loginPortal().
        await enrollPinAndGetToken(api, caseCCode, TEST_PIN);
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async ({ baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        const token = adminToken || (await loginAdminApi(api));
        if (caseCId) await deleteCase(api, token, caseCId);
      } finally {
        await api.dispose();
      }
    });

    test(
      "clicking Upload Receipt and injecting a file via the file chooser creates a pending row with text-amber-300 badge",
      async ({ page }) => {
        // Navigate to the certificate view and authenticate in the browser.
        await page.goto("/dashboard?view=certificate", {
          waitUntil: "domcontentloaded",
        });
        await loginPortal(page, caseCCode, TEST_PIN);

        // The upload button is only rendered when the case is not yet approved
        // or pending, which is true for a freshly-created case with no rows.
        const uploadButton = page.getByTestId("button-certificate-upload");
        await expect(uploadButton, "upload button must be visible").toBeVisible({
          timeout: 15_000,
        });

        // Confirm the history container is absent before upload (no rows yet).
        await expect(
          page.getByTestId("certificate-payment-history"),
          "history container must not exist before any upload",
        ).toHaveCount(0);

        // Click the upload button and intercept the resulting file-chooser
        // dialog in one atomic step.  This exercises the full indirection:
        //   button onClick → onPickFile() → fileInputRef.current.click()
        //   → browser opens file-chooser → Playwright intercepts it
        // Using waitForEvent('filechooser') here means the file-chooser is
        // automatically scoped to the click that opened it, so there is no
        // risk of matching a stale or unrelated file input.
        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser"),
          uploadButton.click(),
        ]);

        // Inject a synthetic PNG via the file-chooser handle.  This fires the
        // change event on the hidden <input type="file">, which triggers
        // handleFile() → FileReader → fetch POST → reload().
        await fileChooser.setFiles({
          name: "e2e-receipt.png",
          mimeType: "image/png",
          buffer: TINY_PNG_BUFFER,
        });

        // After the upload + reload cycle the payment-history container must
        // appear (it renders only when payments.length > 0).
        const historyContainer = page.getByTestId("certificate-payment-history");
        await expect(
          historyContainer,
          "payment history container must appear after upload",
        ).toBeVisible({ timeout: 20_000 });

        // There must be exactly one row (the one just uploaded).
        // Row elements carry data-testid="certificate-payment-{id}"; the
        // nested status badge carries data-testid="certificate-payment-{id}-status".
        // We select rows only (not badges) by excluding the -status suffix.
        const rowLocator = historyContainer.locator(
          '[data-testid^="certificate-payment-"]:not([data-testid$="-status"])',
        );
        await expect(
          rowLocator,
          "exactly one payment row must be present after upload",
        ).toHaveCount(1);

        // Extract the row's testid so we can assert the matching status badge.
        const rowTestId = await rowLocator.first().getAttribute("data-testid");
        expect(rowTestId, "row must have a data-testid attribute").toBeTruthy();
        // rowTestId is "certificate-payment-{id}" — derive the status badge testid.
        const statusBadgeTestId = `${rowTestId}-status`;

        const pendingBadge = page.getByTestId(statusBadgeTestId);
        await expect(
          pendingBadge,
          `status badge ${statusBadgeTestId} must be visible`,
        ).toBeVisible({ timeout: 10_000 });
        await expect(
          pendingBadge,
          "newly uploaded row badge must carry text-amber-300 (pending)",
        ).toHaveClass(/text-amber-300/);
      },
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Fourth describe block: upload-button guard conditions.
//
// Covers two regression-prone branches in CertificateView:
//
//   1. Pending state (fee.status === 'awaiting_admin_approval'):
//      The ternary `pending ? <clock-notice> : <upload-form>` means the upload
//      button is not rendered at all.  A test that asserts the button is absent
//      will catch any accidental removal of the guard condition.
//
//   2. Fee-error state (fee?.error is truthy, e.g. withdrawalAmount not set):
//      The upload button IS rendered but carries `disabled={uploading || !!fee?.error}`.
//      A test that asserts disabled catches regressions where the disabled
//      condition is accidentally dropped.  Also verifies the error banner
//      (certificate-fee-error) is visible and the fee grid is hidden.
// ─────────────────────────────────────────────────────────────────────────────

test.describe(
  "Portal Certificate view — upload button guard conditions",
  () => {
    test.beforeAll(() => {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        throw new Error(
          "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the certificate e2e tests",
        );
      }
    });

    let adminToken: string;

    // Case D — pending state: upload one payment row and leave it pending so
    // fee.status becomes 'awaiting_admin_approval'.
    let caseDId: string;
    let caseDCode: string;

    // Case E — fee-error state: certificateEnabled=true but no withdrawalAmount
    // so the server cannot compute the fee and returns an error payload.
    let caseEId: string;
    let caseECode: string;

    test.beforeAll(async ({ baseURL }) => {
      if (DATABASE_URL) {
        const pg = new Client({ connectionString: DATABASE_URL });
        try {
          await pg.connect();
          await pg.query("DELETE FROM admin_login_attempts");
        } finally {
          await pg.end();
        }
      }

      const api = await request.newContext({ baseURL });
      try {
        adminToken = await loginAdminApi(api);

        // ── Case D: create, enroll PIN, upload one row → pending ─────────────
        caseDCode = uniqueCode("E2E-CD");
        caseDId = await createCertCase(api, adminToken, caseDCode);
        const portalTokenD = await enrollPinAndGetToken(api, caseDCode, TEST_PIN);
        // Upload one row and leave it unreviewed — fee status becomes
        // 'awaiting_admin_approval' as soon as the row lands.
        await uploadFeePayment(api, caseDId, portalTokenD, "receipt-pending.png");

        // ── Case E: certificateEnabled=true but no withdrawalAmount ───────────
        caseECode = uniqueCode("E2E-FE");
        const createdE = await api.post("/api/cases", {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: { accessCode: caseECode, status: "active" },
        });
        expect(createdE.status(), "create fee-error case").toBe(200);
        caseEId = (await createdE.json()).id as string;

        // Patch with certificateEnabled=true but deliberately omit
        // withdrawalAmount so the /certificate/fee endpoint returns an error.
        const patchedE = await api.patch(`/api/cases/${caseEId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: {
            userName: "Cert Fee Error E2E User",
            userEmail: uniqueEmail(),
            status: "active",
            withdrawalStage: "1",
            certificateEnabled: true,
            // withdrawalAmount intentionally not set
          },
        });
        expect(patchedE.status(), "patch fee-error case").toBe(200);

        // Enroll a PIN so the portal login form can authenticate.
        await enrollPinAndGetToken(api, caseECode, TEST_PIN);
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async ({ baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        const token = adminToken || (await loginAdminApi(api));
        if (caseDId) await deleteCase(api, token, caseDId);
        if (caseEId) await deleteCase(api, token, caseEId);
      } finally {
        await api.dispose();
      }
    });

    // ── Test 1: pending state — upload button absent, clock notice visible ────

    test(
      "upload button is not in the DOM when fee status is awaiting_admin_approval, and the pending notice is visible instead",
      async ({ page }) => {
        await page.goto("/dashboard?view=certificate", {
          waitUntil: "domcontentloaded",
        });
        await loginPortal(page, caseDCode, TEST_PIN);

        // Wait for the pending notice to appear as the "loading settled"
        // signal — it only renders after the fee fetch completes.
        const pendingNotice = page.getByTestId("certificate-fee-pending-notice");
        await expect(
          pendingNotice,
          "pending notice must be visible when fee is awaiting_admin_approval",
        ).toBeVisible({ timeout: 20_000 });

        // The upload button lives in the opposite branch of the same ternary;
        // it must not be attached to the DOM at all.
        const uploadButton = page.getByTestId("button-certificate-upload");
        await expect(
          uploadButton,
          "upload button must not be in the DOM when status is pending",
        ).not.toBeAttached();
      },
    );

    // ── Test 2: fee-error state — error banner visible, upload button disabled ─

    test(
      "renders fee-error banner instead of fee grid, skeleton is absent, and upload button is visible but disabled",
      async ({ page }) => {
        await page.goto("/dashboard?view=certificate", {
          waitUntil: "domcontentloaded",
        });
        await loginPortal(page, caseECode, TEST_PIN);

        // Wait for the upload button — it is always rendered regardless of fee
        // error state and signals that the component has finished its load cycle.
        const uploadButton = page.getByTestId("button-certificate-upload");
        await expect(
          uploadButton,
          "upload button must be visible even when fee data cannot be loaded",
        ).toBeVisible({ timeout: 20_000 });

        // The error banner must be present and visible.
        const errorBanner = page.getByTestId("certificate-fee-error");
        await expect(
          errorBanner,
          "fee-error banner must be visible when the fee endpoint returns an error",
        ).toBeVisible({ timeout: 10_000 });

        // The skeleton loader must be gone once loading has settled.
        const skeleton = page.getByTestId("certificate-fee-skeleton");
        await expect(
          skeleton,
          "fee skeleton must not be present after loading settles",
        ).not.toBeAttached();

        // The fee grid (amount / rate / payTo tiles) must NOT be rendered when
        // fee.error is set — the component branches exclusively to the error
        // banner in that case.
        const feeGrid = page.locator(
          '[data-testid="certificate-fee-error"] ~ .grid',
        );
        await expect(
          feeGrid,
          "fee grid must not appear alongside the error banner",
        ).toHaveCount(0);

        // The upload button must be disabled when fee?.error is truthy.
        await expect(
          uploadButton,
          "upload button must be disabled when fee?.error is truthy",
        ).toBeDisabled();
      },
    );
  },
);
