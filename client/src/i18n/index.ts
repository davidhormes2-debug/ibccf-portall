// Centralised i18n configuration for IBCCF.
//
// Why react-i18next: it has the largest community + ecosystem, supports
// namespacing, lazy resource loading, and integrates trivially with our
// React 19 + Vite stack. We persist the active locale in localStorage and
// auto-detect from `navigator.language` on first visit; the choice is kept
// in sync with `<html lang>` by `useSyncHtmlLang` (see ./useLocale.ts).
//
// Adding a new language requires NO code edits — only:
//   1. Create `client/src/i18n/locales/<code>/_meta.json` with
//      `{ code, label, nativeLabel, bcp47 }`.
//   2. Drop translation files at `client/src/i18n/locales/<code>/<ns>.json`.
// Both `SUPPORTED_LOCALES` and the resource registry are built from
// `import.meta.glob` so new locale folders are auto-discovered at build
// time without touching this file.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export type LocaleCode = string;

export interface SupportedLocale {
  code: LocaleCode;
  label: string;
  nativeLabel: string;
  // BCP-47 tag used for Intl.* formatters and `<html lang>`. Kept separate
  // from `code` so we can later add regional variants (en-US, en-GB, …)
  // without breaking the lookup keys.
  bcp47: string;
}

const metaFiles = import.meta.glob<SupportedLocale>(
  "./locales/*/_meta.json",
  { eager: true, import: "default" },
);

const discoveredLocales: SupportedLocale[] = [];
for (const [path, meta] of Object.entries(metaFiles)) {
  const match = path.match(/\.\/locales\/([^/]+)\/_meta\.json$/);
  if (!match) continue;
  const code = meta.code || match[1];
  discoveredLocales.push({
    code,
    label: meta.label || code,
    nativeLabel: meta.nativeLabel || meta.label || code,
    bcp47: meta.bcp47 || code,
  });
}
// Stable order: English first if present, then alphabetical by code.
discoveredLocales.sort((a, b) => {
  if (a.code === "en") return -1;
  if (b.code === "en") return 1;
  return a.code.localeCompare(b.code);
});

export const SUPPORTED_LOCALES: SupportedLocale[] =
  discoveredLocales.length > 0
    ? discoveredLocales
    : [{ code: "en", label: "English", nativeLabel: "English", bcp47: "en" }];

export const DEFAULT_LOCALE: LocaleCode = SUPPORTED_LOCALES.some(
  (l) => l.code === "en",
)
  ? "en"
  : SUPPORTED_LOCALES[0].code;
export const STORAGE_KEY = "ibccf.locale";

// File-driven namespace discovery: every JSON file under
// `locales/<code>/<ns>.json` is auto-registered. Adding a new namespace
// (e.g., `admin.json`) does not require touching this file either.
const localeFiles = import.meta.glob<Record<string, unknown>>(
  "./locales/*/*.json",
  { eager: true, import: "default" },
);

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
const namespaceSet = new Set<string>();

for (const [path, mod] of Object.entries(localeFiles)) {
  // Path shape: "./locales/<code>/<ns>.json"
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, code, ns] = match;
  // `_meta.json` is locale metadata, not a translation namespace.
  if (ns.startsWith("_")) continue;
  namespaceSet.add(ns);
  resources[code] ??= {};
  resources[code][ns] = mod as Record<string, unknown>;
}

export const NAMESPACES = Array.from(namespaceSet).sort();
export type Namespace = string;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES.map((l) => l.code),
    ns: NAMESPACES,
    defaultNS: NAMESPACES.includes("common") ? "common" : NAMESPACES[0],
    interpolation: { escapeValue: false },
    detection: {
      // `querystring` runs first so the `?lang=<code>` URLs we emit in the
      // sitemap's hreflang alternates actually render the requested
      // language when a search engine (or a user with a localised link)
      // lands on the page. The detector also writes it back to
      // localStorage via the `caches` setting below, so the choice
      // persists for subsequent navigations.
      order: ["querystring", "localStorage", "navigator", "htmlTag"],
      lookupQuerystring: "lang",
      caches: ["localStorage"],
      lookupLocalStorage: STORAGE_KEY,
      // Strip region tags so `en-GB`, `pt-BR`, `zh-Hans-CN` all map to
      // the base language we actually ship.
      convertDetectedLanguage: (lng) => {
        const base = lng.toLowerCase().split("-")[0];
        return SUPPORTED_LOCALES.find((l) => l.code === base)?.code ?? DEFAULT_LOCALE;
      },
    },
    react: { useSuspense: false },
  });

export default i18n;
