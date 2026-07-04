// One-shot translation script.
// For every locale in {es, fr, de, pt, zh}, for every namespace JSON in
// client/src/i18n/locales/en/*.json (excluding _meta.json), call OpenAI to
// produce a structurally-identical JSON whose values are translated into the
// target language, then write to client/src/i18n/locales/<code>/<ns>.json.
//
// Preserves verbatim: brand names (IBCCF), regulatory acronyms (FATF, FinCEN,
// OFAC, ISO/IEC 27001, MiCA, etc.), URLs, numeric tokens, percentages, "USDT",
// "USDC", interpolation placeholders like {{name}}, and the deposit-messaging
// breakdown (1,000 USDT refundable activation balance + 500 USDT non-refundable
// processing fee, plus the 30% Phrase Key Merge Deposit wording).

import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import pLimit from "p-limit";

const ROOT = path.resolve(process.cwd(), "client/src/i18n/locales");
const TARGETS = [
  { code: "es", name: "Spanish (Castilian, formal usted)" },
  { code: "fr", name: "French (formal vous)" },
  { code: "de", name: "German (formal Sie)" },
  { code: "pt", name: "Portuguese (Brazilian, formal você)" },
  { code: "zh", name: "Simplified Chinese (zh-Hans, professional register)" },
];

const client = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
const concurrency = pLimit(6);

const PRESERVE_RULES = `
PRESERVATION RULES (do not translate or reword these):
- Brand: "IBCCF"
- Acronyms / regulatory references kept verbatim: FATF, FinCEN, OFAC, SEC, FFIEC, NIST, ISO/IEC 27001, ISO 20022, MiCA, MiFID II, PSD2, COSO, COSO 2013, FATCA, CRS, CARF, OECD, IRS, EBA, ESMA, BIP 65, EIP-1559, KYT, MEV, HSM, MPC, AAL2, SCA, AML, CTR, CDD, EDD, USA PATRIOT Act, BSA, FINRA, FBAR, EU AML, AS 2410, ISA 600, ISA 230, SAB 121, T+1, ICT, KYC, FATCA/CRS, USA, EU, UK, US, UN
- Currency tickers and assets verbatim: USDT, USDC, BTC, ETH, DAI, Polygon, Bitcoin, Ethereum
- All numeric tokens, percentages, money amounts and units stay verbatim — never localise digits or change numbers (1,000 USDT, 500 USDT, 30%, 1,500 USDT, 24 hours, etc.).
- Deposit-messaging breakdown for stage 7: keep "1,000 USDT refundable activation balance" and "500 USDT non-refundable processing fee" as a literal monetary breakdown — translate only the surrounding prose. Same for "30% Phrase Key Merge Deposit" — preserve the percentage and the term.
- All ICU / i18next interpolation placeholders kept exactly: {{name}}, {{case}}, {{count}}, {{date}}, etc.
- HTML tags kept exactly (<strong>, <br/>, etc.) if any appear inside strings.
- URLs, email addresses, phone numbers, file names, and route paths kept exactly.
- Keys (the JSON property names) kept exactly. Translate VALUES only.
- Preserve the order and shape of arrays.
- Do not add or drop keys.
- For "title" / "subject" style strings, keep concise and capitalised per target language conventions.
- For "label" strings under any "regulatoryBasis" or legal-citation list — if encountered, keep the citation in English (these are legal references).
`;

async function translateJson(targetCode, targetName, ns, enJson) {
  const sys = `You are a professional UI/legal localisation translator translating from English to ${targetName} for a regulated cryptocurrency complaints / compliance portal. Output ONLY valid JSON with the exact same shape as the input. Do not wrap in markdown.`;

  const user = `Translate every string value in this JSON to ${targetName}. Return JSON only with identical structure.\n${PRESERVE_RULES}\n\nNamespace: ${ns}\n\nINPUT:\n${JSON.stringify(enJson, null, 2)}`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const txt = resp.choices[0]?.message?.content?.trim() ?? "";
  return JSON.parse(txt);
}

async function main() {
  const enFiles = (await fs.readdir(path.join(ROOT, "en")))
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  const FORCE = process.env.FORCE === "1";

  function deepKeyCount(obj) {
    let n = 0;
    if (obj && typeof obj === "object") {
      for (const v of Array.isArray(obj) ? obj : Object.values(obj)) {
        if (v && typeof v === "object") n += deepKeyCount(v);
        else n += 1;
      }
    }
    return n;
  }

  async function isAlreadyTranslated(outPath, en) {
    try {
      const existing = JSON.parse(await fs.readFile(outPath, "utf8"));
      // If the existing translated file has at least 90% of the EN leaf count,
      // consider it done. Heuristic: re-translation only happens if EN grew.
      const enLeaves = deepKeyCount(en);
      const existingLeaves = deepKeyCount(existing);
      return existingLeaves >= Math.floor(enLeaves * 0.9) && existingLeaves > 0;
    } catch {
      return false;
    }
  }

  async function withRetries(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  const jobs = [];
  for (const target of TARGETS) {
    for (const file of enFiles) {
      jobs.push(
        concurrency(async () => {
          const enPath = path.join(ROOT, "en", file);
          const outPath = path.join(ROOT, target.code, file);
          const en = JSON.parse(await fs.readFile(enPath, "utf8"));
          if (!FORCE && (await isAlreadyTranslated(outPath, en))) {
            console.log(`SKIP ${target.code}/${file} (already up to date)`);
            return { target: target.code, file, ok: true };
          }
          const ns = file.replace(/\.json$/, "");
          let translated;
          try {
            translated = await withRetries(
              () => translateJson(target.code, target.name, ns, en),
              3,
            );
          } catch (err) {
            console.error(`FAIL ${target.code}/${file}: ${err.message}`);
            return { target: target.code, file, ok: false };
          }
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, JSON.stringify(translated, null, 2) + "\n");
          console.log(`OK ${target.code}/${file}`);
          return { target: target.code, file, ok: true };
        }),
      );
    }
  }
  const results = await Promise.all(jobs);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nDone: ${results.length - failed.length}/${results.length} succeeded.`);
  if (failed.length) {
    console.log("Failed:", JSON.stringify(failed));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
