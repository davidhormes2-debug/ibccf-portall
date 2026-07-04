// Exhaustive union of every receipt status the platform emits.  Typed as a
// string union (not a plain string) so Record<ReceiptStatus, …> definitions
// are flagged incomplete by TypeScript the moment a new member is added here.
export type ReceiptStatus =
  | "pending"
  | "awaiting_admin_approval"
  | "reviewed"
  | "approved"
  | "rejected";

// Exhaustiveness guard for receipt-status ternary chains.  TypeScript calls
// this when the union is narrowed to `never` — i.e. every branch is handled.
// If a new ReceiptStatus member is added, callers that use this as their
// final else branch will produce a compile-time error until they add the new
// branch.
export function assertNeverReceiptStatus(x: never): never {
  throw new Error(`Unhandled receipt status: ${String(x)}`);
}

// Keep the runtime sets typed as Set<string> so the helper functions below
// can accept arbitrary strings without a type cast.  The ReceiptStatus union
// above is the source of truth for the typed Record constraints in UI chips.
export const ACTIONABLE_RECEIPT_STATUSES = new Set<string>([
  "pending",
  "awaiting_admin_approval",
  "reviewed",
] satisfies ReceiptStatus[]);

export const TERMINAL_RECEIPT_STATUSES = new Set<string>([
  "approved",
  "rejected",
] satisfies ReceiptStatus[]);

export function isActionableReceiptStatus(status: string | null | undefined): boolean {
  return !!status && ACTIONABLE_RECEIPT_STATUSES.has(status);
}

export function isTerminalReceiptStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_RECEIPT_STATUSES.has(status);
}

export const STAMP_DUTY_ALREADY_REVIEWED_CODE = "stamp_duty_already_reviewed";
