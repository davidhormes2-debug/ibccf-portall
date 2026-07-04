import type { Case } from "@/components/admin/shared";

interface StageSkipPanelsProps {
  selectedCase: Case;
  currentAdminRole: string;
  withdrawalStageEdit: string;
  stageSkipRequestReason: string;
  setStageSkipRequestReason: (v: string) => void;
  stageSkipRequestSubmitting: boolean;
  submitStageSkipRequest: () => void;
  stageSkipRejectReason: string;
  setStageSkipRejectReason: (v: string) => void;
  stageSkipActioning: boolean;
  approveStageSkipRequest: () => void;
  rejectStageSkipRequest: () => void;
}

export function StageSkipPanels({
  selectedCase,
  currentAdminRole,
  withdrawalStageEdit,
  stageSkipRequestReason,
  setStageSkipRequestReason,
  stageSkipRequestSubmitting,
  submitStageSkipRequest,
  stageSkipRejectReason,
  setStageSkipRejectReason,
  stageSkipActioning,
  approveStageSkipRequest,
  rejectStageSkipRequest,
}: StageSkipPanelsProps) {
  const currentStageNum = parseInt(selectedCase.withdrawalStage ?? "1", 10);
  const newStageNum = parseInt(withdrawalStageEdit, 10);
  const isNonSequential =
    withdrawalStageEdit !== selectedCase.withdrawalStage &&
    newStageNum !== currentStageNum + 1 &&
    newStageNum !== currentStageNum;

  const hasPendingRequest = selectedCase.stageSkipStatus === "pending";

  return (
    <>
      {/* Stage Skip Request panel — agent/admin only, non-sequential stage selected */}
      {currentAdminRole !== "super_admin" && selectedCase.withdrawalStage && isNonSequential && (
        <div
          className="mt-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-2"
          data-testid="stage-skip-request-section"
        >
          <p className="text-xs text-blue-300 font-medium">
            Request Stage Skip (super_admin approval required)
          </p>
          <p className="text-[10px] text-blue-400/70">
            Stage {selectedCase.withdrawalStage} → {withdrawalStageEdit} is non-sequential and requires
            super_admin approval.
          </p>
          {hasPendingRequest ? (
            <p className="text-xs text-amber-300 font-medium" data-testid="stage-skip-pending-notice">
              ⏳ A skip request is already pending super_admin review.
            </p>
          ) : (
            <>
              <input
                type="text"
                value={stageSkipRequestReason}
                onChange={(e) => setStageSkipRequestReason(e.target.value)}
                placeholder="Reason for skip (required)"
                className="w-full text-xs bg-slate-800/70 border border-blue-500/40 rounded px-2 py-1 text-slate-200 placeholder:text-slate-500"
                data-testid="stage-skip-request-reason"
              />
              <button
                type="button"
                onClick={submitStageSkipRequest}
                disabled={stageSkipRequestSubmitting || !stageSkipRequestReason.trim()}
                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium"
                data-testid="button-submit-stage-skip-request"
              >
                {stageSkipRequestSubmitting ? "Submitting…" : "Submit Skip Request"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Pending Stage Skip review panel — super_admin only */}
      {currentAdminRole === "super_admin" && selectedCase.stageSkipStatus === "pending" && (
        <div
          className="mt-2 p-3 bg-purple-500/10 border border-purple-500/40 rounded-lg space-y-2"
          data-testid="stage-skip-review-section"
        >
          <p className="text-xs text-purple-300 font-semibold">⚡ Pending Stage Skip Request</p>
          <div className="text-xs text-slate-300 space-y-1">
            <p>
              <span className="text-slate-500">Requested by:</span>{" "}
              {selectedCase.stageSkipRequestedBy ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Target stage:</span> Stage{" "}
              {selectedCase.stageSkipTargetStage ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Reason:</span> {selectedCase.stageSkipReason ?? "—"}
            </p>
            {selectedCase.stageSkipRequestedAt && (
              <p>
                <span className="text-slate-500">Requested at:</span>{" "}
                {new Date(selectedCase.stageSkipRequestedAt).toLocaleString()}
              </p>
            )}
          </div>
          <input
            type="text"
            value={stageSkipRejectReason}
            onChange={(e) => setStageSkipRejectReason(e.target.value)}
            placeholder="Rejection reason (optional)"
            className="w-full text-xs bg-slate-800/70 border border-purple-500/30 rounded px-2 py-1 text-slate-200 placeholder:text-slate-500"
            data-testid="stage-skip-reject-reason"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={approveStageSkipRequest}
              disabled={stageSkipActioning}
              className="text-xs px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium"
              data-testid="button-approve-stage-skip"
            >
              {stageSkipActioning ? "…" : "Approve & Apply"}
            </button>
            <button
              type="button"
              onClick={rejectStageSkipRequest}
              disabled={stageSkipActioning}
              className="text-xs px-3 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium"
              data-testid="button-reject-stage-skip"
            >
              {stageSkipActioning ? "…" : "Reject"}
            </button>
          </div>
          <p className="text-[10px] text-purple-400/70">
            Approval applies the stage override atomically and is audit-logged with your identity.
          </p>
        </div>
      )}
    </>
  );
}
