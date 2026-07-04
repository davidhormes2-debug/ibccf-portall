import { db } from "./db";
import { cases } from "../shared/schema";
import { and, isNotNull, eq, lte, sql } from "drizzle-orm";
import { disableAndResetPathway } from "./services/pathwayReset";
import { notificationService } from "./services/NotificationService";
import { storage } from "./storage";

// Periodic sweep that detects cases whose portal-closure countdown has expired
// (portalWarningAt + portalWarningMinutes * 60 seconds <= now) but have not
// yet been disabled, and atomically disables them + resets their withdrawal
// pathway (reason="expired", actor="system").
//
// Runs every 5 minutes so that at most a 5-minute window elapses between a
// warning expiring and the case being automatically disabled, even when the
// server restarts mid-countdown. A one-time boot run also fires at startup
// so any warnings that expired while the server was down are handled within
// seconds of the server coming back up.

export const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

function log(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

let sweepInFlight = false;

export interface PortalWarningExpirySweepResult {
  processed: number;
  skipped: boolean;
  closedCaseIds: string[];
}

export async function runPortalWarningExpirySweep(): Promise<PortalWarningExpirySweepResult> {
  if (sweepInFlight) {
    return { processed: 0, skipped: true, closedCaseIds: [] };
  }
  sweepInFlight = true;
  try {
    // Find cases that:
    //  - have an active portal warning (portalWarningAt + portalWarningMinutes set)
    //  - are not already disabled
    //  - whose computed expiry (portalWarningAt + portalWarningMinutes * interval) is in the past
    const now = new Date();
    const expired = await db
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          isNotNull(cases.portalWarningAt),
          isNotNull(cases.portalWarningMinutes),
          eq(cases.isDisabled, false),
          // expiry = portalWarningAt + portalWarningMinutes * '1 minute'::interval
          lte(
            sql`${cases.portalWarningAt} + (${cases.portalWarningMinutes} * interval '1 minute')`,
            now,
          ),
        ),
      );

    if (expired.length === 0) {
      return { processed: 0, skipped: false, closedCaseIds: [] };
    }

    let processed = 0;
    const closedCaseIds: string[] = [];
    for (const row of expired) {
      try {
        // Fetch case data before disabling so we have email/name for the notification.
        const caseData = await storage.getCaseById(row.id).catch(() => null);
        await disableAndResetPathway(row.id, "expired", "system");
        processed++;
        closedCaseIds.push(row.id);
        log(
          `Portal-warning expiry sweep: disabled case ${row.id} and reset withdrawal pathway (reason=expired)`,
        );
        // Admin notification (real-time dashboard alert)
        notificationService
          .notifyAdmin(
            "portal_warning_expired",
            `Case Disabled: Portal Warning Expired`,
            `Case ${row.id} was automatically disabled because its portal closure warning timer expired.`,
            `/admin?tab=cases&caseId=${row.id}`,
          )
          .catch((notifErr) => {
            console.error(
              `Portal-warning expiry sweep: failed to create admin notification for case ${row.id}:`,
              notifErr,
            );
          });
        // Fire-and-forget email notifications to the case holder
        if (caseData?.userEmail) {
          const userEmail = caseData.userEmail;
          const userName = (caseData.userName ?? "").trim() || userEmail;
          const caseRef = row.id;
          setImmediate(async () => {
            try {
              const { emailService } = await import("./services/EmailService");
              const { sendCaseEmailWithAudit } = await import("./services/emailNotify");
              // Countdown expired notification
              await sendCaseEmailWithAudit({
                to: userEmail,
                caseId: caseRef,
                tag: "countdown_expired",
                adminUser: "system",
                send: (locale) =>
                  emailService.sendCountdownExpiredNotification({
                    to: userEmail,
                    userName,
                    caseRef,
                    locale,
                  }),
              });
              // Reactivation required notification
              await sendCaseEmailWithAudit({
                to: userEmail,
                caseId: caseRef,
                tag: "reactivation_required",
                adminUser: "system",
                send: (locale) =>
                  emailService.sendReactivationRequiredNotification({
                    to: userEmail,
                    userName,
                    caseRef,
                    depositAmount: "1,500 USDT",
                    locale,
                  }),
              });
            } catch (emailErr) {
              console.error(
                `Portal-warning expiry sweep: email dispatch failed for case ${caseRef}:`,
                emailErr,
              );
            }
          });
        }
      } catch (err) {
        console.error(
          `Portal-warning expiry sweep: failed to disable case ${row.id}:`,
          err,
        );
      }
    }

    if (processed > 0) {
      log(
        `Portal-warning expiry sweep complete: ${processed} case(s) disabled automatically`,
      );
    }

    return { processed, skipped: false, closedCaseIds };
  } catch (err) {
    console.error("Error during portal-warning expiry sweep:", err);
    return { processed: 0, skipped: false, closedCaseIds: [] };
  } finally {
    sweepInFlight = false;
  }
}

export function startPortalWarningExpirySweep(): void {
  void runPortalWarningExpirySweep();
  setInterval(() => {
    void runPortalWarningExpirySweep();
  }, SWEEP_INTERVAL_MS);
  log("Portal-warning expiry sweep started (boot run + every 5 min)");
}
