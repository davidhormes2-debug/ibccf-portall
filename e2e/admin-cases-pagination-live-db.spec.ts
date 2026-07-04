/**
 * e2e/admin-cases-pagination-live-db.spec.ts
 *
 * Task #2444 — the component-level test
 * (client/src/components/admin/__tests__/CasesTabPagination.test.tsx) mounts
 * the real `CasesTab` with a synthetic in-memory case list and proves the
 * client-side pagination logic added for Task #2406 is correct in isolation.
 * It does not exercise the tab against an actual Express server + Postgres
 * round trip, where the full `GET /api/cases` payload, JSON parsing, and
 * React re-render all happen for real.
 *
 * This spec closes that gap: it seeds a real, database-backed case list big
 * enough to require multiple pages (CASES_PAGE_SIZE * 2 + 5 = 105 cases,
 * mirroring the unit test's scale), logs into the live admin dashboard, and
 * asserts:
 *   1. The tab becomes interactive quickly and only ever mounts one page's
 *      worth of `row-case-*` rows at a time (never renders all 105+ rows).
 *   2. Prev/Next paginate correctly across all pages, and navigating away
 *      unmounts the previous page's rows.
 *   3. A row selection made on one page survives navigating away and back.
 *
 * All assertions are scoped to a unique per-run access-code prefix via the
 * search box, so the outcome doesn't depend on how many other cases already
 * exist in whatever database this runs against.
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode,
  loginAdminUi as loginAdminUiBase,
  clearAdminRateLimit,
  localTimeout,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const CASES_PAGE_SIZE = 50;
const TOTAL_SEEDED_CASES = CASES_PAGE_SIZE * 2 + 5; // 105 -> pages of 50/50/5

/**
 * Log into the admin dashboard and wait for the `admin-data-ready` sentinel
 * so the initial /api/cases load (and pending-counts fetch) has settled
 * before assertions run.
 */
async function loginAdminUi(page: import("@playwright/test").Page): Promise<void> {
  await loginAdminUiBase(page);
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

/**
 * Insert `count` cases sharing `prefix` directly via a single bulk SQL
 * statement rather than the admin `POST /api/cases` API.
 *
 * The generic `/api` rate limiter (`server/middleware/security.ts`) caps
 * requests to a single literal route path (e.g. `/api/cases`) at 100/min per
 * IP, and every seeded case's create call shares that exact path — so
 * driving 105 creates through the API trips a 429 partway through seeding.
 * Writing straight to Postgres is a legitimate way to seed fixture data for
 * a "real database" pagination test (the tab itself still reads the rows
 * back through the real `GET /api/cases` API + React render path, which is
 * what this spec is actually verifying) without fighting the same abuse
 * guard the rest of the app relies on for protection.
 */
async function seedCases(
  databaseUrl: string,
  prefix: string,
  count: number,
): Promise<string[]> {
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    // The Cases tab lists rows in `ORDER BY created_at DESC` (see
    // storage.ts). Stamp each row with a distinct, strictly descending
    // `created_at` (index 0 = newest) so seeded rows land in a predictable
    // order: caseIds[0] is guaranteed to be the very first row on page 1,
    // and the last CASES_PAGE_SIZE-worth of ids land on the final page —
    // rather than depending on undefined tie-break behavior for rows that
    // would otherwise share the same `now()` timestamp from a single
    // bulk INSERT.
    const now = Date.now();
    const rows = Array.from({ length: count }, (_, i) => ({
      accessCode: `${prefix}-${String(i).padStart(4, "0")}`,
      userName: `Pagination E2E ${i}`,
      userEmail: `${prefix.toLowerCase()}-${i}@example.test`,
      createdAt: new Date(now - i * 1000),
    }));

    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((row, i) => {
      const base = i * 4;
      values.push(
        `($${base + 1}, 'active', $${base + 2}, $${base + 3}, $${base + 4})`,
      );
      params.push(row.accessCode, row.userName, row.userEmail, row.createdAt);
    });

    const result = await pg.query(
      `INSERT INTO cases (access_code, status, user_name, user_email, created_at)
       VALUES ${values.join(", ")}
       RETURNING id`,
      params,
    );
    return result.rows.map((r: { id: string }) => r.id);
  } finally {
    await pg.end();
  }
}

/** Delete every case whose access_code starts with `prefix`. */
async function deleteCasesByPrefix(
  databaseUrl: string,
  prefix: string,
): Promise<void> {
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM cases WHERE access_code LIKE $1`, [
      `${prefix}%`,
    ]);
  } finally {
    await pg.end();
  }
}

test.describe("Admin — Cases tab pagination against a live database", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD || !DATABASE_URL,
    "ADMIN_USERNAME / ADMIN_PASSWORD / DATABASE_URL must be set to run the cases-pagination live-db e2e tests",
  );

  const prefix = uniqueAccessCode("PGE2E");
  let caseIds: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(localTimeout(60_000));
    await clearAdminRateLimit(DATABASE_URL);
    readAdminToken();
    caseIds = await seedCases(DATABASE_URL, prefix, TOTAL_SEEDED_CASES);
  });

  test.afterAll(async () => {
    await deleteCasesByPrefix(DATABASE_URL, prefix);
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(180_000));
  });

  /** Filters the Cases tab down to just the seeded rows via the search box. */
  async function filterToSeededCases(page: import("@playwright/test").Page) {
    const search = page.getByTestId("input-search-cases");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(prefix);
  }

  test("becomes interactive quickly and mounts only one page of rows for a large, real case list", async ({
    page,
  }) => {
    // Timed from before login/navigation so the measurement covers the full
    // "admin lands on the dashboard, cases have loaded, first page is
    // rendered and filtered" path — not just the post-load filter re-render.
    const start = Date.now();
    await loginAdminUi(page);
    await filterToSeededCases(page);

    await expect
      .poll(() => page.locator('[data-testid^="row-case-"]').count(), {
        timeout: localTimeout(10_000),
      })
      .toBe(CASES_PAGE_SIZE);
    const elapsedMs = Date.now() - start;

    // Generous CI-friendly ceiling covering login + initial /api/cases load +
    // first-page render + filter re-render: the point is that only one page
    // of rows ever renders (no multi-second freeze from mounting all 105 at
    // once), not a tight perf budget sensitive to shared-runner noise.
    expect(elapsedMs, "admin dashboard + first page of rows should render well under CI-friendly ceiling").toBeLessThan(
      localTimeout(20_000),
    );

    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 1 of 3/,
    );
  });

  test("Prev/Next paginate across all pages and unmount the previous page's rows", async ({
    page,
  }) => {
    await loginAdminUi(page);
    await filterToSeededCases(page);

    await expect
      .poll(() => page.locator('[data-testid^="row-case-"]').count(), {
        timeout: localTimeout(10_000),
      })
      .toBe(CASES_PAGE_SIZE);

    const firstPageRowId = `row-case-${caseIds[0]}`;
    await expect(page.getByTestId(firstPageRowId)).toBeVisible();

    const prevButton = page.getByTestId("button-cases-prev-page");
    const nextButton = page.getByTestId("button-cases-next-page");
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();

    await nextButton.click();
    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 2 of 3/,
    );
    await expect(page.getByTestId(firstPageRowId)).not.toBeAttached();
    await expect
      .poll(() => page.locator('[data-testid^="row-case-"]').count())
      .toBe(CASES_PAGE_SIZE);

    await nextButton.click();
    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 3 of 3/,
    );
    await expect
      .poll(() => page.locator('[data-testid^="row-case-"]').count())
      .toBe(5);
    await expect(nextButton).toBeDisabled();

    await prevButton.click();
    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 2 of 3/,
    );

    await prevButton.click();
    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 1 of 3/,
    );
    await expect(page.getByTestId(firstPageRowId)).toBeVisible();
  });

  test("a row selection made on one page survives navigating away and back", async ({
    page,
  }) => {
    await loginAdminUi(page);
    await filterToSeededCases(page);

    await expect
      .poll(() => page.locator('[data-testid^="row-case-"]').count(), {
        timeout: localTimeout(10_000),
      })
      .toBe(CASES_PAGE_SIZE);

    const firstCaseId = caseIds[0];
    const checkbox = page.getByTestId(`checkbox-select-${firstCaseId}`);
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await page.getByTestId("button-cases-next-page").click();
    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 2 of 3/,
    );
    await expect(page.getByTestId(`checkbox-select-${firstCaseId}`)).not.toBeAttached();

    await page.getByTestId("button-cases-prev-page").click();
    await expect(page.getByTestId("text-cases-page-info")).toHaveText(
      /Page 1 of 3/,
    );

    await expect(page.getByTestId(`checkbox-select-${firstCaseId}`)).toBeChecked();
  });
});
