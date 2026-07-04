import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Guard: every non-English locale must define the exact same set of
// translation keys as English for each shared namespace. Without this,
// a contributor can add a key to `en/<ns>.json` (e.g. a new screen's
// strings) and forget the other five locales — users browsing in those
// languages then silently fall back to English. See task: "Catch missing
// translations before users see English fallback text".

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "locales");

// Namespaces intentionally kept English-only by product decision (admin
// surfaces remain English by design — see replit.md). These are exempt
// from the parity requirement.
const ENGLISH_ONLY_NAMESPACES = new Set<string>(["admin"]);

const REFERENCE_LOCALE = "en";

function isJsonFile(name: string): boolean {
  return name.endsWith(".json") && !name.startsWith("_");
}

function listLocales(): string[] {
  return readdirSync(LOCALES_DIR).filter((entry) => {
    try {
      return statSync(join(LOCALES_DIR, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

function namespaceFromFile(file: string): string {
  return file.replace(/\.json$/, "");
}

function loadNamespace(locale: string, namespace: string): Record<string, unknown> {
  const raw = readFileSync(join(LOCALES_DIR, locale, `${namespace}.json`), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// Flatten a nested translation object into dot-delimited leaf keys. Arrays
// are treated as leaves (a translated array must exist wholesale), so we do
// not recurse into them — matching how i18next consumes list-valued keys.
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenKeys(value, next));
    } else {
      out.push(next);
    }
  }
  return out;
}

const referenceNamespaces = readdirSync(join(LOCALES_DIR, REFERENCE_LOCALE))
  .filter(isJsonFile)
  .map(namespaceFromFile)
  .filter((ns) => !ENGLISH_ONLY_NAMESPACES.has(ns))
  .sort();

const otherLocales = listLocales()
  .filter((locale) => locale !== REFERENCE_LOCALE)
  .sort();

describe("i18n locale parity", () => {
  it("has reference (en) namespaces to compare against", () => {
    expect(referenceNamespaces.length).toBeGreaterThan(0);
    expect(otherLocales.length).toBeGreaterThan(0);
  });

  for (const namespace of referenceNamespaces) {
    const referenceKeys = new Set(flattenKeys(loadNamespace(REFERENCE_LOCALE, namespace)));

    for (const locale of otherLocales) {
      it(`${locale}/${namespace}.json matches en/${namespace}.json keys`, () => {
        const localeKeys = new Set(flattenKeys(loadNamespace(locale, namespace)));

        const missing = [...referenceKeys].filter((k) => !localeKeys.has(k)).sort();
        const extra = [...localeKeys].filter((k) => !referenceKeys.has(k)).sort();

        const problems: string[] = [];
        if (missing.length > 0) {
          problems.push(
            `Missing ${missing.length} key(s) in ${locale}/${namespace}.json (present in en):\n  ${missing.join("\n  ")}`,
          );
        }
        if (extra.length > 0) {
          problems.push(
            `Extra ${extra.length} key(s) in ${locale}/${namespace}.json (not in en):\n  ${extra.join("\n  ")}`,
          );
        }

        expect(problems.join("\n\n"), problems.join("\n\n")).toBe("");
      });
    }
  }
});
