// Locale-aware Intl helpers. Centralising these keeps formatting
// consistent across pages and removes ad-hoc `toLocaleString()` calls,
// which fall back to the browser locale rather than the user-selected one.

import { useMemo } from "react";
import { useLocale } from "./useLocale";

export interface FormatHelpers {
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency: string, options?: Intl.NumberFormatOptions) => string;
  formatRelative: (value: Date | string | number, base?: Date) => string;
}

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return new Date(value);
}

export function useFormat(): FormatHelpers {
  const { locale } = useLocale();
  return useMemo<FormatHelpers>(() => {
    const tag = locale.bcp47;
    return {
      formatDate: (value, options) =>
        new Intl.DateTimeFormat(tag, options ?? { dateStyle: "medium" }).format(toDate(value)),
      formatDateTime: (value, options) =>
        new Intl.DateTimeFormat(
          tag,
          options ?? { dateStyle: "medium", timeStyle: "short" },
        ).format(toDate(value)),
      formatTime: (value, options) =>
        new Intl.DateTimeFormat(tag, options ?? { timeStyle: "short" }).format(toDate(value)),
      formatNumber: (value, options) => new Intl.NumberFormat(tag, options).format(value),
      formatCurrency: (value, currency, options) =>
        new Intl.NumberFormat(tag, { style: "currency", currency, ...options }).format(value),
      formatRelative: (value, base = new Date()) => {
        const target = toDate(value);
        const diffMs = target.getTime() - base.getTime();
        const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
        const abs = Math.abs(diffMs);
        const minutes = 60_000;
        const hours = 60 * minutes;
        const days = 24 * hours;
        if (abs < hours) return rtf.format(Math.round(diffMs / minutes), "minute");
        if (abs < days) return rtf.format(Math.round(diffMs / hours), "hour");
        return rtf.format(Math.round(diffMs / days), "day");
      },
    };
  }, [locale]);
}
