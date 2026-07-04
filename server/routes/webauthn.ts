import crypto from "crypto";
import { Router, type Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { storage } from "../storage";
import { checkAdminAuth } from "./middleware";
import { rateLimiter } from "../middleware";
import {
  WEBAUTHN_AUTH_OPTIONS_RATE_LIMIT_NAMESPACE,
  WEBAUTHN_AUTH_VERIFY_RATE_LIMIT_NAMESPACE,
} from "../middleware/security";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const SESSION_TTL_HOURS = 12;
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CRED_STORAGE_KEY = "admin_webauthn_credentials";

// In-memory challenge store — single admin, short-lived, restart-tolerant
const pendingChallenges = new Map<
  string,
  { challenge: string; expiresAt: number }
>();

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of pendingChallenges) {
    if (v.expiresAt < now) pendingChallenges.delete(k);
  }
}

function getRpId(req: Request): string {
  const host = (req.headers.host ?? "localhost").split(":")[0];
  return host;
}

function getOrigin(req: Request): string {
  // Prefer the Origin header (set by browsers on fetch/XHR).
  // Fall back to reconstructing from the host header.
  if (req.headers.origin) return req.headers.origin;
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return req.socket?.remoteAddress;
}

// ─── Credential storage (JSON in app_settings) ───────────────────────────────

export interface StoredCredential {
  id: string;                  // internal UUID
  credentialId: string;        // base64url — WebAuthn credential id
  credentialPublicKey: string; // base64url — COSE public key bytes
  counter: number;
  transports: string[];
  deviceName: string;
  createdAt: string;           // ISO 8601
}

async function getCredentials(): Promise<StoredCredential[]> {
  const setting = await storage.getAppSetting(CRED_STORAGE_KEY);
  if (!setting?.value) return [];
  try {
    return JSON.parse(setting.value) as StoredCredential[];
  } catch {
    return [];
  }
}

async function saveCredentials(creds: StoredCredential[]): Promise<void> {
  await storage.setAppSetting(CRED_STORAGE_KEY, JSON.stringify(creds), "webauthn");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const webAuthnRouter = Router();

// Both authentication routes are reachable without any credential — a
// pre-registered passkey is required to *succeed*, but not to *attempt*, so
// an unauthenticated caller could otherwise hammer these to enumerate
// registered credentials or exhaust the in-memory `pendingChallenges` map.
// DB-backed so the cap holds across autoscale instances.
const webauthnAuthOptionsRateLimit = rateLimiter(20, 10 * 60 * 1000, {
  persistNamespace: WEBAUTHN_AUTH_OPTIONS_RATE_LIMIT_NAMESPACE,
});
const webauthnAuthVerifyRateLimit = rateLimiter(20, 10 * 60 * 1000, {
  persistNamespace: WEBAUTHN_AUTH_VERIFY_RATE_LIMIT_NAMESPACE,
});

// Public — tells login UI whether any passkeys are registered
webAuthnRouter.get("/status", async (_req, res) => {
  const creds = await getCredentials();
  res.json({ available: creds.length > 0, count: creds.length });
});

// ── Registration (admin session required) ─────────────────────────────────────

webAuthnRouter.post(
  "/registration/options",
  checkAdminAuth,
  async (req, res) => {
    cleanExpired();
    const creds = await getCredentials();
    const rpId = getRpId(req);

    const options = await generateRegistrationOptions({
      rpName: "IBCCF Admin",
      rpID: rpId,
      userName: ADMIN_USERNAME,
      userDisplayName: "IBCCF Administrator",
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        authenticatorAttachment: "platform",
      },
      excludeCredentials: creds.map((c) => ({ id: c.credentialId })),
      timeout: 60000,
    });

    const sessionKey = `reg-${crypto.randomBytes(8).toString("hex")}`;
    pendingChallenges.set(sessionKey, {
      challenge: options.challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    res.json({ options, sessionKey });
  },
);

webAuthnRouter.post(
  "/registration/verify",
  checkAdminAuth,
  async (req, res) => {
    const { sessionKey, registration, deviceName } = req.body ?? {};
    const pending = pendingChallenges.get(String(sessionKey ?? ""));

    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).json({ error: "Challenge expired or not found" });
      return;
    }
    pendingChallenges.delete(String(sessionKey));

    const rpId = getRpId(req);
    const origin = getOrigin(req);

    try {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: registration as RegistrationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: false,
      });

      if (!verified || !registrationInfo) {
        res.status(400).json({ error: "Verification failed" });
        return;
      }

      const label =
        String(deviceName ?? "").trim().slice(0, 64) ||
        `Passkey ${new Date().toLocaleDateString("en-US")}`;

      const newCred: StoredCredential = {
        id: crypto.randomUUID(),
        credentialId: registrationInfo.credential.id,
        credentialPublicKey: Buffer.from(
          registrationInfo.credential.publicKey,
        ).toString("base64url"),
        counter: registrationInfo.credential.counter,
        transports:
          (registration as RegistrationResponseJSON).response.transports ?? [],
        deviceName: label,
        createdAt: new Date().toISOString(),
      };

      const creds = await getCredentials();
      creds.push(newCred);
      await saveCredentials(creds);

      await storage.createAuditLog({
        adminUsername: ADMIN_USERNAME,
        action: "admin_webauthn_registered",
        targetType: "admin_session",
        targetId: null,
        previousValue: null,
        newValue: JSON.stringify({ deviceName: label }),
        ipAddress: getClientIp(req) ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
      });

      res.json({
        verified: true,
        credential: {
          id: newCred.id,
          deviceName: newCred.deviceName,
          createdAt: newCred.createdAt,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      res.status(400).json({ error: msg });
    }
  },
);

// ── Credential management (admin session required) ────────────────────────────

webAuthnRouter.get("/credentials", checkAdminAuth, async (_req, res) => {
  const creds = await getCredentials();
  res.json(
    creds.map((c) => ({
      id: c.id,
      deviceName: c.deviceName,
      createdAt: c.createdAt,
      transports: c.transports,
    })),
  );
});

webAuthnRouter.delete(
  "/credentials/:id",
  checkAdminAuth,
  async (req, res) => {
    const creds = await getCredentials();
    const filtered = creds.filter((c) => c.id !== req.params.id);
    if (filtered.length === creds.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await saveCredentials(filtered);

    await storage.createAuditLog({
      adminUsername: ADMIN_USERNAME,
      action: "admin_webauthn_removed",
      targetType: "admin_session",
      targetId: req.params.id,
      previousValue: null,
      newValue: null,
      ipAddress: getClientIp(req) ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
    });

    res.json({ ok: true });
  },
);

// ── Authentication (public — before admin session exists) ──────────────────────

webAuthnRouter.post("/authentication/options", webauthnAuthOptionsRateLimit, async (req, res) => {
  cleanExpired();
  const creds = await getCredentials();
  if (creds.length === 0) {
    res.status(404).json({ error: "No passkeys registered" });
    return;
  }

  const rpId = getRpId(req);
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    userVerification: "preferred",
    timeout: 60000,
  });

  const sessionKey = `auth-${crypto.randomBytes(8).toString("hex")}`;
  pendingChallenges.set(sessionKey, {
    challenge: options.challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });

  res.json({ options, sessionKey });
});

webAuthnRouter.post("/authentication/verify", webauthnAuthVerifyRateLimit, async (req, res) => {
  const { sessionKey, authentication } = req.body ?? {};
  const pending = pendingChallenges.get(String(sessionKey ?? ""));

  if (!pending || pending.expiresAt < Date.now()) {
    res.status(400).json({ error: "Challenge expired or not found" });
    return;
  }
  pendingChallenges.delete(String(sessionKey));

  const creds = await getCredentials();
  const credId = (authentication as AuthenticationResponseJSON)?.id;
  const storedCred = creds.find((c) => c.credentialId === credId);

  if (!storedCred) {
    res.status(400).json({ error: "Unknown credential" });
    return;
  }

  const rpId = getRpId(req);
  const origin = getOrigin(req);

  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse(
      {
        response: authentication as AuthenticationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: {
          id: storedCred.credentialId,
          publicKey: Buffer.from(storedCred.credentialPublicKey, "base64url"),
          counter: storedCred.counter,
          transports: storedCred.transports as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      },
    );

    if (!verified) {
      res.status(401).json({ error: "Authentication failed" });
      return;
    }

    // Update counter to prevent replay attacks
    storedCred.counter = authenticationInfo.newCounter;
    await saveCredentials(creds);

    // Create admin session — identical pattern to the password-based login
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await storage.runInTransaction(async (tx) => {
      await storage.createAdminSession(
        {
          adminUsername: ADMIN_USERNAME,
          token,
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? "",
          expiresAt,
        },
        tx,
      );
      await storage.createAuditLog(
        {
          adminUsername: ADMIN_USERNAME,
          action: "admin_webauthn_login",
          targetType: "admin_session",
          targetId: null,
          previousValue: null,
          newValue: JSON.stringify({ deviceName: storedCred.deviceName }),
          ipAddress: getClientIp(req) ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        },
        tx,
      );
    });

    res.json({ token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: msg });
  }
});
