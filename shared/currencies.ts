// Country (ISO-3166 alpha-2) → currency (ISO-4217) mapping used by the
// per-case "country mode" feature. When an admin sets a case's `country`
// and toggles `localizedCurrencyEnabled`, the portal renders every USDT
// amount with a parenthetical estimate in the user's local currency.
//
// USDT is treated as a 1:1 USD stablecoin for conversion purposes — we
// fetch live USD→XXX rates from a public FX API.
//
// Eurozone countries all map to EUR. Anything not in this map falls back
// to USD (no conversion shown). Keep this list short and additive.
export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // North America
  US: "USD",
  CA: "CAD",
  MX: "MXN",
  // Eurozone
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR",
  FI: "EUR", FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR",
  LT: "EUR", LU: "EUR", LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR",
  SI: "EUR", SK: "EUR",
  // Other Europe
  GB: "GBP",
  CH: "CHF",
  SE: "SEK", NO: "NOK", DK: "DKK",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN",
  // APAC
  AU: "AUD", NZ: "NZD",
  JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
  KR: "KRW", SG: "SGD", MY: "MYR", TH: "THB", PH: "PHP", ID: "IDR",
  VN: "VND", IN: "INR",
  // MENA / Africa
  AE: "AED", SA: "SAR", IL: "ILS", TR: "TRY",
  ZA: "ZAR", NG: "NGN", EG: "EGP", KE: "KES",
  // South America
  BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
};

// Friendly country labels for the admin select. Order matches a
// vague "by region" grouping but isn't load-bearing — it's just so
// the dropdown doesn't look random.
export const COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "US", label: "United States (USD)" },
  { code: "CA", label: "Canada (CAD)" },
  { code: "MX", label: "Mexico (MXN)" },
  { code: "GB", label: "United Kingdom (GBP)" },
  { code: "DE", label: "Germany (EUR)" },
  { code: "FR", label: "France (EUR)" },
  { code: "IT", label: "Italy (EUR)" },
  { code: "ES", label: "Spain (EUR)" },
  { code: "NL", label: "Netherlands (EUR)" },
  { code: "BE", label: "Belgium (EUR)" },
  { code: "IE", label: "Ireland (EUR)" },
  { code: "PT", label: "Portugal (EUR)" },
  { code: "AT", label: "Austria (EUR)" },
  { code: "FI", label: "Finland (EUR)" },
  { code: "GR", label: "Greece (EUR)" },
  { code: "CH", label: "Switzerland (CHF)" },
  { code: "SE", label: "Sweden (SEK)" },
  { code: "NO", label: "Norway (NOK)" },
  { code: "DK", label: "Denmark (DKK)" },
  { code: "PL", label: "Poland (PLN)" },
  { code: "CZ", label: "Czech Republic (CZK)" },
  { code: "HU", label: "Hungary (HUF)" },
  { code: "RO", label: "Romania (RON)" },
  { code: "TR", label: "Türkiye (TRY)" },
  { code: "AU", label: "Australia (AUD)" },
  { code: "NZ", label: "New Zealand (NZD)" },
  { code: "JP", label: "Japan (JPY)" },
  { code: "CN", label: "China (CNY)" },
  { code: "HK", label: "Hong Kong (HKD)" },
  { code: "TW", label: "Taiwan (TWD)" },
  { code: "KR", label: "South Korea (KRW)" },
  { code: "SG", label: "Singapore (SGD)" },
  { code: "MY", label: "Malaysia (MYR)" },
  { code: "TH", label: "Thailand (THB)" },
  { code: "PH", label: "Philippines (PHP)" },
  { code: "ID", label: "Indonesia (IDR)" },
  { code: "VN", label: "Vietnam (VND)" },
  { code: "IN", label: "India (INR)" },
  { code: "AE", label: "United Arab Emirates (AED)" },
  { code: "SA", label: "Saudi Arabia (SAR)" },
  { code: "IL", label: "Israel (ILS)" },
  { code: "ZA", label: "South Africa (ZAR)" },
  { code: "NG", label: "Nigeria (NGN)" },
  { code: "EG", label: "Egypt (EGP)" },
  { code: "KE", label: "Kenya (KES)" },
  { code: "BR", label: "Brazil (BRL)" },
  { code: "AR", label: "Argentina (ARS)" },
  { code: "CL", label: "Chile (CLP)" },
  { code: "CO", label: "Colombia (COP)" },
  { code: "PE", label: "Peru (PEN)" },
];

export function currencyForCountry(country?: string | null): string | null {
  if (!country) return null;
  const code = country.trim().toUpperCase();
  return COUNTRY_TO_CURRENCY[code] ?? null;
}
