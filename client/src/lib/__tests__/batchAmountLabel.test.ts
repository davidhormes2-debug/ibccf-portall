// @vitest-environment node
//
// Unit tests for extractBatchAmountLabel — the helper that strips the
// "Batch merge fee: " prefix from a receipt's notes field before displaying
// it in Batch History rows.  The regex lives in a single place so a format
// change (capitalisation, colon placement, etc.) can be caught and fixed
// without silently showing the raw notes string in the UI.

import { describe, it, expect } from "vitest";
import { extractBatchAmountLabel } from "../batchAmountLabel";

describe("extractBatchAmountLabel", () => {
  it("strips the standard prefix and returns the amount", () => {
    expect(extractBatchAmountLabel("Batch merge fee: 250 USDT")).toBe("250 USDT");
  });

  it("is case-insensitive for the prefix", () => {
    expect(extractBatchAmountLabel("batch merge fee: 100 USDT")).toBe("100 USDT");
    expect(extractBatchAmountLabel("BATCH MERGE FEE: 500 USDT")).toBe("500 USDT");
    expect(extractBatchAmountLabel("Batch Merge Fee: 75.50 USDT")).toBe("75.50 USDT");
  });

  it("trims surrounding whitespace from the result", () => {
    expect(extractBatchAmountLabel("Batch merge fee:   250 USDT  ")).toBe("250 USDT");
  });

  it("returns raw notes when the prefix is absent", () => {
    expect(extractBatchAmountLabel("250 USDT")).toBe("250 USDT");
    expect(extractBatchAmountLabel("Some other note")).toBe("Some other note");
  });

  it("returns em-dash for null input", () => {
    expect(extractBatchAmountLabel(null)).toBe("—");
  });

  it("returns em-dash for undefined input", () => {
    expect(extractBatchAmountLabel(undefined)).toBe("—");
  });

  it("returns em-dash for empty string", () => {
    expect(extractBatchAmountLabel("")).toBe("—");
  });
});
