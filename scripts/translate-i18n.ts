#!/usr/bin/env tsx
/**
 * translate-i18n.ts
 *
 * AI-powered translation helper: fills every [UNTRANSLATED] stub in
 * de/es/fr/pt/zh locale files using OpenAI, then writes the translations
 * back in place.
 *
 * Usage:
 *   npm run i18n:translate
 *   tsx scripts/translate-i18n.ts
 *
 *   # Limit to specific locales or namespaces:
 *   tsx scripts/translate-i18n.ts --locale de,es
 *   tsx scripts/translate-i18n.ts --namespace common.json,portal.json
 *   tsx scripts/translate-i18n.ts --locale de --namespace emails.json
 *
 *   # Dry-run: print what would be translated without writing files:
 *   tsx scripts/translate-i18n.ts --dry-run
 *
 * Exit codes:
 *   0 — completed (all stubs translated, or none found)
 *   1 — missing OPENAI_API_KEY / AI_INTEGRATIONS_OPENAI_API_KEY, or fatal error
 *
 * Idempotency guarantee:
 *   Only values that start with "[UNTRANSLATED] " are touched.  Any key that
 *   already holds a real translation is never overwritten.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../client/src/i18n/locales");

const REFERENCE_LOCALE = "en";
const UNTRANSLATED_PREFIX = "[UNTRANSLATED] ";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");

const LOCALE_FLAG_IDX = process.argv.findIndex((a) => a === "--locale");
const LOCALE_FILTER: Set<string> | null =
  LOCALE_FLAG_IDX !== -1 && process.argv[LOCALE_FLAG_IDX + 1]
    ? new Set(
        process.argv[LOCALE_FLAG_IDX + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;

const NS_FLAG_IDX = process.argv.findIndex((a) => a === "--namespace");
const NS_FILTER: Set<string> | null =
  NS_FLAG_IDX !== -1 && process.argv[NS_FLAG_IDX + 1]
    ? new Set(
        process.argv[NS_FLAG_IDX + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => (s.endsWith(".json") ? s : `${s}.json`))
      )
    : null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

// ---------------------------------------------------------------------------
// Helpers shared with check-i18n.ts
// ---------------------------------------------------------------------------

function readJson(filePath: string): JsonObject | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonObject;
  } catch {
    return null;
  }
}

function deepGet(obj: JsonObject, dotPath: string): JsonValue | undefined {
  const parts = dotPath.split(".");
  let cur: JsonValue = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur))
      return undefined;
    cur = (cur as JsonObject)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function deepSet(obj: JsonObject, dotPath: string, value: JsonValue): void {
  const parts = dotPath.split(".");
  let cur: JsonObject = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      cur[part] === undefined ||
      cur[part] === null ||
      typeof cur[part] !== "object" ||
      Array.isArray(cur[part])
    ) {
      cur[part] = {};
    }
    cur = cur[part] as JsonObject;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Collect every leaf key that still carries the [UNTRANSLATED] prefix,
 * returning dot-notation paths.
 */
function collectStubKeys(obj: JsonObject, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      return v.startsWith(UNTRANSLATED_PREFIX) ? [full] : [];
    }
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return collectStubKeys(v as JsonObject, full);
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Locale metadata
// ---------------------------------------------------------------------------

const LOCALE_NAMES: Record<string, string> = {
  de: "German",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  zh: "Chinese (Simplified)",
};

// ---------------------------------------------------------------------------
// OpenAI setup
// ---------------------------------------------------------------------------

function getOpenAI(): OpenAI {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "translate-i18n: ERROR — no OpenAI API key found.\n" +
        "  Set AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY and retry.\n"
    );
    process.exit(1);
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

// ---------------------------------------------------------------------------
// Translation: one OpenAI call per (locale, namespace) batch
// ---------------------------------------------------------------------------

/**
 * Ask OpenAI to translate a flat map of { dotKey → englishValue } into the
 * target locale.  Returns a flat map of { dotKey → translatedValue }.
 *
 * The request/response both use compact JSON so the token budget stays small
 * even for large namespaces.
 */
async function translateBatch(
  openai: OpenAI,
  locale: string,
  namespace: string,
  entries: Record<string, string>
): Promise<Record<string, string>> {
  const localeName = LOCALE_NAMES[locale] ?? locale;
  const keyCount = Object.keys(entries).length;

  const systemPrompt = [
    `You are a professional translator for a web application called IBCCF (International Blockchain Complaints Forum).`,
    `The application helps users report blockchain fraud, verify platforms, manage compliance cases, and participate in a moderated community.`,
    `Your task is to translate UI strings from English to ${localeName}.`,
    ``,
    `Rules:`,
    `- Preserve every {{variable}} placeholder exactly as-is (e.g. {{count}}, {{name}}, {{locale}}).`,
    `- Preserve every HTML tag or markup fragment exactly as-is.`,
    `- Match the tone: professional, clear, and approachable. Avoid overly formal or legalistic phrasing.`,
    `- Do NOT translate proper nouns: IBCCF, blockchain, Bitcoin, Ethereum, etc.`,
    `- Respond with a JSON object only — no markdown, no explanation, no code block.`,
    `- The JSON object must have exactly the same keys as the input, with each value replaced by the ${localeName} translation.`,
  ].join("\n");

  const userMessage = JSON.stringify(entries);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw) as Record<string, string>;
  } catch {
    process.stderr.write(
      `translate-i18n: WARNING — could not parse OpenAI response for ${locale}/${namespace}.\n` +
        `  Raw response: ${raw.slice(0, 200)}\n`
    );
    return {};
  }

  // Verify we got back the expected keys; warn on any gaps
  const missingKeys = Object.keys(entries).filter(
    (k) => typeof parsed[k] !== "string" || parsed[k].trim() === ""
  );
  if (missingKeys.length > 0) {
    process.stderr.write(
      `translate-i18n: WARNING — ${locale}/${namespace}: OpenAI did not return translations for ` +
        `${missingKeys.length}/${keyCount} key(s):\n`
    );
    for (const k of missingKeys.slice(0, 10)) {
      process.stderr.write(`    ${k}\n`);
    }
    if (missingKeys.length > 10) {
      process.stderr.write(`    … and ${missingKeys.length - 10} more\n`);
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const openai = DRY_RUN ? null : getOpenAI();

  // Discover locales
  const allLocales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== REFERENCE_LOCALE)
    .map((d) => d.name)
    .sort();

  const targetLocales = LOCALE_FILTER
    ? allLocales.filter((l) => LOCALE_FILTER.has(l))
    : allLocales;

  // Discover namespaces from the English reference
  const allNamespaces = fs
    .readdirSync(path.join(LOCALES_DIR, REFERENCE_LOCALE))
    .filter((f) => f.endsWith(".json") && f !== "_meta.json")
    .sort();

  const targetNamespaces = NS_FILTER
    ? allNamespaces.filter((ns) => NS_FILTER.has(ns))
    : allNamespaces;

  if (targetLocales.length === 0) {
    process.stderr.write(
      "translate-i18n: no matching locales found. Check --locale filter.\n"
    );
    process.exit(1);
  }

  if (targetNamespaces.length === 0) {
    process.stderr.write(
      "translate-i18n: no matching namespaces found. Check --namespace filter.\n"
    );
    process.exit(1);
  }

  process.stdout.write(
    `\ntranslate-i18n${DRY_RUN ? " [DRY RUN]" : ""}: scanning ${targetLocales.length} locale(s) × ${targetNamespaces.length} namespace(s)\n`
  );
  process.stdout.write(`  Locales: ${targetLocales.join(", ")}\n\n`);

  let totalStubs = 0;
  let totalTranslated = 0;
  let totalFiles = 0;

  for (const locale of targetLocales) {
    for (const ns of targetNamespaces) {
      const localePath = path.join(LOCALES_DIR, locale, ns);
      const localeJson = readJson(localePath);

      if (!localeJson) {
        process.stdout.write(
          `  [SKIP] ${locale}/${ns} — file not found (run npm run i18n:fix first)\n`
        );
        continue;
      }

      const stubKeys = collectStubKeys(localeJson);
      if (stubKeys.length === 0) {
        continue;
      }

      totalStubs += stubKeys.length;
      process.stdout.write(
        `  ${locale}/${ns} — ${stubKeys.length} stub(s) to translate\n`
      );

      if (DRY_RUN) {
        for (const key of stubKeys) {
          const raw = deepGet(localeJson, key);
          const english =
            typeof raw === "string"
              ? raw.replace(UNTRANSLATED_PREFIX, "")
              : String(raw);
          process.stdout.write(`      ${key}: ${english}\n`);
        }
        continue;
      }

      // Build the flat map of dotKey → english source text
      const entries: Record<string, string> = {};
      for (const key of stubKeys) {
        const raw = deepGet(localeJson, key);
        if (typeof raw === "string") {
          entries[key] = raw.replace(UNTRANSLATED_PREFIX, "");
        }
      }

      // Translate this batch
      let translations: Record<string, string>;
      try {
        translations = await translateBatch(openai!, locale, ns, entries);
      } catch (err) {
        process.stderr.write(
          `translate-i18n: ERROR translating ${locale}/${ns}: ${String(err)}\n`
        );
        continue;
      }

      // Apply translations back to the locale JSON (only real translations)
      let applied = 0;
      for (const key of stubKeys) {
        const translated = translations[key];
        if (typeof translated === "string" && translated.trim() !== "") {
          deepSet(localeJson, key, translated);
          applied++;
        }
      }

      if (applied > 0) {
        fs.writeFileSync(
          localePath,
          JSON.stringify(localeJson, null, 2) + "\n",
          "utf8"
        );
        totalTranslated += applied;
        totalFiles++;
        process.stdout.write(
          `    ✓ wrote ${applied}/${stubKeys.length} translation(s)\n`
        );
      }

      const skipped = stubKeys.length - applied;
      if (skipped > 0) {
        process.stdout.write(
          `    ⚠ ${skipped} key(s) were not translated (OpenAI returned no value)\n`
        );
      }
    }
  }

  process.stdout.write("\n");

  if (totalStubs === 0) {
    process.stdout.write(
      "translate-i18n: no [UNTRANSLATED] stubs found — nothing to do.\n\n"
    );
    process.exit(0);
  }

  if (DRY_RUN) {
    process.stdout.write(
      `translate-i18n [DRY RUN]: found ${totalStubs} stub(s) across ${targetLocales.length} locale(s).\n` +
        `  Re-run without --dry-run to translate them.\n\n`
    );
    process.exit(0);
  }

  const remaining = totalStubs - totalTranslated;

  process.stdout.write(
    `translate-i18n: done — translated ${totalTranslated}/${totalStubs} stub(s) in ${totalFiles} file(s).\n`
  );

  if (remaining > 0) {
    process.stderr.write(
      `\ntranslate-i18n: ERROR — ${remaining} stub(s) could not be translated (see warnings above).\n` +
        `  Re-run npm run i18n:translate to retry, or fill them manually.\n` +
        `  Run npm run check:untranslated-strict to see which keys remain.\n\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `  Run npm run check:untranslated-strict to verify everything is clean.\n\n`
  );
}

main().catch((err) => {
  process.stderr.write(`translate-i18n: fatal error — ${String(err)}\n`);
  process.exit(1);
});
