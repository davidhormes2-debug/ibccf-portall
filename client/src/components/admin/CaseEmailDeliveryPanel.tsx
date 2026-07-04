import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Mail,
  MailCheck,
  AlertTriangle,
  Clock,
  RefreshCw,
  Info,
} from "lucide-react";
import type { CaseEmail, AuditLog } from "@shared/schema";

interface CaseEmailDeliveryPanelProps {
  caseId: string;
  authToken: string | null;
  // Monotonically-bumped signal from the parent (Task #146). When it
  // changes the panel scrolls itself into view and refetches so an
  // admin clicking the row-level "email delivery" badge on the Cases
  // list lands directly on the up-to-date breakdown.
  scrollSignal?: number;
}

type DeliveryStatus = "pending" | "sent" | "failed";

interface DeliveryRow {
  key: string;
  tag: string;
  recipient: string;
  queuedAt: Date | null;
  status: DeliveryStatus;
  error: string | null;
  source: "case_emails" | "audit";
  sourceId: number;
  subject: string | null;
  sentBy: string | null;
  locale: string | null;
  // Task #159 — true when the legacy backfill couldn't map this failed
  // row 1:1 to a source record (declaration submission / admin message /
  // document request / deposit receipt). The retry handler refuses
  // these rows server-side; we mirror that here so admins see a
  // disabled button with an explanatory tooltip instead of a confusing
  // 422 toast.
  ambiguousLegacy: boolean;
  // Task #171 — distinguish the two ambiguous shapes so the tooltip and
  // Details popover can show why retry is blocked. `no_source_record`
  // means the underlying record was deleted (or never existed) and
  // there's nothing to point an admin at. `multiple_source_records`
  // means several rows on the case match the failed email's tag, so we
  // expose `ambiguousCandidateIds` and let the admin click through to
  // the right one to re-run the action manually.
  ambiguousReason: "no_source_record" | "multiple_source_records" | null;
  ambiguousCandidateIds: number[];
}

// Mirror of RETRYABLE_AUDIT_TAGS in server/routes/cases.ts. Audit-only
// rows whose tag is NOT in this set can't be retried automatically
// because the original notes/context (reviewer notes, message body,
// document type, etc.) isn't preserved on the audit row.
const RETRYABLE_AUDIT_TAGS = new Set<string>([
  "letter-ready",
  "letter-reissued",
  "payout-wallet-set",
  "payout-wallet-changed",
  "declaration-assigned",
  "declaration-approved",
  "declaration-rejected",
  "submission-received",
  "account_reactivation",
  "compliance-message",
  "document-requested",
  "document-approved",
  "document-rejected",
  "reissue-receipt-approved",
  "reissue-receipt-rejected",
]);

function isRowRetryable(r: DeliveryRow): boolean {
  if (r.status !== "failed") return false;
  if (r.source === "case_emails") return true;
  if (r.ambiguousLegacy) return false;
  return RETRYABLE_AUDIT_TAGS.has(r.tag);
}

const TAG_LABELS: Record<string, string> = {
  custom: "Custom email",
  stage_instructions: "Stage instructions",
  account_reactivation: "Account reactivation",
  "letter-ready": "Letter ready",
  "letter-reissued": "Letter reissued",
  "reissue-receipt-approved": "Reissue receipt approved",
  "reissue-receipt-rejected": "Reissue receipt rejected",
  "declaration-assigned": "Declaration assigned",
  "declaration-approved": "Declaration approved",
  "declaration-rejected": "Declaration rejected",
  "submission-received": "Submission received",
  "compliance-message": "Compliance message",
  "document-requested": "Document requested",
  "document-approved": "Document approved",
  "document-rejected": "Document rejected",
  "payout-wallet-set": "Payout wallet set",
  "payout-wallet-changed": "Payout wallet changed",
  // Task #377 — system-fired admin alert when a case holder uploads a
  // supporting document. Emitted by server/services/documentUploadAlert.ts
  // as `email_user_document_uploaded_alert` / `..._failed` so admins
  // scanning the delivery panel see a friendly label instead of the
  // raw "User Document Uploaded Alert" fallback.
  user_document_uploaded_alert: "Document upload alert",
};

function labelForTag(tag: string): string {
  return (
    TAG_LABELS[tag] ??
    tag
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Audit `newValue` strings always look like:
//   "Email sent (<tag>, <locale>) to <recipient>: <subject?>"
//   "Email send failed (<tag>, <locale>) to <recipient>: <error>"
// or the legacy "Email sent (<tag>) to <recipient>: <subject?>" form.
function parseAuditNewValue(newValue: string | null): {
  recipient: string | null;
  locale: string | null;
  detail: string | null;
} {
  if (!newValue) return { recipient: null, locale: null, detail: null };
  const match = newValue.match(
    /^Email (?:sent|send failed) \(([^)]+)\) to ([^:]+?)(?::\s*(.*))?$/s,
  );
  if (!match) return { recipient: null, locale: null, detail: newValue };
  const inside = match[1].split(",").map((p) => p.trim());
  const locale = inside.length > 1 ? inside[inside.length - 1] : null;
  return {
    recipient: match[2].trim(),
    locale,
    detail: match[3]?.trim() || null,
  };
}

// `case_emails` rows are persisted only by POST /:id/email (custom) and
// POST /:id/send-stage-email — skip those tags when merging audit rows so
// the same dispatch isn't listed twice.
const AUDIT_TAGS_DUPED_IN_CASE_EMAILS = new Set([
  "custom",
  "stage_instructions",
]);

function tagFromAction(action: string): { tag: string; failed: boolean } {
  const failed = action.endsWith("_failed");
  const raw = action.replace(/^email_/, "").replace(/_failed$/, "");
  return { tag: raw, failed };
}

function caseEmailToRow(row: CaseEmail): DeliveryRow {
  // Custom and stage-instructions both insert into case_emails. The
  // backend doesn't store a tag on the row, but we can recover it from
  // the subject prefix written by /send-stage-email
  // ("Stage N of 14: ..."). Anything else is treated as a custom email.
  const tag = /^Stage\s+\d+\s+of\s+14\b/i.test(row.subject)
    ? "stage_instructions"
    : "custom";
  const status: DeliveryStatus =
    row.status === "sent" || row.status === "failed"
      ? (row.status as DeliveryStatus)
      : "pending";
  const queuedAt = row.createdAt ? new Date(row.createdAt) : null;
  return {
    key: `ce:${row.id}`,
    tag,
    recipient: row.toEmail,
    queuedAt,
    status,
    error: row.errorMessage ?? null,
    source: "case_emails",
    sourceId: row.id,
    subject: row.subject,
    sentBy: row.sentBy ?? null,
    locale: null,
    ambiguousLegacy: false,
    ambiguousReason: null,
    ambiguousCandidateIds: [],
  };
}

function parseAmbiguousMeta(
  meta: { ambiguous?: boolean; reason?: string; candidateIds?: unknown } | null,
): {
  ambiguous: boolean;
  reason: "no_source_record" | "multiple_source_records" | null;
  candidateIds: number[];
} {
  if (!meta || meta.ambiguous !== true) {
    return { ambiguous: false, reason: null, candidateIds: [] };
  }
  const reason =
    meta.reason === "no_source_record" ||
    meta.reason === "multiple_source_records"
      ? meta.reason
      : null;
  const candidateIds = Array.isArray(meta.candidateIds)
    ? (meta.candidateIds as unknown[])
        .map((v) =>
          typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN,
        )
        .filter((n): n is number => Number.isFinite(n))
    : [];
  return { ambiguous: true, reason, candidateIds };
}

function auditLogToRow(row: AuditLog): DeliveryRow {
  const { tag, failed } = tagFromAction(row.action);
  const { recipient, locale, detail } = parseAuditNewValue(row.newValue);
  const meta =
    (row.metadata as
      | { ambiguous?: boolean; reason?: string; candidateIds?: unknown }
      | null) ?? null;
  const { ambiguous, reason, candidateIds } = parseAmbiguousMeta(meta);
  return {
    key: `al:${row.id}`,
    tag,
    recipient: recipient ?? "—",
    queuedAt: row.createdAt ? new Date(row.createdAt) : null,
    status: failed ? "failed" : "sent",
    error: failed ? detail : null,
    source: "audit",
    sourceId: row.id,
    subject: failed ? null : detail,
    sentBy: row.adminUsername || null,
    locale,
    ambiguousLegacy: failed && ambiguous,
    ambiguousReason: failed && ambiguous ? reason : null,
    ambiguousCandidateIds: failed && ambiguous ? candidateIds : [],
  };
}

// Per-tag human label for the kind of record the candidate ids refer to.
// Used in the Details popover so admins know what they're clicking through
// to (e.g. "Document request #42" vs "Reissue receipt #42").
const CANDIDATE_RECORD_LABELS: Record<string, string> = {
  "declaration-rejected": "Declaration submission",
  "compliance-message": "Admin message",
  "document-requested": "Document request",
  "document-approved": "Document request",
  "document-rejected": "Document request",
  "reissue-receipt-approved": "Reissue receipt",
  "reissue-receipt-rejected": "Reissue receipt",
};

function candidateRecordLabel(tag: string): string {
  return CANDIDATE_RECORD_LABELS[tag] ?? "Record";
}

function formatRelative(date: Date | null, now: number): string {
  if (!date) return "—";
  const diff = Math.max(0, now - date.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusBadge(status: DeliveryStatus) {
  if (status === "sent") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
        <MailCheck className="h-3 w-3 mr-1" /> Sent
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="bg-red-500/15 text-red-300 border border-red-500/40">
        <AlertTriangle className="h-3 w-3 mr-1" /> Failed
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/40">
      <Clock className="h-3 w-3 mr-1" /> Pending
    </Badge>
  );
}

export function CaseEmailDeliveryPanel({
  caseId,
  authToken,
  scrollSignal,
}: CaseEmailDeliveryPanelProps) {
  const [caseEmails, setCaseEmails] = useState<CaseEmail[]>([]);
  const [auditRows, setAuditRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [retryError, setRetryError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const [emailsRes, auditRes] = await Promise.all([
        fetch(`/api/cases/${caseId}/emails`, {
          headers,
          signal: ctl.signal,
        }),
        fetch(`/api/cases/${caseId}/email-audit-logs?limit=50`, {
          headers,
          signal: ctl.signal,
        }),
      ]);
      if (!emailsRes.ok || !auditRes.ok) {
        throw new Error(
          `HTTP ${emailsRes.ok ? auditRes.status : emailsRes.status}`,
        );
      }
      const [emails, audit] = await Promise.all([
        emailsRes.json() as Promise<CaseEmail[]>,
        auditRes.json() as Promise<AuditLog[]>,
      ]);
      setCaseEmails(Array.isArray(emails) ? emails : []);
      setAuditRows(Array.isArray(audit) ? audit : []);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [caseId, authToken]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Tick the "x seconds ago" labels every 5s.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    const merged: DeliveryRow[] = [];
    for (const row of caseEmails) merged.push(caseEmailToRow(row));
    for (const row of auditRows) {
      const { tag } = tagFromAction(row.action);
      if (AUDIT_TAGS_DUPED_IN_CASE_EMAILS.has(tag)) continue;
      merged.push(auditLogToRow(row));
    }
    merged.sort((a, b) => {
      const ta = a.queuedAt?.getTime() ?? 0;
      const tb = b.queuedAt?.getTime() ?? 0;
      return tb - ta;
    });
    return merged;
  }, [caseEmails, auditRows]);

  const hasPending = useMemo(
    () => rows.some((r) => r.status === "pending"),
    [rows],
  );

  // Auto-refresh: poll fast (4s) while any row is pending so admins see
  // pending → sent/failed almost immediately; otherwise back off to 30s.
  useEffect(() => {
    const ms = hasPending ? 4000 : 30000;
    const t = window.setInterval(() => {
      load();
    }, ms);
    return () => window.clearInterval(t);
  }, [hasPending, load]);

  const retryRow = useCallback(
    async (r: DeliveryRow) => {
      if (!authToken || !isRowRetryable(r)) return;
      setRetrying((m) => ({ ...m, [r.key]: true }));
      setRetryError(null);
      try {
        const url =
          r.source === "case_emails"
            ? `/api/cases/${caseId}/emails/${r.sourceId}/retry`
            : `/api/cases/${caseId}/email-audit-logs/${r.sourceId}/retry`;
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({}) as { error?: string });
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        // Refetch so the new pending row appears immediately; the auto
        // 4s pending poll will then flip it to sent/failed.
        await load();
      } catch (err) {
        setRetryError(
          err instanceof Error ? err.message : "Failed to retry email",
        );
      } finally {
        setRetrying((m) => {
          const next = { ...m };
          delete next[r.key];
          return next;
        });
      }
    },
    [authToken, caseId, load],
  );

  // When the parent bumps scrollSignal (admin clicked the row-level
  // delivery badge on the Cases list), scroll the panel into view
  // inside the dialog and refetch so the rows reflect the very latest
  // state. We seed `lastSignalRef` to undefined (NOT the current prop
  // value) so the very first non-undefined signal — which arrives on
  // the fresh dialog mount triggered by openCaseEmailDelivery — still
  // triggers the scroll. Without this, the panel sees `prev === next`
  // on mount and the click-to-jump silently no-ops.
  const lastSignalRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (scrollSignal === undefined) return;
    if (lastSignalRef.current === scrollSignal) return;
    lastSignalRef.current = scrollSignal;
    // Defer to the next frame so the Radix dialog has finished its
    // open transition before we try to scroll inside it. 120ms covers
    // the default Radix content fade/slide; the smooth scroll then
    // takes over from wherever the dialog landed.
    const t = window.setTimeout(() => {
      containerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      load();
    }, 120);
    return () => window.clearTimeout(t);
  }, [scrollSignal, load]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3"
      data-testid="panel-case-email-delivery"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-blue-300" />
          <h4 className="text-sm font-semibold text-slate-100">
            Email delivery status
          </h4>
          {hasPending && (
            <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/40">
              {rows.filter((r) => r.status === "pending").length} pending
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-slate-700 text-slate-200 hover:bg-slate-800 bg-transparent"
          onClick={load}
          disabled={loading}
          data-testid="button-refresh-email-delivery"
        >
          <RefreshCw
            className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">
        Transactional emails dispatched for this case. Background sends update
        from <span className="text-amber-300">Pending</span> →{" "}
        <span className="text-emerald-300">Sent</span> /{" "}
        <span className="text-red-300">Failed</span> within a few seconds.
      </p>

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5">
          Failed to load delivery status: {error}
        </div>
      )}

      {retryError && (
        <div
          className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5"
          data-testid="text-retry-error"
        >
          Retry failed: {retryError}
        </div>
      )}

      {rows.length === 0 && !loading && !error && (
        <div className="text-xs text-slate-500 italic">
          No transactional emails recorded for this case yet.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li
              key={r.key}
              className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
              data-testid={`row-email-delivery-${r.key}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-100">
                      {labelForTag(r.tag)}
                    </span>
                    {r.locale && (
                      <span className="text-[10px] uppercase tracking-wide text-slate-400 border border-slate-700 rounded px-1">
                        {r.locale}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-400 mt-0.5 truncate">
                    To <span className="text-slate-200">{r.recipient}</span>
                    {r.subject && (
                      <span className="text-slate-500">
                        {" "}
                        — <span className="text-slate-300">{r.subject}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <span title={r.queuedAt?.toLocaleString() ?? ""}>
                      Queued {formatRelative(r.queuedAt, now)}
                    </span>
                    {r.sentBy && (
                      <>
                        <span>·</span>
                        <span>by {r.sentBy}</span>
                      </>
                    )}
                  </div>
                  {r.status === "failed" && r.error && (
                    <div className="mt-1 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                      {r.error}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {statusBadge(r.status)}
                  {r.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] border-red-500/40 text-red-200 hover:bg-red-500/15 bg-transparent disabled:opacity-50"
                      onClick={() => retryRow(r)}
                      disabled={
                        !isRowRetryable(r) || Boolean(retrying[r.key])
                      }
                      title={
                        !isRowRetryable(r)
                          ? r.ambiguousLegacy
                            ? r.ambiguousReason === "no_source_record"
                              ? "This failure predates per-row retry tracking and the underlying record is no longer on file (deleted or never persisted), so there's nothing to safely resend. Re-create or re-run the original action."
                              : r.ambiguousReason === "multiple_source_records"
                                ? "This failure predates per-row retry tracking and matches more than one record on this case — we can't tell which one it referred to. Open Details to see the candidates and re-run the action on the correct row."
                                : "This failure predates per-row retry tracking and we can't safely resend the original content. Re-run the original action instead."
                            : "This email type can't be retried automatically — re-run the original action."
                          : undefined
                      }
                      data-testid={`button-retry-email-${r.key}`}
                    >
                      <RefreshCw
                        className={`h-3 w-3 mr-1 ${
                          retrying[r.key] ? "animate-spin" : ""
                        }`}
                      />
                      {retrying[r.key] ? "Retrying…" : "Retry"}
                    </Button>
                  )}
                  {r.status === "failed" &&
                    r.ambiguousLegacy &&
                    r.ambiguousReason === "multiple_source_records" &&
                    r.ambiguousCandidateIds.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px] text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                            data-testid={`button-ambiguous-details-${r.key}`}
                          >
                            <Info className="h-3 w-3 mr-1" />
                            Details
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          className="w-72 text-xs bg-slate-950 border-slate-700 text-slate-200"
                          data-testid={`popover-ambiguous-details-${r.key}`}
                        >
                          <div className="font-medium text-slate-100 mb-1">
                            Multiple matching records
                          </div>
                          <p className="text-slate-400 mb-2 leading-relaxed">
                            This legacy failure could have referred to any of
                            the {r.ambiguousCandidateIds.length}{" "}
                            {candidateRecordLabel(r.tag).toLowerCase()}
                            {r.ambiguousCandidateIds.length === 1 ? "" : "s"}{" "}
                            below. Open the matching row in the case and
                            re-run the action there.
                          </p>
                          <ul className="space-y-1">
                            {r.ambiguousCandidateIds.map((id) => (
                              <li
                                key={id}
                                className="font-mono text-slate-200 bg-slate-900/80 border border-slate-800 rounded px-2 py-1"
                                data-testid={`text-ambiguous-candidate-${r.key}-${id}`}
                              >
                                {candidateRecordLabel(r.tag)} #{id}
                              </li>
                            ))}
                          </ul>
                        </PopoverContent>
                      </Popover>
                    )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
