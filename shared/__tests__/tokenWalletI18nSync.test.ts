// @vitest-environment node
//
// WHY THIS TEST EXISTS
// e2e/token-wallet-setup.spec.ts hard-codes four English strings that render
// in the portal Activity Timeline and are driven by portal.json's
// `status.timeline` sub-namespace:
//
//   page.getByText("Token wallet setup confirmed")
//     → status.timeline.auditActions.token_wallet_setup_confirmed
//
//   page.getByText("Your token wallet setup has been verified by compliance.")
//     → status.timeline.tokenWalletSetupConfirmedDesc
//
//   page.getByText("Token wallet setup unconfirmed")
//     → status.timeline.auditActions.token_wallet_setup_unconfirmed
//
//   page.getByText("Your token wallet setup verification has been reversed.")
//     → status.timeline.tokenWalletSetupUnconfirmedDesc
//
// If any of these strings changes without updating the e2e spec, the test
// fails with a confusing "element not found" message rather than a clear
// "copy drift" signal.
//
// This file is the tripwire: it reads portal.json directly and asserts that
// each key still holds the value the e2e spec looks for.  A copy change is
// caught here — at unit-test time — with an actionable failure message.
//
// If an assertion fails, update the constant in this file AND update every
// matching `getByText("...")` call in e2e/token-wallet-setup.spec.ts so both
// stay in sync.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact strings the e2e spec uses as text predicates.
// ---------------------------------------------------------------------------
const E2E_TWS_CONFIRMED_LABEL = "Token wallet setup confirmed";
const E2E_TWS_CONFIRMED_DESC =
  "Your token wallet setup has been verified by compliance.";
const E2E_TWS_UNCONFIRMED_LABEL = "Token wallet setup unconfirmed";
const E2E_TWS_UNCONFIRMED_DESC =
  "Your token wallet setup verification has been reversed.";

type PortalJson = {
  status?: {
    timeline?: {
      tokenWalletSetupConfirmedDesc?: string;
      tokenWalletSetupUnconfirmedDesc?: string;
      auditActions?: {
        token_wallet_setup_confirmed?: string;
        token_wallet_setup_unconfirmed?: string;
      };
    };
  };
};

describe("portal.json token-wallet activity i18n copy sync guard", () => {
  let portal: PortalJson;

  beforeAll(() => {
    const jsonPath = resolve(
      __dirname,
      "../../client/src/i18n/locales/en/portal.json",
    );
    const raw = readFileSync(jsonPath, "utf-8");
    portal = JSON.parse(raw) as PortalJson;
  });

  it("portal.json status.timeline.auditActions.token_wallet_setup_confirmed matches the string hard-coded in the e2e spec", () => {
    const actual =
      portal?.status?.timeline?.auditActions?.token_wallet_setup_confirmed;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_TWS_CONFIRMED_LABEL);
    // If this assertion fails, update E2E_TWS_CONFIRMED_LABEL above AND
    // update the matching getByText("...") call in e2e/token-wallet-setup.spec.ts.
  });

  it("portal.json status.timeline.tokenWalletSetupConfirmedDesc matches the string hard-coded in the e2e spec", () => {
    const actual = portal?.status?.timeline?.tokenWalletSetupConfirmedDesc;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_TWS_CONFIRMED_DESC);
    // If this assertion fails, update E2E_TWS_CONFIRMED_DESC above AND
    // update the matching getByText("...") call in e2e/token-wallet-setup.spec.ts.
  });

  it("portal.json status.timeline.auditActions.token_wallet_setup_unconfirmed matches the string hard-coded in the e2e spec", () => {
    const actual =
      portal?.status?.timeline?.auditActions?.token_wallet_setup_unconfirmed;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_TWS_UNCONFIRMED_LABEL);
    // If this assertion fails, update E2E_TWS_UNCONFIRMED_LABEL above AND
    // update the matching getByText("...") call in e2e/token-wallet-setup.spec.ts.
  });

  it("portal.json status.timeline.tokenWalletSetupUnconfirmedDesc matches the string hard-coded in the e2e spec", () => {
    const actual = portal?.status?.timeline?.tokenWalletSetupUnconfirmedDesc;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_TWS_UNCONFIRMED_DESC);
    // If this assertion fails, update E2E_TWS_UNCONFIRMED_DESC above AND
    // update the matching getByText("...") call in e2e/token-wallet-setup.spec.ts.
  });
});
