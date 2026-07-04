// @vitest-environment jsdom
/**
 * Regression coverage for the shared-link locale plumbing introduced in
 * Task #89:
 *
 *   1. `useSyncLangQueryParam` keeps the `?lang=` URL parameter in sync
 *      with the active locale (and strips it for the default locale) so a
 *      copied URL always reproduces the same language for the recipient.
 *   2. `useHreflangTags` rewrites `<link rel="canonical">` to the active
 *      locale on public marketing routes, and falls back to the site root
 *      on portal/admin routes (so we never advertise an authenticated URL
 *      as canonical).
 *
 * These behaviors are easy to regress (a future router change could swallow
 * `history.replaceState`, or the canonical fallback could be left stale on
 * non-public routes), so we lock them in here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import i18n from "../index";
import { useLocale, useSyncLangQueryParam } from "../useLocale";
import { useHreflangTags } from "../useHreflangTags";

function setUrl(href: string) {
  // jsdom's `history.replaceState` does update `window.location` and is
  // what `useSyncLangQueryParam` itself relies on, so the test reads the
  // same surface the production code writes to.
  window.history.replaceState(null, "", href);
}

function QueryParamProbe() {
  useSyncLangQueryParam();
  return null;
}

function LocaleSetterProbe({
  onReady,
}: {
  onReady: (setLocale: (code: string) => void) => void;
}) {
  const { setLocale } = useLocale();
  // Hand the setter back to the test so it can flip the language exactly
  // like `<LanguageSwitcher>` does in production.
  onReady(setLocale);
  return null;
}

function HreflangProbe() {
  useHreflangTags();
  return null;
}

beforeEach(async () => {
  // Reset DOM head + URL so each test starts from a known state.
  document.head
    .querySelectorAll('link[rel="canonical"], link[data-i18n-hreflang]')
    .forEach((el) => el.parentNode?.removeChild(el));
  setUrl("/");
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("useSyncLangQueryParam", () => {
  it("keeps the URL's ?lang= param aligned with the active locale when the user switches language", async () => {
    setUrl("/?lang=de");
    await i18n.changeLanguage("de");

    let setLocaleRef: ((code: string) => void) | null = null;
    render(
      <>
        <QueryParamProbe />
        <LocaleSetterProbe
          onReady={(setLocale) => {
            setLocaleRef = setLocale;
          }}
        />
      </>,
    );

    // Initial mount: the URL already matches the active locale, so the
    // hook must leave it alone.
    expect(window.location.search).toBe("?lang=de");

    // Switch to French via the same setter `<LanguageSwitcher>` uses.
    await act(async () => {
      setLocaleRef!("fr");
    });

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?lang=fr");
  });

  it("strips ?lang= entirely when the user switches back to the default locale", async () => {
    setUrl("/?lang=fr");
    await i18n.changeLanguage("fr");

    let setLocaleRef: ((code: string) => void) | null = null;
    render(
      <>
        <QueryParamProbe />
        <LocaleSetterProbe
          onReady={(setLocale) => {
            setLocaleRef = setLocale;
          }}
        />
      </>,
    );

    expect(window.location.search).toBe("?lang=fr");

    await act(async () => {
      setLocaleRef!("en");
    });

    // Canonical URLs stay clean for the default locale — no `?lang=` at all.
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });

  it("preserves unrelated query params and hash when rewriting ?lang=", async () => {
    setUrl("/?ref=email&utm_source=newsletter#section");
    await i18n.changeLanguage("en");

    let setLocaleRef: ((code: string) => void) | null = null;
    render(
      <>
        <QueryParamProbe />
        <LocaleSetterProbe
          onReady={(setLocale) => {
            setLocaleRef = setLocale;
          }}
        />
      </>,
    );

    await act(async () => {
      setLocaleRef!("de");
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("lang")).toBe("de");
    expect(params.get("ref")).toBe("email");
    expect(params.get("utm_source")).toBe("newsletter");
    expect(window.location.hash).toBe("#section");
  });
});

describe("useHreflangTags canonical link", () => {
  function getCanonicalHref(): string | null {
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    return link?.getAttribute("href") ?? null;
  }

  it("reflects the active locale on a public marketing route", async () => {
    await i18n.changeLanguage("de");

    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <HreflangProbe />
      </Router>,
    );

    expect(getCanonicalHref()).toBe("https://ibccf.site/?lang=de");

    // Switching back to the default locale should drop `?lang=` from the
    // canonical entirely.
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(getCanonicalHref()).toBe("https://ibccf.site/");
  });

  it("falls back to the site root for portal/admin routes regardless of locale", async () => {
    await i18n.changeLanguage("fr");

    const { hook } = memoryLocation({ path: "/portal/dashboard" });
    render(
      <Router hook={hook}>
        <HreflangProbe />
      </Router>,
    );

    // Non-public routes must never advertise an authenticated URL as
    // canonical — fall back to the marketing site root.
    expect(getCanonicalHref()).toBe("https://ibccf.site/");

    // No hreflang alternates should be emitted for non-public routes.
    expect(
      document.head.querySelectorAll("link[data-i18n-hreflang]").length,
    ).toBe(0);
  });

  it("falls back to the site root for admin routes too", async () => {
    await i18n.changeLanguage("zh");

    const { hook } = memoryLocation({ path: "/admin" });
    render(
      <Router hook={hook}>
        <HreflangProbe />
      </Router>,
    );

    expect(getCanonicalHref()).toBe("https://ibccf.site/");
  });
});
