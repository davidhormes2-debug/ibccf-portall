// @vitest-environment node
//
// WHY THIS TEST EXISTS
// The success-path toast assertion in e2e/landing-newsletter.spec.ts hard-codes
// the English description string for the newsletter subscription success toast:
//
//   .filter({ hasText: "Added to intelligence briefing distribution." })
//
// That string comes from `newsletter.subscribedDesc` in
// `client/src/i18n/locales/en/landing.json`. If the copy ever changes without
// also updating the e2e spec, the e2e test fails with a confusing "element not
// found" message rather than a clear "copy drift" signal.
//
// This test is the tripwire: it reads landing.json directly and asserts that
// `newsletter.subscribedDesc` still matches the string the e2e spec filters on,
// so a copy change is caught here — at unit-test time — with an actionable
// failure message instead of a cryptic e2e timeout.
//
// The same guard also covers the toast titles `newsletter.subscribedTitle` and
// `newsletter.errorTitle`, which the e2e spec also hard-codes.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact strings the e2e spec uses as its filter predicates.
// If any of these drift from landing.json, update BOTH the constants below
// and the corresponding assertions in e2e/landing-newsletter.spec.ts.
// ---------------------------------------------------------------------------
const E2E_NEWSLETTER_SUBSCRIBED_TITLE = "Subscribed";
const E2E_NEWSLETTER_SUBSCRIBED_DESC =
  "Added to intelligence briefing distribution.";
const E2E_NEWSLETTER_ERROR_TITLE = "Error";

describe("newsletter i18n copy sync guard", () => {
  let landing: { newsletter?: { subscribedTitle?: string; subscribedDesc?: string; errorTitle?: string } };

  beforeAll(() => {
    const jsonPath = resolve(
      __dirname,
      "../../client/src/i18n/locales/en/landing.json",
    );
    const raw = readFileSync(jsonPath, "utf-8");
    landing = JSON.parse(raw);
  });

  it("landing.json newsletter.subscribedTitle matches the string hard-coded in the e2e spec", () => {
    const actual = landing?.newsletter?.subscribedTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_NEWSLETTER_SUBSCRIBED_TITLE);
    // If this assertion fails, update E2E_NEWSLETTER_SUBSCRIBED_TITLE above AND
    // update the matching assertion in e2e/landing-newsletter.spec.ts so both stay in sync.
  });

  it("landing.json newsletter.subscribedDesc matches the string hard-coded in the e2e spec", () => {
    const actual = landing?.newsletter?.subscribedDesc;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_NEWSLETTER_SUBSCRIBED_DESC);
    // If this assertion fails, update E2E_NEWSLETTER_SUBSCRIBED_DESC above AND
    // update the matching .filter({ hasText: "..." }) call in
    // e2e/landing-newsletter.spec.ts so both stay in sync.
  });

  it("landing.json newsletter.errorTitle matches the string hard-coded in the e2e spec", () => {
    const actual = landing?.newsletter?.errorTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_NEWSLETTER_ERROR_TITLE);
    // If this assertion fails, update E2E_NEWSLETTER_ERROR_TITLE above AND
    // update the matching assertion in e2e/landing-newsletter.spec.ts so both stay in sync.
  });
});
