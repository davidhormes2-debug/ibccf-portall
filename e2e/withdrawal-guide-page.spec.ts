// e2e/withdrawal-guide-page.spec.ts
//
// Regression guard for the Withdrawal Guide destination page (/withdrawal-guide).
//
// WHAT THIS TESTS
// ───────────────
// The portal sidebar nav item links to /withdrawal-guide (target="_blank").
// This spec navigates there directly and confirms:
//
//   1. The page returns HTTP 200 — no 404 / 500 / broken route.
//   2. The "Withdrawal Guide" <h1> heading is rendered.
//   3. The tutorial video element is present (aria-label present).
//   4. The download link (data-testid="link-download-withdrawal-guide") is visible.
//   5. Clicking the play overlay transitions the video to playing state, or the
//      error state renders gracefully when the video file is absent in CI.
//   6. The download link href uses the locale-scoped format.
//   7. Play overlay → Pause transition works unconditionally (MP4 stub seeded via
//      route intercept so this test never depends on a real video file on disk).
//
// The page is fully public — no portal login is required.

import { test, expect } from "@playwright/test";

test.describe("Withdrawal Guide page (/withdrawal-guide)", () => {
  test("page loads with correct heading and video player", async ({
    page,
    baseURL,
  }) => {
    // Stall the video network request for the lifetime of this test so the
    // browser never fires onError (system Chromium has no H.264 decoder).
    // The same strategy is used by the download-link and play-overlay tests.
    // Playwright aborts the pending request automatically when the page closes.
    await page.route("/tutorial-videos/**", () => {
      // Intentionally left pending — page.close() aborts it after the test.
    });

    // ── 1. Confirm HTTP 200 ────────────────────────────────────────────────
    const response = await page.goto("/withdrawal-guide");
    expect(
      response?.status(),
      "HTTP status should be 200",
    ).toBe(200);

    // ── 2. <h1> heading is visible ─────────────────────────────────────────
    const heading = page.getByRole("heading", {
      name: "Withdrawal Guide",
      level: 1,
    });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // ── 3. Tutorial video element is present ──────────────────────────────
    const video = page.getByLabel("Withdrawal tutorial video");
    await expect(video).toBeAttached({ timeout: 10_000 });

    // ── 4. Download link is visible ────────────────────────────────────────
    const downloadLink = page.getByTestId("link-download-withdrawal-guide");
    await expect(downloadLink).toBeVisible({ timeout: 10_000 });
  });

  // ── 5. Play button transitions to playing state, or error state renders ──
  //
  // When the MP4 file is available the play overlay is clickable and the
  // video element transitions to playing state (overlay disappears; the
  // controls-bar button switches to Pause).  When the file is absent (the
  // route returns 404, which is the common CI case), the video <onError>
  // handler fires and the component replaces the player with a graceful
  // error message and a "Return home" link — the download link is also
  // removed from the DOM since it lives in the same conditional block.
  test("play overlay transitions to playing state, or error UI renders gracefully", async ({
    page,
  }) => {
    await page.goto("/withdrawal-guide");

    const playOverlay = page.getByRole("button", { name: "Play video" });
    const errorMessage = page.getByText(
      "Tutorial video is not available at this time.",
    );

    // Wait for the page to settle into one of the two known states.
    await expect(playOverlay.or(errorMessage)).toBeVisible({ timeout: 15_000 });

    if (await errorMessage.isVisible()) {
      // ── Error path (video file absent in CI) ──────────────────────────
      // The error UI must show a human-readable message and a recovery link.
      await expect(errorMessage).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Return home" }),
      ).toBeVisible();
      // The controls bar (which contains the download link) is also hidden.
      await expect(
        page.getByTestId("link-download-withdrawal-guide"),
      ).toHaveCount(0);
    } else {
      // ── Play path (video file available) ──────────────────────────────
      // Click the overlay; the component calls video.play() and sets
      // playing=true which removes the overlay from the DOM.
      await playOverlay.click();

      // Overlay must disappear — it is only rendered when playing=false.
      await expect(playOverlay).toHaveCount(0, { timeout: 10_000 });

      // The controls-bar button switches its aria-label to "Pause" once
      // the video is in the playing state.
      await expect(
        page.getByRole("button", { name: "Pause" }),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── 6. Download link href uses the locale-scoped format ───────────────
  //
  // The href is built from the active locale code:
  //   /tutorial-videos/<code>?download=1
  // The download link lives inside the controls bar, which is only rendered
  // when `errored=false`.  To keep `errored` false for the duration of the
  // test, stall the video network request (never respond) so the video
  // element stays in HAVE_NOTHING / "loading" state rather than firing
  // onError.  When the test ends Playwright closes the page and aborts any
  // pending requests automatically.
  test("download link href matches locale-scoped format", async ({ page }) => {
    // Intercept the video request and hold it open for the lifetime of the
    // test.  Never calling route.fulfill() / route.abort() leaves the video
    // in a perpetual "loading" state, preventing onError from firing.
    await page.route("/tutorial-videos/**", () => {
      // Intentionally left pending — page.close() aborts it after the test.
    });

    await page.goto("/withdrawal-guide");

    const downloadLink = page.getByTestId("link-download-withdrawal-guide");
    await expect(downloadLink).toBeVisible({ timeout: 10_000 });

    const href = await downloadLink.getAttribute("href");
    // Expected: /tutorial-videos/<two-letter locale code>?download=1
    expect(href, "download href must be locale-scoped").toMatch(
      /^\/tutorial-videos\/[a-z]{2}\?download=1$/,
    );
  });

  // ── 7. Play overlay → Pause transition (unconditional, request stall) ──
  //
  // This test exercises the play-path unconditionally in CI without any
  // dependency on a real video file on disk.
  //
  // Strategy: intercept the video network request and hold it open for the
  // entire test lifetime (never call route.fulfill() or route.abort()).
  // The browser keeps the request pending — the video element stays in
  // HAVE_NOTHING / "loading" state and onError never fires, so `errored`
  // stays false and the play overlay remains in the DOM.  When Playwright
  // closes the page at test teardown it aborts any pending requests
  // automatically, so no resource leak occurs.
  //
  // Why not serve a real MP4 stub via route.fulfill()?
  //   Chromium fires onError for any *complete* response whose body does
  //   not contain a decodable video stream — including a structurally-valid
  //   but 0-sample MP4 (no video frames → MEDIA_ERR_SRC_NOT_SUPPORTED).
  //   The pending-request stall is the only reliable way to keep errored=false
  //   in headless Chromium without shipping a real encoded video frame in the
  //   test suite.
  //
  // The key implementation detail that makes the assertions reliable:
  //   `togglePlay()` in WithdrawalGuidePage.tsx calls `setPlaying(true)`
  //   *synchronously* after `void v.play()`, so the React state update (and
  //   therefore the DOM change — overlay gone, Pause button visible) is
  //   committed in the same event-loop tick as the click, before any async
  //   media events can process.  The mute-toggle sub-test is pure client-side
  //   state — it works regardless of whether video data ever arrives.
  test("play overlay transitions to playing and mute toggles (unconditional)", async ({
    page,
  }) => {
    // Intercept the video request and hold it open for the lifetime of the
    // test.  Never calling route.fulfill() / route.abort() leaves the video
    // element in a perpetual "loading" state, preventing onError from firing.
    // page.close() at teardown aborts the pending request automatically.
    await page.route("/tutorial-videos/**", () => {
      // Intentionally left pending — same strategy as the download-link test.
    });

    await page.goto("/withdrawal-guide");

    const playOverlay = page.getByRole("button", { name: "Play video" });

    // The play overlay must be present — confirms errored=false (the stub
    // keeps the request open so onError never fires).
    await expect(playOverlay).toBeVisible({ timeout: 10_000 });

    // ── Play → Pause ───────────────────────────────────────────────────────
    await playOverlay.click();

    // The overlay is rendered only when playing=false; clicking sets
    // playing=true synchronously so it must immediately leave the DOM.
    await expect(playOverlay).toHaveCount(0, { timeout: 5_000 });

    // The controls-bar play/pause button must switch its aria-label to "Pause".
    await expect(
      page.getByRole("button", { name: "Pause" }),
    ).toBeVisible({ timeout: 5_000 });

    // ── Mute toggle ────────────────────────────────────────────────────────
    // The mute button is pure client-side state; it toggles independently of
    // whether the video is actually decoding.
    const muteButton = page.getByRole("button", { name: "Mute" });
    await expect(muteButton).toBeVisible({ timeout: 5_000 });

    await muteButton.click();
    // After muting the aria-label flips to "Unmute".
    await expect(
      page.getByRole("button", { name: "Unmute" }),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Unmute" }).click();
    // After unmuting it returns to "Mute".
    await expect(
      page.getByRole("button", { name: "Mute" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
