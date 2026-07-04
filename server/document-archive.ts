import { storage } from "./storage";

function log(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

// How long an approved document's file blob is retained before being
// archived (i.e. nulled out of the row). Keeps the metadata + audit
// trail intact so the compliance record is preserved.
export const APPROVED_DOCUMENT_RETENTION_DAYS = 90;

// Sweep cadence. The dataset is small and writes are cheap, so a
// once-per-day pass is plenty — we don't need the hourly tick the
// audit-log retention uses.
const DOCUMENT_ARCHIVE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let archiveSweepInFlight = false;

export async function runApprovedDocumentArchiveSweep(): Promise<number> {
  if (archiveSweepInFlight) return 0;
  archiveSweepInFlight = true;
  try {
    const cutoff = new Date(
      Date.now() - APPROVED_DOCUMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const archived = await storage.archiveOldApprovedDocumentBlobs(cutoff);
    if (archived > 0) {
      log(
        `Archived ${archived} approved document file blob(s) older than ${APPROVED_DOCUMENT_RETENTION_DAYS} day(s)`,
      );
      // Single rollup audit-log entry — writing one per archived row
      // would itself bloat the audit_logs table and defeat the point.
      try {
        await storage.createAuditLog({
          action: "documents_archived",
          newValue: `Archived ${archived} approved document file blob(s) approved before ${cutoff.toISOString()} (retention: ${APPROVED_DOCUMENT_RETENTION_DAYS} days from approval; legacy rows fall back to submission time). Metadata preserved.`,
          adminUsername: "system",
          targetType: "system",
          targetId: "document_archive_sweep",
        });
      } catch (logErr) {
        console.error(
          "[document-archive] audit log failed for archive sweep:",
          logErr,
        );
      }
    }
    return archived;
  } catch (err) {
    console.error("[document-archive] sweep failed:", err);
    return 0;
  } finally {
    archiveSweepInFlight = false;
  }
}

export function startApprovedDocumentArchiveSweep(): void {
  void runApprovedDocumentArchiveSweep();
  setInterval(() => {
    void runApprovedDocumentArchiveSweep();
  }, DOCUMENT_ARCHIVE_SWEEP_INTERVAL_MS);
  log(
    `Approved document archive sweep started (daily, retaining file blobs for ${APPROVED_DOCUMENT_RETENTION_DAYS} day(s))`,
  );
}
