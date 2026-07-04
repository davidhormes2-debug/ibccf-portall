// @vitest-environment node
//
// Exhaustiveness guards for *_STATUS_* maps in shared/constants.ts.
//
// Each suite asserts that every value in a *_STATUSES source array has a
// corresponding entry in the matching *_STATUS_LABELS and *_STATUS_COLORS maps,
// and that no extra keys appear in the maps beyond the source array.  Adding a
// new status value without updating both maps will cause the tests to fail.

import { describe, it, expect } from "vitest";
import {
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_COLORS,
  CERTIFICATE_FEE_STATUSES,
  CERTIFICATE_FEE_STATUS_LABELS,
  CERTIFICATE_FEE_STATUS_COLORS,
  STAMP_DUTY_STATUSES,
  STAMP_DUTY_STATUS_LABELS,
  STAMP_DUTY_STATUS_COLORS,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_REQUEST_STATUS_LABELS,
  DOCUMENT_REQUEST_STATUS_COLORS,
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  CASE_STATUS_COLORS,
  MESSAGE_CATEGORY_STATUSES,
  MESSAGE_CATEGORY_LABELS,
  MESSAGE_CATEGORY_COLORS,
  PRIORITY_STATUSES,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
} from "../constants";

describe("RECEIPT_STATUS maps exhaustiveness", () => {
  it("RECEIPT_STATUS_LABELS has an entry for every RECEIPT_STATUS value", () => {
    for (const status of RECEIPT_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(RECEIPT_STATUS_LABELS, status),
        `RECEIPT_STATUS_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("RECEIPT_STATUS_COLORS has an entry for every RECEIPT_STATUS value", () => {
    for (const status of RECEIPT_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(RECEIPT_STATUS_COLORS, status),
        `RECEIPT_STATUS_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("RECEIPT_STATUS_LABELS has no extra keys beyond RECEIPT_STATUSES", () => {
    const known = new Set<string>(RECEIPT_STATUSES);
    for (const key of Object.keys(RECEIPT_STATUS_LABELS)) {
      expect(
        known.has(key),
        `RECEIPT_STATUS_LABELS has an unexpected key "${key}" not present in RECEIPT_STATUSES`
      ).toBe(true);
    }
  });

  it("RECEIPT_STATUS_COLORS has no extra keys beyond RECEIPT_STATUSES", () => {
    const known = new Set<string>(RECEIPT_STATUSES);
    for (const key of Object.keys(RECEIPT_STATUS_COLORS)) {
      expect(
        known.has(key),
        `RECEIPT_STATUS_COLORS has an unexpected key "${key}" not present in RECEIPT_STATUSES`
      ).toBe(true);
    }
  });

  it("RECEIPT_STATUS_LABELS values are non-empty strings", () => {
    for (const status of RECEIPT_STATUSES) {
      const label = RECEIPT_STATUS_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("RECEIPT_STATUS_COLORS values are non-empty strings", () => {
    for (const status of RECEIPT_STATUSES) {
      const color = RECEIPT_STATUS_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("CERTIFICATE_FEE_STATUS maps exhaustiveness", () => {
  it("CERTIFICATE_FEE_STATUS_LABELS has an entry for every CERTIFICATE_FEE_STATUS value", () => {
    for (const status of CERTIFICATE_FEE_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(CERTIFICATE_FEE_STATUS_LABELS, status),
        `CERTIFICATE_FEE_STATUS_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("CERTIFICATE_FEE_STATUS_COLORS has an entry for every CERTIFICATE_FEE_STATUS value", () => {
    for (const status of CERTIFICATE_FEE_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(CERTIFICATE_FEE_STATUS_COLORS, status),
        `CERTIFICATE_FEE_STATUS_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("CERTIFICATE_FEE_STATUS_LABELS has no extra keys beyond CERTIFICATE_FEE_STATUSES", () => {
    const known = new Set<string>(CERTIFICATE_FEE_STATUSES);
    for (const key of Object.keys(CERTIFICATE_FEE_STATUS_LABELS)) {
      expect(
        known.has(key),
        `CERTIFICATE_FEE_STATUS_LABELS has an unexpected key "${key}" not present in CERTIFICATE_FEE_STATUSES`
      ).toBe(true);
    }
  });

  it("CERTIFICATE_FEE_STATUS_COLORS has no extra keys beyond CERTIFICATE_FEE_STATUSES", () => {
    const known = new Set<string>(CERTIFICATE_FEE_STATUSES);
    for (const key of Object.keys(CERTIFICATE_FEE_STATUS_COLORS)) {
      expect(
        known.has(key),
        `CERTIFICATE_FEE_STATUS_COLORS has an unexpected key "${key}" not present in CERTIFICATE_FEE_STATUSES`
      ).toBe(true);
    }
  });

  it("CERTIFICATE_FEE_STATUS_LABELS values are non-empty strings", () => {
    for (const status of CERTIFICATE_FEE_STATUSES) {
      const label = CERTIFICATE_FEE_STATUS_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("CERTIFICATE_FEE_STATUS_COLORS values are non-empty strings", () => {
    for (const status of CERTIFICATE_FEE_STATUSES) {
      const color = CERTIFICATE_FEE_STATUS_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("STAMP_DUTY_STATUS maps exhaustiveness", () => {
  it("STAMP_DUTY_STATUS_LABELS has an entry for every STAMP_DUTY_STATUS value", () => {
    for (const status of STAMP_DUTY_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(STAMP_DUTY_STATUS_LABELS, status),
        `STAMP_DUTY_STATUS_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("STAMP_DUTY_STATUS_COLORS has an entry for every STAMP_DUTY_STATUS value", () => {
    for (const status of STAMP_DUTY_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(STAMP_DUTY_STATUS_COLORS, status),
        `STAMP_DUTY_STATUS_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("STAMP_DUTY_STATUS_LABELS has no extra keys beyond STAMP_DUTY_STATUSES", () => {
    const known = new Set<string>(STAMP_DUTY_STATUSES);
    for (const key of Object.keys(STAMP_DUTY_STATUS_LABELS)) {
      expect(
        known.has(key),
        `STAMP_DUTY_STATUS_LABELS has an unexpected key "${key}" not present in STAMP_DUTY_STATUSES`
      ).toBe(true);
    }
  });

  it("STAMP_DUTY_STATUS_COLORS has no extra keys beyond STAMP_DUTY_STATUSES", () => {
    const known = new Set<string>(STAMP_DUTY_STATUSES);
    for (const key of Object.keys(STAMP_DUTY_STATUS_COLORS)) {
      expect(
        known.has(key),
        `STAMP_DUTY_STATUS_COLORS has an unexpected key "${key}" not present in STAMP_DUTY_STATUSES`
      ).toBe(true);
    }
  });

  it("STAMP_DUTY_STATUS_LABELS values are non-empty strings", () => {
    for (const status of STAMP_DUTY_STATUSES) {
      const label = STAMP_DUTY_STATUS_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("STAMP_DUTY_STATUS_COLORS values are non-empty strings", () => {
    for (const status of STAMP_DUTY_STATUSES) {
      const color = STAMP_DUTY_STATUS_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("DOCUMENT_REQUEST_STATUS maps exhaustiveness", () => {
  it("DOCUMENT_REQUEST_STATUS_LABELS has an entry for every DOCUMENT_REQUEST_STATUS value", () => {
    for (const status of DOCUMENT_REQUEST_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(DOCUMENT_REQUEST_STATUS_LABELS, status),
        `DOCUMENT_REQUEST_STATUS_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("DOCUMENT_REQUEST_STATUS_COLORS has an entry for every DOCUMENT_REQUEST_STATUS value", () => {
    for (const status of DOCUMENT_REQUEST_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(DOCUMENT_REQUEST_STATUS_COLORS, status),
        `DOCUMENT_REQUEST_STATUS_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("DOCUMENT_REQUEST_STATUS_LABELS has no extra keys beyond DOCUMENT_REQUEST_STATUSES", () => {
    const known = new Set<string>(DOCUMENT_REQUEST_STATUSES);
    for (const key of Object.keys(DOCUMENT_REQUEST_STATUS_LABELS)) {
      expect(
        known.has(key),
        `DOCUMENT_REQUEST_STATUS_LABELS has an unexpected key "${key}" not present in DOCUMENT_REQUEST_STATUSES`
      ).toBe(true);
    }
  });

  it("DOCUMENT_REQUEST_STATUS_COLORS has no extra keys beyond DOCUMENT_REQUEST_STATUSES", () => {
    const known = new Set<string>(DOCUMENT_REQUEST_STATUSES);
    for (const key of Object.keys(DOCUMENT_REQUEST_STATUS_COLORS)) {
      expect(
        known.has(key),
        `DOCUMENT_REQUEST_STATUS_COLORS has an unexpected key "${key}" not present in DOCUMENT_REQUEST_STATUSES`
      ).toBe(true);
    }
  });

  it("DOCUMENT_REQUEST_STATUS_LABELS values are non-empty strings", () => {
    for (const status of DOCUMENT_REQUEST_STATUSES) {
      const label = DOCUMENT_REQUEST_STATUS_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("DOCUMENT_REQUEST_STATUS_COLORS values are non-empty strings", () => {
    for (const status of DOCUMENT_REQUEST_STATUSES) {
      const color = DOCUMENT_REQUEST_STATUS_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("CASE_STATUS maps exhaustiveness", () => {
  it("CASE_STATUS_LABELS has an entry for every CASE_STATUS value", () => {
    for (const status of CASE_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(CASE_STATUS_LABELS, status),
        `CASE_STATUS_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("CASE_STATUS_COLORS has an entry for every CASE_STATUS value", () => {
    for (const status of CASE_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(CASE_STATUS_COLORS, status),
        `CASE_STATUS_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("CASE_STATUS_LABELS has no extra keys beyond CASE_STATUSES", () => {
    const known = new Set<string>(CASE_STATUSES);
    for (const key of Object.keys(CASE_STATUS_LABELS)) {
      expect(
        known.has(key),
        `CASE_STATUS_LABELS has an unexpected key "${key}" not present in CASE_STATUSES`
      ).toBe(true);
    }
  });

  it("CASE_STATUS_COLORS has no extra keys beyond CASE_STATUSES", () => {
    const known = new Set<string>(CASE_STATUSES);
    for (const key of Object.keys(CASE_STATUS_COLORS)) {
      expect(
        known.has(key),
        `CASE_STATUS_COLORS has an unexpected key "${key}" not present in CASE_STATUSES`
      ).toBe(true);
    }
  });

  it("CASE_STATUS_LABELS values are non-empty strings", () => {
    for (const status of CASE_STATUSES) {
      const label = CASE_STATUS_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("CASE_STATUS_COLORS values are non-empty strings", () => {
    for (const status of CASE_STATUSES) {
      const color = CASE_STATUS_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("MESSAGE_CATEGORY maps exhaustiveness", () => {
  it("MESSAGE_CATEGORY_LABELS has an entry for every MESSAGE_CATEGORY_STATUS value", () => {
    for (const status of MESSAGE_CATEGORY_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(MESSAGE_CATEGORY_LABELS, status),
        `MESSAGE_CATEGORY_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("MESSAGE_CATEGORY_COLORS has an entry for every MESSAGE_CATEGORY_STATUS value", () => {
    for (const status of MESSAGE_CATEGORY_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(MESSAGE_CATEGORY_COLORS, status),
        `MESSAGE_CATEGORY_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("MESSAGE_CATEGORY_LABELS has no extra keys beyond MESSAGE_CATEGORY_STATUSES", () => {
    const known = new Set<string>(MESSAGE_CATEGORY_STATUSES);
    for (const key of Object.keys(MESSAGE_CATEGORY_LABELS)) {
      expect(
        known.has(key),
        `MESSAGE_CATEGORY_LABELS has an unexpected key "${key}" not present in MESSAGE_CATEGORY_STATUSES`
      ).toBe(true);
    }
  });

  it("MESSAGE_CATEGORY_COLORS has no extra keys beyond MESSAGE_CATEGORY_STATUSES", () => {
    const known = new Set<string>(MESSAGE_CATEGORY_STATUSES);
    for (const key of Object.keys(MESSAGE_CATEGORY_COLORS)) {
      expect(
        known.has(key),
        `MESSAGE_CATEGORY_COLORS has an unexpected key "${key}" not present in MESSAGE_CATEGORY_STATUSES`
      ).toBe(true);
    }
  });

  it("MESSAGE_CATEGORY_LABELS values are non-empty strings", () => {
    for (const status of MESSAGE_CATEGORY_STATUSES) {
      const label = MESSAGE_CATEGORY_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("MESSAGE_CATEGORY_COLORS values are non-empty strings", () => {
    for (const status of MESSAGE_CATEGORY_STATUSES) {
      const color = MESSAGE_CATEGORY_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("PRIORITY maps exhaustiveness", () => {
  it("PRIORITY_LABELS has an entry for every PRIORITY_STATUS value", () => {
    for (const status of PRIORITY_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, status),
        `PRIORITY_LABELS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("PRIORITY_COLORS has an entry for every PRIORITY_STATUS value", () => {
    for (const status of PRIORITY_STATUSES) {
      expect(
        Object.prototype.hasOwnProperty.call(PRIORITY_COLORS, status),
        `PRIORITY_COLORS is missing an entry for "${status}"`
      ).toBe(true);
    }
  });

  it("PRIORITY_LABELS has no extra keys beyond PRIORITY_STATUSES", () => {
    const known = new Set<string>(PRIORITY_STATUSES);
    for (const key of Object.keys(PRIORITY_LABELS)) {
      expect(
        known.has(key),
        `PRIORITY_LABELS has an unexpected key "${key}" not present in PRIORITY_STATUSES`
      ).toBe(true);
    }
  });

  it("PRIORITY_COLORS has no extra keys beyond PRIORITY_STATUSES", () => {
    const known = new Set<string>(PRIORITY_STATUSES);
    for (const key of Object.keys(PRIORITY_COLORS)) {
      expect(
        known.has(key),
        `PRIORITY_COLORS has an unexpected key "${key}" not present in PRIORITY_STATUSES`
      ).toBe(true);
    }
  });

  it("PRIORITY_LABELS values are non-empty strings", () => {
    for (const status of PRIORITY_STATUSES) {
      const label = PRIORITY_LABELS[status];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("PRIORITY_COLORS values are non-empty strings", () => {
    for (const status of PRIORITY_STATUSES) {
      const color = PRIORITY_COLORS[status];
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});
