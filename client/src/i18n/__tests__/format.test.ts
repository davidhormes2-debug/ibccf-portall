// @vitest-environment jsdom
//
// Task #282 — Unit tests for the `formatRelative` path in useFormat().
//
// The session expiry banner delegates all time-remaining formatting to
// `formatRelative` from client/src/i18n/format.ts. This file pins the
// threshold behaviour that determines whether the result comes back as
// "in X hours" or "in X minutes" depending on how much time is left.
//
// Boundary (from format.ts):
//   abs < hours  (< 3 600 000 ms)  → Intl.RelativeTimeFormat "minute" unit
//   abs < days   (< 86 400 000 ms) → Intl.RelativeTimeFormat "hour" unit
//   otherwise                       → Intl.RelativeTimeFormat "day" unit

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: { code: "en", label: "English", nativeLabel: "English", bcp47: "en" },
  }),
}));

import { useFormat } from "@/i18n/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

afterEach(() => {
  vi.clearAllMocks();
});

describe("formatRelative — minute threshold (abs < 1 hour)", () => {
  it("returns a minutes-based phrase when 30 minutes remain", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 30 * MINUTE);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted.toLowerCase()).toMatch(/minute/);
    expect(formatted.toLowerCase()).not.toMatch(/hour/);
  });

  it("returns a minutes-based phrase for 1 minute remaining", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 1 * MINUTE);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted.toLowerCase()).toMatch(/minute/);
  });

  it("returns a minutes-based phrase for 59 minutes remaining (just below the hour boundary)", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 59 * MINUTE);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted.toLowerCase()).toMatch(/minute/);
    expect(formatted.toLowerCase()).not.toMatch(/hour/);
  });
});

describe("formatRelative — hour threshold (1 hour <= abs < 24 hours)", () => {
  it("returns an hours-based phrase when exactly 1 hour remains", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 1 * HOUR);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted.toLowerCase()).toMatch(/hour/);
    expect(formatted.toLowerCase()).not.toMatch(/minute/);
  });

  it("returns an hours-based phrase when 2 hours remain", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 2 * HOUR);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted.toLowerCase()).toMatch(/hour/);
    expect(formatted.toLowerCase()).not.toMatch(/minute/);
  });

  it("returns an hours-based phrase when 23 hours remain (just below the day boundary)", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 23 * HOUR);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted.toLowerCase()).toMatch(/hour/);
    expect(formatted.toLowerCase()).not.toMatch(/day/);
  });

  it("encodes the numeric hour count in the phrase", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 5 * HOUR);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted).toMatch(/5/);
  });
});

describe("formatRelative — numeric accuracy", () => {
  it("rounds to the nearest minute for sub-hour values", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 45 * MINUTE + 29_999);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted).toMatch(/45/);
  });

  it("rounds to the nearest hour for multi-hour values", () => {
    const { result } = renderHook(() => useFormat());
    const base = new Date();
    const target = new Date(base.getTime() + 3 * HOUR + 29 * MINUTE);
    const formatted = result.current.formatRelative(target, base);
    expect(formatted).toMatch(/3/);
  });
});
