import {
  ADMIN_PASSWORD_WEAK_HINTS,
  type AdminPasswordWeakReason,
} from "@shared/passwordStrength";

export interface AdminLoginErrorInput {
  status: number;
  body: unknown;
}

export interface AdminLoginErrorResult {
  message: string;
  isWeakPassword: boolean;
  /**
   * The specific weakness reason the server reported (when the 503 was caused
   * by a weak ADMIN_PASSWORD). Drives the targeted hint on the login page.
   */
  weakReason?: AdminPasswordWeakReason;
  /**
   * Human-readable hint matching `weakReason`, sourced from
   * `ADMIN_PASSWORD_WEAK_HINTS`. Only present when `weakReason` is set.
   */
  weakReasonHint?: string;
}

const WEAK_PASSWORD_FALLBACK =
  "Admin password is too weak. Rotate ADMIN_PASSWORD to a stronger value before logging in.";

const VALID_WEAK_REASONS = new Set<AdminPasswordWeakReason>([
  "missing",
  "too_short",
  "blocklisted",
  "keyboard_walk",
  "repetitive_pattern",
]);

function extractErrorString(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function extractWeakReason(body: unknown): AdminPasswordWeakReason | null {
  if (body && typeof body === "object" && "weakReason" in body) {
    const value = (body as { weakReason: unknown }).weakReason;
    if (typeof value === "string" && VALID_WEAK_REASONS.has(value as AdminPasswordWeakReason)) {
      return value as AdminPasswordWeakReason;
    }
  }
  return null;
}

export function getAdminLoginErrorMessage(
  input: AdminLoginErrorInput,
): AdminLoginErrorResult | null {
  const { status, body } = input;
  if (status === 503) {
    const serverMessage = extractErrorString(body);
    const message = serverMessage ?? WEAK_PASSWORD_FALLBACK;
    const weakReason = extractWeakReason(body);
    const isWeakPassword =
      weakReason !== null || /weak/i.test(message) || /ADMIN_PASSWORD/.test(message);
    return {
      message,
      isWeakPassword,
      ...(weakReason
        ? { weakReason, weakReasonHint: ADMIN_PASSWORD_WEAK_HINTS[weakReason] }
        : {}),
    };
  }
  return null;
}
