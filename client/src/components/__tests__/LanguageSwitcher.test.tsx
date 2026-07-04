// @vitest-environment jsdom
/**
 * Thin integration coverage for `<LanguageSwitcher>` — confirms the
 * actual UI click flow (open dropdown -> pick a language) drives the
 * same `?lang=` URL rewrite that `useSyncLangQueryParam` performs in
 * isolation. Guards against regressions in the switcher's wiring
 * (e.g. an `onSelect` handler that stops calling `setLocale`) that the
 * hook-level tests in `client/src/i18n/__tests__/sharedLinks.test.tsx`
 * would miss.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import i18n from "@/i18n";
import { useSyncLangQueryParam } from "@/i18n/useLocale";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Toaster } from "@/components/ui/toaster";

function QueryParamProbe() {
  useSyncLangQueryParam();
  return null;
}

beforeEach(async () => {
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("LanguageSwitcher", () => {
  it("updates the URL's ?lang= param when the user picks a language from the dropdown", async () => {
    const user = userEvent.setup();
    render(
      <>
        <QueryParamProbe />
        <LanguageSwitcher variant="header" />
        {/* Toaster is required because the `portal` variant fires a
            toast on change; the `header` variant we use here does not,
            but mounting it keeps the test resilient if the variant
            changes. */}
        <Toaster />
      </>,
    );

    await user.click(screen.getByTestId("button-language-switcher"));
    const frenchItem = await screen.findByTestId("menu-language-fr");
    await user.click(frenchItem);

    await waitFor(() => {
      expect(window.location.search).toBe("?lang=fr");
    });

    // Round-trip back to the default locale clears `?lang=` entirely.
    await user.click(screen.getByTestId("button-language-switcher"));
    const englishItem = await screen.findByTestId("menu-language-en");
    await user.click(englishItem);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });
});
