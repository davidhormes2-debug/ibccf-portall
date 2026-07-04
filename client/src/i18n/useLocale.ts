import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  STORAGE_KEY,
  type LocaleCode,
  type SupportedLocale,
} from "./index";

// Resolve the active locale to a known SupportedLocale entry, falling back
// to English if the i18next state somehow holds an unsupported code.
function resolve(code: string | undefined): SupportedLocale {
  const base = (code ?? DEFAULT_LOCALE).toLowerCase().split("-")[0];
  return (
    SUPPORTED_LOCALES.find((l) => l.code === base) ??
    SUPPORTED_LOCALES.find((l) => l.code === DEFAULT_LOCALE)!
  );
}

/**
 * Read the active locale and provide a setter that persists the choice and
 * updates `<html lang>` reactively. Components that just need to translate
 * strings should use `useTranslation()` directly; this hook is for the
 * language switcher and any component that needs locale-aware Intl
 * formatting.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const active = resolve(i18n.resolvedLanguage ?? i18n.language);

  const setLocale = useCallback(
    (code: LocaleCode) => {
      void i18n.changeLanguage(code);
      // i18next-browser-languagedetector also persists, but write
      // explicitly here so the value is available before the detector
      // kicks in on subsequent reloads.
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch {
        // Ignore — private mode / quota errors should never break i18n.
      }
    },
    [i18n],
  );

  return { locale: active, setLocale, supported: SUPPORTED_LOCALES };
}

/**
 * Mount once near the root of the tree to keep `<html lang>` synchronised
 * with the active i18next language. Screen readers, assistive tech, and
 * search engines all rely on this attribute; updating it on every locale
 * change is a hard requirement of the i18n acceptance criteria.
 */
export function useSyncHtmlLang() {
  const { locale } = useLocale();
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale.bcp47;
    }
  }, [locale]);
}

/**
 * Mount once near the root of the tree so the URL's `?lang=` query
 * parameter always reflects the active locale. We advertise per-language
 * URLs like `/?lang=de` to search engines via `useHreflangTags`, and this
 * hook closes the loop: when a user switches language in
 * `<LanguageSwitcher>` (or when a non-default locale is restored from
 * localStorage), the address bar is rewritten with
 * `history.replaceState` — no full reload, no remount — so the URL is
 * always shareable and reproduces the same language for the recipient.
 *
 * For the default locale the `?lang=` param is stripped instead of
 * written, so canonical URLs stay clean.
 */
export function useSyncLangQueryParam() {
  const { locale } = useLocale();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("lang");
    const desired = locale.code === DEFAULT_LOCALE ? null : locale.code;
    if (current === desired) return;
    if (desired === null) {
      url.searchParams.delete("lang");
    } else {
      url.searchParams.set("lang", desired);
    }
    // Preserve hash + other params. `replaceState` avoids a navigation
    // event so Wouter / TanStack Query state stay untouched.
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, [locale]);
}
