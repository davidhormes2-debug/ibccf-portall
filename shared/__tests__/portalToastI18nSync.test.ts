// @vitest-environment node
//
// WHY THIS TEST EXISTS
// Two portal e2e specs hard-code English strings that come from portal.json:
//
//   e2e/portal-submission-error.spec.ts
//     .filter({ hasText: "Submission Failed" })
//       → portal.json  letter.toast.submissionFailedTitle
//
//   e2e/portal-withdrawal-mode-display.spec.ts
//     .filter({ hasText: "Download failed" })   (certificate-download failure)
//       → portal.json  certificate.toasts.downloadFailedTitle
//
// If either copy key changes without updating the e2e spec, the test silently
// times out instead of giving a clear "copy drift" message.
//
// This file is the tripwire: it reads portal.json directly and asserts that
// each key still holds the value the e2e spec filters on.  A copy change is
// caught here — at unit-test time — with an actionable failure message.
//
// If an assertion fails, update the constant in this file AND update every
// matching `.filter({ hasText: "..." })` call in the relevant e2e spec so
// both stay in sync.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact strings the e2e specs use as filter predicates.
// ---------------------------------------------------------------------------
const E2E_LETTER_SUBMISSION_FAILED_TITLE = "Submission Failed";
const E2E_CERTIFICATE_DOWNLOAD_FAILED_TITLE = "Download failed";

type PortalJson = {
  letter?: {
    toast?: {
      submissionFailedTitle?: string;
    };
  };
  certificate?: {
    toasts?: {
      downloadFailedTitle?: string;
    };
  };
};

describe("portal.json toast i18n copy sync guard", () => {
  let portal: PortalJson;

  beforeAll(() => {
    const jsonPath = resolve(
      __dirname,
      "../../client/src/i18n/locales/en/portal.json",
    );
    const raw = readFileSync(jsonPath, "utf-8");
    portal = JSON.parse(raw) as PortalJson;
  });

  it("portal.json letter.toast.submissionFailedTitle matches the string hard-coded in the e2e spec", () => {
    const actual = portal?.letter?.toast?.submissionFailedTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_LETTER_SUBMISSION_FAILED_TITLE);
    // If this assertion fails, update E2E_LETTER_SUBMISSION_FAILED_TITLE above AND
    // update the matching .filter({ hasText: "..." }) call in
    // e2e/portal-submission-error.spec.ts.
  });

  it("portal.json certificate.toasts.downloadFailedTitle matches the string hard-coded in the e2e spec", () => {
    const actual = portal?.certificate?.toasts?.downloadFailedTitle;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_CERTIFICATE_DOWNLOAD_FAILED_TITLE);
    // If this assertion fails, update E2E_CERTIFICATE_DOWNLOAD_FAILED_TITLE above AND
    // update the matching .filter({ hasText: "..." }) calls in
    // e2e/portal-withdrawal-mode-display.spec.ts.
  });
});
