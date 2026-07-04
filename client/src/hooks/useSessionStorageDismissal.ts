import { useState } from "react";

// Small reusable hook for the "one-time banner, dismissed until a newer
// event supersedes it" pattern used across the admin dashboard (e.g. the
// email-delivery alert and the emergency-reset-used banner). The dismissed
// value is keyed to the latest event's own identifier/timestamp so a NEWER
// event re-shows the banner even after a previous one was dismissed.
export function useSessionStorageDismissal(storageKey: string) {
  const [value, setValueState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const setValue = (next: string | null) => {
    setValueState(next);
    if (typeof window === "undefined") return;
    try {
      if (next === null) {
        window.sessionStorage.removeItem(storageKey);
      } else {
        window.sessionStorage.setItem(storageKey, next);
      }
    } catch {
      // sessionStorage may be unavailable (private mode / quota) — best effort.
    }
  };
  return [value, setValue] as const;
}
