/**
 * Shared fetch helper used by admin Content Management (and any future admin
 * component that needs structured error handling on non-2xx responses).
 *
 * Extracted from ContentManagement.tsx (Task #422) so the class and function
 * can be unit-tested against the real implementation rather than a copy.
 */

export class ApiRequestError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    let payload: unknown = null;
    let message = `Request failed (${res.status})`;
    try {
      payload = await res.json();
      if (
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof (payload as { error?: unknown }).error === "string"
      ) {
        message = (payload as { error: string }).error;
      }
    } catch {
      /* response body was not JSON */
    }
    throw new ApiRequestError(res.status, message, payload);
  }
  return res.json();
}
