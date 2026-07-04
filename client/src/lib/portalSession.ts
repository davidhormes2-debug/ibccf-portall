const STORAGE_KEY = "ibccf_portal_session";
const LEGACY_KEY = "portalSessionToken";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredSession {
  token: string;
  expiresAt: number;
}

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && typeof parsed.token === "string" && typeof parsed.expiresAt === "number") {
        if (parsed.expiresAt > Date.now()) {
          return parsed;
        }
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  try {
    const legacy = sessionStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated: StoredSession = { token: legacy, expiresAt: Date.now() + TTL_MS };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch {
        // ignore storage failure (quota / privacy mode)
      }
      sessionStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
  } catch {
    // ignore
  }

  return null;
}

export function getPortalToken(): string {
  // Regular sessions live in localStorage. Mirror sessions live in sessionStorage
  // only (set by setMirrorToken). If the localStorage session is absent or expired,
  // fall back to the mirror token so mirrored portal views can still make
  // authenticated API calls without any call-site changes.
  const stored = readStored();
  if (stored) return stored.token;
  return getMirrorToken();
}

export function hasPortalSession(): boolean {
  return !!readStored();
}

export function setPortalToken(token: string): void {
  if (!token) return;
  const payload: StoredSession = { token, expiresAt: Date.now() + TTL_MS };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}

// Mirror sessions must never be written to localStorage. They are kept in
// sessionStorage only so they die with the browser tab and cannot be reused
// across sessions. The server already enforces a short TTL on the underlying
// portal_sessions row; this is the client-side complement to that guarantee.
const MIRROR_SESSION_KEY = "ibccf_mirror_session_token";

export function setMirrorToken(token: string, expiresAt: number): void {
  if (!token) return;
  try {
    sessionStorage.setItem(MIRROR_SESSION_KEY, token);
    sessionStorage.setItem("ibccfMirrorSessionExpiresAt", String(expiresAt));
  } catch {
    // ignore
  }
}

export function getMirrorToken(): string {
  try {
    const token = sessionStorage.getItem(MIRROR_SESSION_KEY) ?? "";
    const expiresAt = Number(sessionStorage.getItem("ibccfMirrorSessionExpiresAt") ?? "0");
    if (!token || (expiresAt > 0 && expiresAt < Date.now())) {
      clearMirrorToken();
      return "";
    }
    return token;
  } catch {
    return "";
  }
}

export function clearMirrorToken(): void {
  try {
    sessionStorage.removeItem(MIRROR_SESSION_KEY);
    sessionStorage.removeItem("ibccfMirrorSessionExpiresAt");
  } catch {
    // ignore
  }
}

export function getPortalSessionExpiresAt(): number | null {
  const stored = readStored();
  return stored ? stored.expiresAt : null;
}

export function clearPortalToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}
