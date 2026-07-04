// @vitest-environment node
//
// WHY THIS TEST EXISTS
// Two e2e specs hard-code English strings that are produced by landing.json's
// `contact` namespace:
//
//   e2e/landing-complaint-form.spec.ts
//     .filter({ hasText: "Submission Failed" })     ← contact.toastErrorTitle
//     .filter({ hasText: "Communication Secure" })  ← contact.secureTitle
//     .filter({ hasText: /^Error$/ })               ← generic, not guarded here
//
//   e2e/landing-newsletter.spec.ts
//     .filter({ hasText: "Submission Failed" })     ← contact.toastErrorTitle
//     .filter({ hasText: "Complaint Submitted" })   ← contact.toastSuccessTitle
//
// If the copy in landing.json ever changes without also updating the e2e specs,
// those tests fail with an opaque "element not found" timeout rather than a
// clear "copy drift" signal.
//
// This file is the tripwire: it reads landing.json directly and asserts that
// each key still holds the value the e2e specs filter on.  A copy change is
// caught here — at unit-test time — with an actionable failure message instead
// of a cryptic e2e timeout.
//
// If an assertion fails, update the constant in this file AND update every
// matching `.filter({ hasText: "..." })` or `getByText("...")` call in the
// relevant e2e spec so both stay in sync.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact strings the e2e specs use as filter predicates.
// ---------------------------------------------------------------------------
const E2E_CONTACT_TOAST_ERROR_TITLE = "Submission Failed";
const E2E_CONTACT_TOAST_SUCCESS_TITLE = "Complaint Submitted";
const E2E_CONTACT_SECURE_TITLE = "Communication Secure";

type LandingJson = {
  contact?: {
    toastErrorTitle?: string;
    toastSuccessTitle?: string;
    secureTitle?: string;
  };
};

describe("landing.json contact i18n copy sync guard", () => {
  let landing: LandingJson;

  beforeAll(() => {
    const jsonPath = resolve(
      __dirname,
      "../../client/src/i18n/locales/en/landing.json",
    );
    const raw = readFileSync(jsonPath, "utf-8");
    landing = JSON.parse(raw) as LandingJson;
  });

  it("landing.json contact.toastErrorTitle matches the string hard-coded in the e2e specs", () => {
    const actual = landing?.contact?.toastErrorTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_CONTACT_TOAST_ERROR_TITLE);
    // If this assertion fails, update E2E_CONTACT_TOAST_ERROR_TITLE above AND
    // update the matching .filter({ hasText: "..." }) calls in both
    // e2e/landing-complaint-form.spec.ts and e2e/landing-newsletter.spec.ts.
  });

  it("landing.json contact.toastSuccessTitle matches the string hard-coded in the e2e spec", () => {
    const actual = landing?.contact?.toastSuccessTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_CONTACT_TOAST_SUCCESS_TITLE);
    // If this assertion fails, update E2E_CONTACT_TOAST_SUCCESS_TITLE above AND
    // update the matching .filter({ hasText: "..." }) call in
    // e2e/landing-newsletter.spec.ts.
  });

  it("landing.json contact.secureTitle matches the string hard-coded in the e2e spec", () => {
    const actual = landing?.contact?.secureTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_CONTACT_SECURE_TITLE);
    // If this assertion fails, update E2E_CONTACT_SECURE_TITLE above AND
    // update the matching .filter({ hasText: "..." }) call in
    // e2e/landing-complaint-form.spec.ts.
  });
});
