import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPublicBaseUrl,
  getPublicAdminUrl,
  CANONICAL_FALLBACK_BASE_URL,
} from "../lib/publicBaseUrl";

const ENV_KEYS = [
  "PUBLIC_BASE_URL",
  "APP_BASE_URL",
  "REPLIT_DOMAINS",
  "REPLIT_DEV_DOMAIN",
] as const;

describe("publicBaseUrl", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe("getPublicBaseUrl - full set/unset combination matrix", () => {
    const PUBLIC = "https://public.example";
    const APP = "https://app-legacy.example";
    const DOMAINS = "replit-deployed.example";
    const DEV = "replit-dev.example";

    type Combo = {
      publicBaseUrl?: string;
      appBaseUrl?: string;
      replitDomains?: string;
      replitDevDomain?: string;
      label?: string;
    };

    function expectedFor(combo: Combo): string {
      if (combo.publicBaseUrl) return combo.publicBaseUrl;
      if (combo.appBaseUrl) return combo.appBaseUrl;
      if (combo.replitDomains) return `https://${combo.replitDomains}`;
      if (combo.replitDevDomain) return `https://${combo.replitDevDomain}`;
      return CANONICAL_FALLBACK_BASE_URL;
    }

    function describeCombo(combo: Combo): string {
      const parts: string[] = [];
      parts.push(`PUBLIC_BASE_URL=${combo.publicBaseUrl ? "set" : "unset"}`);
      parts.push(`APP_BASE_URL=${combo.appBaseUrl ? "set" : "unset"}`);
      parts.push(`REPLIT_DOMAINS=${combo.replitDomains ? "set" : "unset"}`);
      parts.push(`REPLIT_DEV_DOMAIN=${combo.replitDevDomain ? "set" : "unset"}`);
      return parts.join(", ");
    }

    // Enumerate all 16 combinations (2^4) of set/unset for the four vars,
    // using a fixed bit order: [PUBLIC_BASE_URL, APP_BASE_URL, REPLIT_DOMAINS, REPLIT_DEV_DOMAIN].
    const combos: Combo[] = [];
    for (let mask = 0; mask < 16; mask++) {
      const combo: Combo = {
        publicBaseUrl: mask & 0b1000 ? PUBLIC : undefined,
        appBaseUrl: mask & 0b0100 ? APP : undefined,
        replitDomains: mask & 0b0010 ? DOMAINS : undefined,
        replitDevDomain: mask & 0b0001 ? DEV : undefined,
      };
      combo.label = describeCombo(combo);
      combos.push(combo);
    }

    it.each(combos)(
      "resolves the correct base and admin URL when $label",
      (combo: Combo) => {
        if (combo.publicBaseUrl) process.env.PUBLIC_BASE_URL = combo.publicBaseUrl;
        if (combo.appBaseUrl) process.env.APP_BASE_URL = combo.appBaseUrl;
        if (combo.replitDomains) process.env.REPLIT_DOMAINS = combo.replitDomains;
        if (combo.replitDevDomain) process.env.REPLIT_DEV_DOMAIN = combo.replitDevDomain;

        const expected = expectedFor(combo);
        expect(getPublicBaseUrl()).toBe(expected);
        expect(getPublicAdminUrl()).toBe(`${expected}/admin`);
      },
    );
  });

  describe("getPublicBaseUrl", () => {
    it("falls back to the canonical hard-coded URL when nothing is set", () => {
      expect(getPublicBaseUrl()).toBe(CANONICAL_FALLBACK_BASE_URL);
    });

    it("uses REPLIT_DEV_DOMAIN when only that is set", () => {
      process.env.REPLIT_DEV_DOMAIN = "my-repl.dev.example";
      expect(getPublicBaseUrl()).toBe("https://my-repl.dev.example");
    });

    it("strips a trailing slash from REPLIT_DEV_DOMAIN-derived URLs", () => {
      process.env.REPLIT_DEV_DOMAIN = "my-repl.dev.example/";
      expect(getPublicBaseUrl()).toBe("https://my-repl.dev.example");
    });

    it("uses the first REPLIT_DOMAINS entry when only that is set", () => {
      process.env.REPLIT_DOMAINS = "primary.example, secondary.example";
      expect(getPublicBaseUrl()).toBe("https://primary.example");
    });

    it("prefers REPLIT_DOMAINS over REPLIT_DEV_DOMAIN", () => {
      process.env.REPLIT_DOMAINS = "deployed.example";
      process.env.REPLIT_DEV_DOMAIN = "dev.example";
      expect(getPublicBaseUrl()).toBe("https://deployed.example");
    });

    it("falls back to REPLIT_DEV_DOMAIN when REPLIT_DOMAINS is empty/blank", () => {
      process.env.REPLIT_DOMAINS = "   ";
      process.env.REPLIT_DEV_DOMAIN = "dev.example";
      expect(getPublicBaseUrl()).toBe("https://dev.example");
    });

    it("uses APP_BASE_URL when only that is set", () => {
      process.env.APP_BASE_URL = "https://legacy.example/";
      expect(getPublicBaseUrl()).toBe("https://legacy.example");
    });

    it("prefers APP_BASE_URL over REPLIT_DOMAINS and REPLIT_DEV_DOMAIN", () => {
      process.env.APP_BASE_URL = "https://legacy.example";
      process.env.REPLIT_DOMAINS = "deployed.example";
      process.env.REPLIT_DEV_DOMAIN = "dev.example";
      expect(getPublicBaseUrl()).toBe("https://legacy.example");
    });

    it("uses PUBLIC_BASE_URL when only that is set", () => {
      process.env.PUBLIC_BASE_URL = "https://example.com/";
      expect(getPublicBaseUrl()).toBe("https://example.com");
    });

    it("prefers PUBLIC_BASE_URL over every other variable", () => {
      process.env.PUBLIC_BASE_URL = "https://example.com";
      process.env.APP_BASE_URL = "https://legacy.example";
      process.env.REPLIT_DOMAINS = "deployed.example";
      process.env.REPLIT_DEV_DOMAIN = "dev.example";
      expect(getPublicBaseUrl()).toBe("https://example.com");
    });

    it("treats a blank PUBLIC_BASE_URL as unset and falls through to APP_BASE_URL", () => {
      process.env.PUBLIC_BASE_URL = "   ";
      process.env.APP_BASE_URL = "https://legacy.example";
      expect(getPublicBaseUrl()).toBe("https://legacy.example");
    });

    it("treats a blank APP_BASE_URL as unset and falls through to REPLIT_DOMAINS", () => {
      process.env.APP_BASE_URL = "   ";
      process.env.REPLIT_DOMAINS = "deployed.example";
      expect(getPublicBaseUrl()).toBe("https://deployed.example");
    });

    it("trims surrounding whitespace on PUBLIC_BASE_URL", () => {
      process.env.PUBLIC_BASE_URL = "  https://example.com  ";
      expect(getPublicBaseUrl()).toBe("https://example.com");
    });

    it("strips multiple trailing slashes from PUBLIC_BASE_URL", () => {
      process.env.PUBLIC_BASE_URL = "https://example.com///";
      expect(getPublicBaseUrl()).toBe("https://example.com");
    });
  });

  describe("getPublicAdminUrl", () => {
    it("appends /admin to the resolved base URL (canonical fallback)", () => {
      expect(getPublicAdminUrl()).toBe(`${CANONICAL_FALLBACK_BASE_URL}/admin`);
    });

    it("appends /admin to a PUBLIC_BASE_URL override", () => {
      process.env.PUBLIC_BASE_URL = "https://example.com";
      expect(getPublicAdminUrl()).toBe("https://example.com/admin");
    });

    it("appends /admin to a REPLIT_DOMAINS-derived URL", () => {
      process.env.REPLIT_DOMAINS = "deployed.example";
      expect(getPublicAdminUrl()).toBe("https://deployed.example/admin");
    });
  });
});
