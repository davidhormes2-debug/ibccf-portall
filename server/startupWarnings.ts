import { storage as defaultStorage } from "./storage";

type AuditLogEntry = {
  adminUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  previousValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

type StorageLike = {
  createAuditLog: (entry: AuditLogEntry) => Promise<unknown>;
};

export function emitStartupSecurityWarnings(
  storageInstance: StorageLike = defaultStorage,
  exitFn: (code?: number) => never = process.exit,
): void {
  const isProduction = process.env.NODE_ENV === "production";
  const auditWrites: Promise<unknown>[] = [];
  const activeFlags: string[] = [];

  if (process.env.ALLOW_WEAK_ADMIN_PASSWORD === "1") {
    if (isProduction) {
      activeFlags.push("ALLOW_WEAK_ADMIN_PASSWORD");
      console.warn(
        "[SECURITY] ALLOW_WEAK_ADMIN_PASSWORD=1 is set in a production " +
          "deployment. This escape hatch is intended for local development only. " +
          "Remove it from your production environment variables.",
      );
    } else {
      console.warn(
        "[SECURITY] ALLOW_WEAK_ADMIN_PASSWORD=1 is active. " +
          "This escape hatch is intended for local development only. " +
          "Do not deploy with this flag set.",
      );
    }
    auditWrites.push(
      storageInstance
        .createAuditLog({
          adminUsername: "system",
          action: "security_config_warning",
          targetType: "server",
          targetId: null,
          previousValue: null,
          newValue:
            "ALLOW_WEAK_ADMIN_PASSWORD=1 is active in a production deployment",
          ipAddress: null,
          userAgent: null,
        })
        .catch((err) =>
          console.error(
            "Failed to write ALLOW_WEAK_ADMIN_PASSWORD startup audit log:",
            err,
          ),
        ),
    );
  }

  if (process.env.ALLOW_WEAK_SESSION_SECRET === "1") {
    if (isProduction) {
      activeFlags.push("ALLOW_WEAK_SESSION_SECRET");
      console.warn(
        "[SECURITY] ALLOW_WEAK_SESSION_SECRET=1 is set in a production " +
          "deployment. This escape hatch is intended for local development only. " +
          "Remove it from your production environment variables.",
      );
    } else {
      console.warn(
        "[SECURITY] ALLOW_WEAK_SESSION_SECRET=1 is active. " +
          "This escape hatch is intended for local development only. " +
          "Do not deploy with this flag set.",
      );
    }
    auditWrites.push(
      storageInstance
        .createAuditLog({
          adminUsername: "system",
          action: "security_config_warning",
          targetType: "server",
          targetId: null,
          previousValue: null,
          newValue:
            "ALLOW_WEAK_SESSION_SECRET=1 is active in a production deployment",
          ipAddress: null,
          userAgent: null,
        })
        .catch((err) =>
          console.error(
            "Failed to write ALLOW_WEAK_SESSION_SECRET startup audit log:",
            err,
          ),
        ),
    );
  }

  if (process.env.ALLOW_WEAK_ADMIN_USERNAME === "1") {
    if (isProduction) {
      activeFlags.push("ALLOW_WEAK_ADMIN_USERNAME");
      console.warn(
        "[SECURITY] ALLOW_WEAK_ADMIN_USERNAME=1 is set in a production " +
          "deployment. This escape hatch is intended for local development only. " +
          "Remove it from your production environment variables.",
      );
    } else {
      console.warn(
        "[SECURITY] ALLOW_WEAK_ADMIN_USERNAME=1 is active. " +
          "This escape hatch is intended for local development only. " +
          "Do not deploy with this flag set.",
      );
    }
    auditWrites.push(
      storageInstance
        .createAuditLog({
          adminUsername: "system",
          action: "security_config_warning",
          targetType: "server",
          targetId: null,
          previousValue: null,
          newValue:
            "ALLOW_WEAK_ADMIN_USERNAME=1 is active in a production deployment",
          ipAddress: null,
          userAgent: null,
        })
        .catch((err) =>
          console.error(
            "Failed to write ALLOW_WEAK_ADMIN_USERNAME startup audit log:",
            err,
          ),
        ),
    );
  }

  if (activeFlags.length > 0) {
    auditWrites.push(
      storageInstance
        .createAuditLog({
          adminUsername: "system",
          action: "security_escape_hatch_flags_in_production",
          targetType: "server",
          targetId: null,
          previousValue: null,
          newValue: JSON.stringify({
            activeFlags,
            allowWeakAdminPassword:
              process.env.ALLOW_WEAK_ADMIN_PASSWORD === "1",
            allowWeakSessionSecret:
              process.env.ALLOW_WEAK_SESSION_SECRET === "1",
            allowWeakAdminUsername:
              process.env.ALLOW_WEAK_ADMIN_USERNAME === "1",
          }),
          ipAddress: null,
          userAgent: null,
        })
        .catch((err) =>
          console.error(
            "Failed to write consolidated escape-hatch flags startup audit log:",
            err,
          ),
        ),
    );

    void Promise.allSettled(auditWrites)
      .then(() => {
        console.error(
          "[SECURITY] The server cannot start because one or more development " +
            "escape-hatch flags (ALLOW_WEAK_ADMIN_PASSWORD, ALLOW_WEAK_ADMIN_USERNAME, " +
            "ALLOW_WEAK_SESSION_SECRET) are active in a production deployment. " +
            "Remove these flags from your production environment and restart.",
        );
        exitFn(1);
      })
      .catch(() => {
        // In production `exitFn` (process.exit) terminates the process and this
        // never runs. Under test runners, process.exit is stubbed to throw
        // instead of exiting; swallow that throw so it does not surface as an
        // unhandled rejection after the test has already finished (teardown).
      });
  }
}
