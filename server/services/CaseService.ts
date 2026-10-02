import { caseRepository, messageRepository } from "../repositories";
import type { Case, InsertCase, CaseLetter, UpdateCaseLetter } from "@shared/schema";
import type { DbExecutor } from "../db";

const STAGE_MESSAGES: Record<string, { category: 'urgent' | 'processing' | 'resolved'; title: string; body: string }> = {
  '1': { category: 'resolved', title: 'Signup Complete', body: 'Your case account has been created and your secure case record is active.' },
  '2': { category: 'urgent', title: 'Questionnaire Required', body: 'Please complete the case questionnaire and submit any requested supporting information.' },
  '3': { category: 'urgent', title: 'Agreement Review', body: 'Your case agreement is ready for review. Confirm the details before accepting or signing.' },
  '4': { category: 'resolved', title: 'Restricted Portal Active', body: 'Your restricted case workspace is active. Use the secure portal for case documents, messages and status updates.' },
  '5': { category: 'urgent', title: 'KYC Verification Required', body: 'Identity verification is required. Upload the requested KYC documents through the secure document workspace.' },
  '6': { category: 'urgent', title: 'Declaration of Funds Required', body: 'Complete the Declaration of Funds and provide the supporting documents requested for your case.' },
  '7': { category: 'urgent', title: 'Wallet Linking & Calibration', body: 'Confirm the approved payout method and complete wallet linking and calibration through the secure portal.' },
  '8': { category: 'processing', title: 'Tracking & Recovery', body: 'Case tracking and recovery activity is in progress. Monitor the portal for verified updates or required actions.' },
  '9': { category: 'processing', title: 'Crypto Escrow Wallet Creation', body: 'Escrow wallet preparation and final clearance controls are under review.' },
  '10': { category: 'resolved', title: 'Sequence Recovery', body: 'Your case has reached the final workflow step. Review the completion summary and any remaining action in the secure portal.' },
};

// STAGE_TRANSITION_ERROR_BLOCK_START
// Typed error for stage-sequence violations. The route handler catches this
// and maps it to the correct HTTP status (400 for out-of-sequence, 403 for
// non-super_admin attempting an override) so the caller gets an actionable
// message without a generic 500.
export class StageTransitionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 403,
  ) {
    super(message);
    this.name = 'StageTransitionError';
  }
}
// STAGE_TRANSITION_ERROR_BLOCK_END

export class CaseService {
  async createCase(data: InsertCase): Promise<Case> {
    return caseRepository.create(data);
  }

  async getCaseById(id: string): Promise<Case | undefined> {
    return caseRepository.findById(id);
  }

  async getCaseByAccessCode(code: string): Promise<Case | undefined> {
    return caseRepository.findByAccessCode(code);
  }

  async getAllCases(): Promise<Case[]> {
    return caseRepository.findAll();
  }

  async updateCase(
    id: string,
    data: Partial<InsertCase>,
    executor?: DbExecutor,
    options?: { adminRole?: string; overrideStageSequence?: boolean; overrideReason?: string },
  ): Promise<Case | undefined> {
    if (data.phraseKeyDepositAmount) {
      const numericMatch = data.phraseKeyDepositAmount.match(/[\d,.]+/);
      const currencyMatch = data.phraseKeyDepositAmount.match(/[A-Za-z]+$/);
      const currencySuffix = currencyMatch ? ' ' + currencyMatch[0] : '';
      
      if (numericMatch) {
        const depositAmount = parseFloat(numericMatch[0].replace(/,/g, ''));
        if (!isNaN(depositAmount)) {
          const mergeDeposit = depositAmount * 0.30;
          data.phraseKeyMergeDeposit = mergeDeposit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + currencySuffix;
        }
      }
    }

    const currentCase = await caseRepository.findById(id);
    const previousStage = currentCase?.withdrawalStage;
    const newStage = data.withdrawalStage;

    if (newStage) {
      const parsedStage = Number.parseInt(newStage, 10);
      if (!Number.isFinite(parsedStage) || parsedStage < 1 || parsedStage > 10) {
        throw new StageTransitionError(
          'Workflow steps must be between 1 and 10.',
          400,
        );
      }
    }

    // STAGE_SEQUENCE_GUARD_START
    // Enforce sequential stage transitions. Only current_stage + 1 is allowed
    // as a normal admin transition. A super_admin may bypass with
    // overrideStageSequence=true and a non-empty overrideReason. The guard
    // applies when:
    //   1. A new stage is actually being set (newStage is defined and non-empty).
    //   2. The current stage is already set (previousStage is non-null/empty) —
    //      initial assignment from null to any value is unrestricted.
    //   3. The new stage differs from the current stage (no-ops are always ok).
    //
    // Step A: Early rejection — any caller who sends overrideStageSequence=true
    // without having super_admin role is rejected immediately with 403,
    // regardless of whether the transition would have been sequential.
    if (options?.overrideStageSequence && options.adminRole !== 'super_admin') {
      throw new StageTransitionError(
        `Stage override requires super_admin role. Current role: ${options.adminRole ?? 'unknown'}.`,
        403,
      );
    }
    // Step B: Sequential check — only fires when previousStage is set and the
    // new stage differs from the current stage.
    if (
      newStage &&
      previousStage &&
      newStage !== previousStage
    ) {
      const prevNum = parseInt(previousStage, 10);
      const nextNum = parseInt(newStage, 10);
      if (Number.isFinite(prevNum) && Number.isFinite(nextNum) && nextNum !== prevNum + 1) {
        if (!options?.overrideStageSequence) {
          throw new StageTransitionError(
            `Stage transitions must be sequential. Current stage: ${prevNum}, requested: ${nextNum}. Use overrideStageSequence to bypass as super_admin.`,
            400,
          );
        }
        // Step C: Override is present (super_admin, cleared by Step A above).
        // Require a non-empty reason so every override is auditable.
        if (!options.overrideReason?.trim()) {
          throw new StageTransitionError(
            'An override reason is required when bypassing sequential stage enforcement.',
            400,
          );
        }
        // Valid override — execution continues; the route handler writes the
        // override_stage_transition audit row after commit.
      }
    }
    // STAGE_SEQUENCE_GUARD_END

        // MAX_STAGE_ADVANCE_BLOCK_START
    // Auto-advance maxStageReached whenever withdrawalStage moves forward.
    // Never decremented — ensures the portal keeps content unlocked even if
    // an admin rolls the live stage back later.
    //
    // NULL semantics: a null maxStageReached means "never explicitly tracked"
    // and is treated as the current live withdrawalStage, NOT zero. This
    // preserves the highest historical value on legacy rows while new workflow
    // transitions are restricted to canonical steps 1–10.
    if (newStage) {
      const newStageNum = parseInt(newStage, 10);
      const prevMax =
        currentCase?.maxStageReached ??
        parseInt(currentCase?.withdrawalStage ?? '0', 10);
      if (Number.isFinite(newStageNum) && newStageNum > prevMax) {
        data.maxStageReached = newStageNum;
      }
    }

    const updated = await caseRepository.update(id, data, executor);
    if (!updated) return undefined;

    if (newStage && previousStage !== newStage && STAGE_MESSAGES[newStage]) {
      const msg = STAGE_MESSAGES[newStage];
      await messageRepository.createAdminMessage({
        caseId: id,
        category: msg.category,
        title: msg.title,
        body: msg.body,
        isRead: false
      }, executor);
    }

    // Fire a localized stage-change email whenever the stage actually
    // changes. Best-effort fire-and-forget after the DB commit so a slow
    // or down mail server never blocks the admin action.
    if (newStage && previousStage !== newStage && updated.userEmail) {
      setImmediate(() => {
        (async () => {
          try {
            const { sendCaseEmailWithAudit } = await import('../services/emailNotify');
            const { emailService } = await import('../services/EmailService');
            const stageNum = parseInt(newStage, 10);
            const userEmail = updated.userEmail!;
            const userName = (updated.userName ?? '').trim() || userEmail;
            const preferredLocale = updated.preferredLocale ?? undefined;
            await sendCaseEmailWithAudit({
              to: userEmail,
              caseId: id,
              tag: 'email_stage_auto',
              send: (locale) =>
                emailService.sendStageInstructionsEmail(
                  userEmail,
                  userName,
                  updated.id,
                  stageNum,
                  undefined,
                  locale ?? preferredLocale,
                ),
            });
          } catch {
            // STAGE_EMAIL_CATCH_BLOCK_START — Never let a background email error surface
          }
        })();
      });
    }

    return updated;
  }

  async deleteCase(id: string, executor?: DbExecutor): Promise<void> {
    return caseRepository.delete(id, executor);
  }

  async getCaseLetter(caseId: string): Promise<CaseLetter | undefined> {
    return caseRepository.getLetter(caseId);
  }

  async updateCaseLetter(caseId: string, data: UpdateCaseLetter): Promise<CaseLetter> {
    return caseRepository.createOrUpdateLetter(caseId, data);
  }
}

export const caseService = new CaseService();
