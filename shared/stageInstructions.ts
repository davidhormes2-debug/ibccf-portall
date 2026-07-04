export interface StageInstruction {
  stage: number;
  icon: string;
  title: string;
  summary: string;
  detailedExplanation: string;
  whyItMatters: string;
  regulatoryBasis: string[];
  whatToDo: string[];
  whatToExpect: string;
}

export const STAGE_INSTRUCTIONS: StageInstruction[] = [
  {
    stage: 1,
    icon: "💰",
    title: "Phrase Key Deposit Received",
    summary:
      "Your initial Phrase Key Deposit has been confirmed on the distributed ledger. Your case is now active and queued for the next compliance step.",
    detailedExplanation:
      "The Phrase Key Deposit is a refundable, on-ledger collateral that anchors your case to a verifiable on-chain transaction hash. Once a minimum of three block confirmations is observed, our compliance pipeline opens an active enforcement file under your unique case reference. From this moment, all subsequent activity (deposits, declarations, key issuance) is cryptographically linked to that opening transaction so the chain of custody can be reproduced end-to-end during any post-settlement audit.",
    whyItMatters:
      "This step satisfies the IBCCF entry-control requirement, mirroring FATF Recommendation 10 on Customer Due Diligence (CDD): no withdrawal pipeline may be opened without a verifiable, beneficiary-initiated on-chain attestation linking the requester to the receiving wallet. It also begins the audit trail used later for FATF Travel Rule (Recommendation 16) reporting.",
    regulatoryBasis: [
      "FATF Recommendation 10 — Customer Due Diligence (CDD)",
      "FATF Recommendation 16 — Travel Rule attestation",
      "BSA / 31 CFR §1010.230 — Beneficial-ownership identification",
    ],
    whatToDo: [
      "Sign in to your secure portal and confirm your registered receiving wallet address is correct.",
      "Keep your access key and 6-digit PIN safe — they are required for every step that follows.",
      "Do not initiate any new outbound transfers from the receiving wallet until your case advances.",
    ],
    whatToExpect:
      "A compliance officer will begin generating your Secure Phrase Key. Generation typically takes between 6 and 24 hours depending on review queue depth.",
  },
  {
    stage: 2,
    icon: "⚙️",
    title: "Generating Secure Phrase Key",
    summary:
      "Our compliance system is generating a unique, encrypted Phrase Key bound to your case. No action is required from you at this moment.",
    detailedExplanation:
      "The Secure Phrase Key is produced inside an isolated key-ceremony environment using a multi-party computation (MPC) split across three independent compliance signers. Each signer holds only a partial share, and no single party — including IBCCF staff — ever sees the assembled key in plaintext. The key is then sealed under an HSM-protected envelope and bound to your case reference, your receiving wallet, and the timestamp of your Phrase Key Deposit.",
    whyItMatters:
      "Cryptographic key segregation is mandated for any custodian moving customer funds across borders. This stage exists to guarantee that, even in the event of an internal compromise, no individual operator can unilaterally release your withdrawal — fulfilling the segregation-of-duties principle required by ISO/IEC 27001 A.6.1.2 and the SEC custody attestation framework outlined in SAB 121.",
    regulatoryBasis: [
      "ISO/IEC 27001 A.6.1.2 — Segregation of Duties",
      "NIST SP 800-57 — Cryptographic Key Management Lifecycle",
      "SEC Staff Accounting Bulletin No. 121 — Crypto-asset custodial obligations",
    ],
    whatToDo: [
      "Remain available — you may be contacted via the secure messaging panel inside your portal.",
      "Do not share your access key or PIN with anyone, including IBCCF staff.",
    ],
    whatToExpect:
      "Once generation completes, your Phrase Key is released to your case file in the next stage. You will be notified inside the portal.",
  },
  {
    stage: 3,
    icon: "🔐",
    title: "Phrase Key Approved & Available",
    summary:
      "Your Secure Phrase Key has been approved and issued. It is now visible inside the secure portal under your active case.",
    detailedExplanation:
      "Your Phrase Key has cleared the dual-control approval workflow and is now bound to your case as the cryptographic identity used for every downstream signing operation. The key is displayed only inside an authenticated portal session over TLS 1.3, never transmitted by email or chat, and is rotated automatically if any anomalous access is detected.",
    whyItMatters:
      "Issuance under dual control with in-portal-only disclosure satisfies the customer-identification requirements of the USA PATRIOT Act §326 (Customer Identification Program) and the in-band-only disclosure principle recommended by FFIEC IT Examination Handbook (Authentication module). It also closes the loop on the chain of custody opened in Stage 1.",
    regulatoryBasis: [
      "USA PATRIOT Act §326 — Customer Identification Program (CIP)",
      "FFIEC IT Examination Handbook — Authentication and Access Management",
      "EBA Guidelines on ICT and Security Risk Management §3.4",
    ],
    whatToDo: [
      "Open your portal and locate your Phrase Key in the Secure section of your dashboard.",
      "Acknowledge receipt by reviewing the message sent through the secure portal.",
      "Never type your Phrase Key into any external website, email, chat or third-party form.",
    ],
    whatToExpect:
      "Your case will progress to the Withdrawal Initiation phase shortly after your acknowledgement is recorded.",
  },
  {
    stage: 4,
    icon: "🚀",
    title: "Withdrawal Process Initiated",
    summary:
      "Your withdrawal request has been formally initiated. Your finalised withdrawal letter is now available in the portal.",
    detailedExplanation:
      "The withdrawal letter is your formal disclosure document. It enumerates the two settlement paths available to you (Option A — Accelerated Release, Option B — Standard Release), the per-batch amount, batch frequency, Phrase Key Cost, and the total requirement for each path. Your election is recorded as an irrevocable client instruction (subject to the cooling-off rules disclosed in the letter footer) and forms the basis for every subsequent verification step.",
    whyItMatters:
      "Presenting a written, beneficiary-elected settlement schedule satisfies the pre-contractual disclosure requirements of MiCA Title II (Articles 6 and 13) and the consumer-rights principle codified in the EU Distance Marketing of Financial Services Directive 2002/65/EC. Recording your election creates the auditable client mandate required before any value can be released on your behalf.",
    regulatoryBasis: [
      "MiCA Regulation (EU) 2023/1114 — Title II, Articles 6 & 13 (pre-contractual disclosure)",
      "EU Directive 2002/65/EC — Distance Marketing of Financial Services",
      "ESMA Guidelines on suitability and appropriateness assessments",
    ],
    whatToDo: [
      "Open the Withdrawal section of your portal and read your withdrawal letter carefully.",
      "Select your preferred withdrawal option (Option A — Accelerated, or Option B — Standard).",
      "Confirm your selection so the request can move to verification.",
    ],
    whatToExpect:
      "Once your option is selected, the Initial Deposit Verification stage begins automatically.",
  },
  {
    stage: 5,
    icon: "✅",
    title: "Initial Deposit Verification",
    summary:
      "Your initial deposit is being verified against the option you selected.",
    detailedExplanation:
      "Verification cross-checks every receipt you have submitted against the on-chain transaction record (block height, value, asset, sending address) and confirms the amount precisely matches the figure stated in your selected option. Any mismatch — even a partial decimal — must be reconciled before the case can advance, because the downstream batches are derived deterministically from this opening figure.",
    whyItMatters:
      "Source-of-funds verification at the opening of the settlement schedule is the cornerstone of Enhanced Due Diligence (EDD) under FATF Recommendation 10 and is also a prerequisite for FinCEN's Currency Transaction Reporting (CTR) obligations whenever the aggregated batch value will exceed the USD 10,000 reporting threshold.",
    regulatoryBasis: [
      "FATF Recommendation 10 — Enhanced Due Diligence (EDD)",
      "FinCEN 31 CFR §1010.311 — Currency Transaction Report (CTR) thresholds",
      "EU 6AMLD (Directive 2018/1673) — Predicate offences and source-of-funds standards",
    ],
    whatToDo: [
      "Submit any deposit receipts or transaction hashes requested via the secure messaging panel.",
      "Ensure the deposit amount and currency match the figures shown in your withdrawal letter exactly.",
    ],
    whatToExpect:
      "Verification typically completes within 24 hours. You will be notified inside the portal when the result is recorded.",
  },
  {
    stage: 6,
    icon: "🔑",
    title: "Phrase Key Verification",
    summary:
      "Your Phrase Key is being cross-validated by the compliance team.",
    detailedExplanation:
      "Cross-validation re-derives the cryptographic fingerprint of the Phrase Key issued in Stage 3 and compares it against the sealed copy held under HSM custody. The two-factor cryptographic challenge confirms that the key in your possession is genuinely the one issued to your case and has not been duplicated, leaked, or substituted.",
    whyItMatters:
      "Re-attestation of the customer-held credential before any value-transfer step is required to meet NIST SP 800-63B Authenticator Assurance Level 2 (AAL2) and the strong customer authentication (SCA) requirements imposed on payment service providers under PSD2 (Directive (EU) 2015/2366).",
    regulatoryBasis: [
      "NIST SP 800-63B — Authenticator Assurance Level 2 (AAL2)",
      "EU PSD2 (Directive (EU) 2015/2366) — Strong Customer Authentication (SCA)",
      "ISO/IEC 29115 — Entity authentication assurance framework",
    ],
    whatToDo: [
      "If asked, re-confirm your Phrase Key by entering it inside the portal — never via email or chat.",
      "Watch for any messages requesting clarification.",
    ],
    whatToExpect:
      "Once verified, you will move on to the Phrase Key Merge Deposit stage.",
  },
  {
    stage: 7,
    icon: "📊",
    title: "Phrase Key Merge Deposit Required",
    summary:
      "A 30% Phrase Key Merge Deposit is required to complete the merging of your verified Phrase Key with the withdrawal ledger.",
    detailedExplanation:
      "The Merge Deposit is a refundable, ledger-side collateral that allows your verified Phrase Key to be merged into the master settlement ledger as a single contiguous entry rather than being settled as fragmented micro-batches. Without merging, your withdrawal would be split across many small transfers, each of which would need to be re-screened separately and incur additional gas, slippage and AML re-screening costs. The 30% figure mirrors the prudential coverage ratio used for unencumbered settlement collateral under the Basel III LCR framework.",
    whyItMatters:
      "The Merge Deposit ensures the settlement file remains a single, auditable disbursement, which is required to meet anti-fragmentation rules embedded in FinCEN's structuring prohibition (31 USC §5324) and the EBA's guidelines on the prevention of transaction layering. It also short-circuits any AML uplift that would otherwise be triggered by a fragmented settlement pattern.",
    regulatoryBasis: [
      "Basel III LCR — Liquidity Coverage Ratio collateralisation",
      "31 USC §5324 — Prohibition on structuring transactions",
      "EBA Guidelines EBA/GL/2021/02 — Prevention of transaction layering",
    ],
    whatToDo: [
      "Review the merge deposit amount shown inside your portal.",
      "Send the deposit to the wallet address provided in your portal — never to any address received by email.",
      "Upload the transaction receipt in the Deposit section of the portal.",
    ],
    whatToExpect:
      "After confirmation on the blockchain, your case will advance to Financial Department Verification.",
  },
  {
    stage: 8,
    icon: "🏦",
    title: "Financial Department Verification",
    summary:
      "The Financial Department is reviewing your merged ledger entry and supporting deposits.",
    detailedExplanation:
      "Financial review reconciles every value movement attached to your case (initial deposit, merge deposit, projected disbursement) against the cleared bank-grade ledger and looks for any anomaly that could indicate misappropriation, duplicate processing or counterparty risk. The reviewing officer signs off using a four-eyes principle, with both signatures stored in the audit log.",
    whyItMatters:
      "Independent financial sign-off implements the COSO 2013 internal-control framework and the auditing standards in ISA 600 (group audits) and PCAOB AS 2410 (related-party transactions). It is also a prerequisite for filing any Suspicious Activity Report (SAR) that may be triggered downstream.",
    regulatoryBasis: [
      "COSO 2013 — Internal Control Integrated Framework",
      "ISA 600 / PCAOB AS 2410 — Audit standards",
      "FinCEN 31 CFR §1020.320 — Suspicious Activity Reporting",
    ],
    whatToDo: [
      "Make sure all uploaded receipts are clear and legible.",
      "Respond promptly to any requests for additional information sent via secure messaging.",
    ],
    whatToExpect:
      "On approval, your case proceeds to the Mining Withdrawal clearance step.",
  },
  {
    stage: 9,
    icon: "⛏️",
    title: "Mining Withdrawal for Final Clearance",
    summary:
      "Your withdrawal is being prepared for blockchain processing by the mining clearance desk.",
    detailedExplanation:
      "The mining clearance desk allocates a dedicated network slot, pre-funds the gas envelope and applies MEV (Miner Extractable Value) protection so your settlement transaction cannot be front-run, sandwich-attacked or re-ordered by an opportunistic validator. No deposit is required from you at this stage.",
    whyItMatters:
      "MEV-protected execution is mandated by ESMA's guidelines on settlement finality for crypto-asset service providers and aligns with the principles of fair and orderly markets set out in MiFID II Article 17 (algorithmic-trading safeguards extended by analogy to on-chain execution).",
    regulatoryBasis: [
      "ESMA Guidelines on settlement finality for CASPs",
      "MiFID II — Article 17 (orderly execution principles)",
      "EIP-1559 — Transaction-fee market for predictable gas allocation",
    ],
    whatToDo: [
      "No deposit is required at this stage — beware of anyone requesting one outside the official portal.",
      "Confirm your receiving wallet address one more time inside the portal.",
    ],
    whatToExpect:
      "When clearance completes, your wallet activity will be verified on-chain.",
  },
  {
    stage: 10,
    icon: "🔗",
    title: "Blockchain Activity Verification",
    summary:
      "Your receiving wallet must hold the required activity balance so on-chain settlement can be verified.",
    detailedExplanation:
      "Activity verification confirms the receiving wallet is non-dormant, OFAC-clean and capable of accepting the inbound settlement without rejecting it back to the network. The required balance acts as a heuristic signal of an active, real beneficiary and is reviewed by the same KYT (Know Your Transaction) tooling used by major custodians. The balance remains 100% under your control at all times.",
    whyItMatters:
      "Pre-settlement wallet verification is required to comply with OFAC's SDN and SDGT screening obligations (50 USC §1701 et seq.) and with the FATF Travel Rule's beneficiary-attestation requirement. It also prevents the funds from being trapped in a dormant or sanctioned address, which would force a regulator-mandated freeze.",
    regulatoryBasis: [
      "OFAC Regulations — 31 CFR Chapter V (SDN/SDGT screening)",
      "FATF Recommendation 16 — Travel Rule (beneficiary verification)",
      "Chainalysis KYT industry standard for wallet risk scoring",
    ],
    whatToDo: [
      "Ensure the activity balance shown in your portal is present and held in your receiving wallet.",
      "Do not move funds out of the receiving wallet until verification is complete.",
    ],
    whatToExpect:
      "Once on-chain activity is confirmed, the IRS / International AML check begins.",
  },
  {
    stage: 11,
    icon: "🏛️",
    title: "IRS / International AML Verification",
    summary:
      "Your withdrawal is undergoing international anti-money-laundering and tax-reporting checks.",
    detailedExplanation:
      "This stage performs the international tax and AML reconciliation: a FATCA / CRS residency check, an OECD CARF crypto-asset reporting alignment, a FinCEN screening pass and (where applicable) preparation of the IRS Form 1099-DA broker statement. You will be asked to digitally sign the Declaration of Compliance, which records your acknowledgement that the funds are being released under your tax residency.",
    whyItMatters:
      "Cross-border settlements above the de-minimis thresholds set by FATCA and CRS cannot be released without a signed beneficiary declaration. This stage protects you from later being assessed punitive withholding (up to 30% under IRC §1471) and ensures the disbursement is reportable in your home jurisdiction under the OECD's Crypto-Asset Reporting Framework.",
    regulatoryBasis: [
      "FATCA — IRC §1471–1474 (foreign account reporting)",
      "OECD Common Reporting Standard (CRS) and Crypto-Asset Reporting Framework (CARF)",
      "IRS Form 1099-DA — Digital-asset broker reporting (effective 2025+)",
      "FinCEN 31 CFR §1010.350 — FBAR review",
    ],
    whatToDo: [
      "Review and digitally sign the Declaration of Compliance presented in your portal.",
      "Provide any tax-residency documentation requested via secure messaging.",
    ],
    whatToExpect:
      "Once cleared, your case advances to the Final Withdrawal Processing stage.",
  },
  {
    stage: 12,
    icon: "📋",
    title: "Final Withdrawal Processing",
    summary:
      "Your withdrawal is in its final processing window. All deposits, declarations and verifications must be complete.",
    detailedExplanation:
      "Final processing places your case into the queued-for-settlement state. The disbursement is locked to your receiving wallet, the gas envelope is committed and the regulatory hold counter begins. During the hold window any final compliance flags can be raised; once the window closes without objection, the funds are released automatically.",
    whyItMatters:
      "The mandatory hold window mirrors the T+1 settlement standard adopted by the SEC for US securities (Rule 15c6-1 amendments effective May 2024) and the equivalent settlement-finality rules under the EU Settlement Finality Directive (Directive 98/26/EC). The window is what makes the disbursement irrevocable once complete.",
    regulatoryBasis: [
      "SEC Rule 15c6-1 — T+1 settlement cycle",
      "EU Directive 98/26/EC — Settlement Finality Directive",
      "ESMA Final Report on settlement-finality alignment for crypto-assets",
    ],
    whatToDo: [
      "Confirm one last time that your receiving wallet is correct.",
      "Stay alert for the final-delivery time-stamp request that may follow.",
    ],
    whatToExpect:
      "Funds are scheduled for release pending the final time-stamp deposit (if applicable to your option).",
  },
  {
    stage: 13,
    icon: "🎉",
    title: "Withdrawal Successfully Released",
    summary:
      "Congratulations — your withdrawal has been released to your receiving wallet.",
    detailedExplanation:
      "The release event is final and irrevocable. A settlement attestation has been written to your case file containing the on-chain transaction hash, the block height of confirmation, the settlement timestamp and the signing officer's compliance ID. This attestation is the document you should retain for any future tax filing or audit.",
    whyItMatters:
      "A signed settlement attestation is required to evidence the release for FATCA and CRS reporting and to discharge IBCCF's record-keeping obligations under FATF Recommendation 11 (five-year retention) and the EU AML Regulation (EU) 2024/1624 (Article 56 record-keeping standards).",
    regulatoryBasis: [
      "FATF Recommendation 11 — Record retention (minimum 5 years)",
      "EU AML Regulation (EU) 2024/1624 — Article 56 record-keeping",
      "ISA 230 — Audit documentation standard",
    ],
    whatToDo: [
      "Confirm receipt inside your portal so the case can be officially closed.",
      "Retain a copy of your withdrawal letter and the settlement attestation for your records.",
    ],
    whatToExpect:
      "A final case-closure email will follow once your acknowledgement is recorded.",
  },
  {
    stage: 14,
    icon: "⏰",
    title: "Time-Stamp Deposit for Final Delivery",
    summary:
      "A small Time-Stamp Deposit is required to lock the on-chain delivery slot reserved for your withdrawal.",
    detailedExplanation:
      "The Time-Stamp Deposit funds a time-locked transaction (analogous to BIP 65 CHECKLOCKTIMEVERIFY on Bitcoin and equivalent locktime opcodes on EVM chains) that reserves the exact block-window in which your withdrawal will be released. Without this lock, your settlement would compete in the open mempool with every other transaction in that window and could be delayed indefinitely. The deposit is consumed by the time-lock and is not refundable in cash, but it is fully credited against the gas reservation for your release.",
    whyItMatters:
      "Time-locked reservation is required by ESMA's settlement-finality guidance for high-value crypto-asset disbursements and is recommended by ISO 20022 messaging standards for cross-border value transfers, both of which require a deterministic, pre-committed settlement window.",
    regulatoryBasis: [
      "ESMA Guidelines on settlement-finality for crypto-assets",
      "ISO 20022 — Cross-border payments messaging standards",
      "BIP 65 (CLTV) and EVM locktime opcodes — Industry standard for time-locked settlement",
    ],
    whatToDo: [
      "Review the Time-Stamp Deposit amount and destination wallet inside your portal.",
      "Send the deposit and upload the transaction hash in the Deposit section.",
    ],
    whatToExpect:
      "Once the time-stamp clears, your withdrawal will be released within the reserved delivery window.",
  },
];

export function getStageInstruction(stageNumber: number): StageInstruction {
  const found = STAGE_INSTRUCTIONS.find((s) => s.stage === stageNumber);
  return found || STAGE_INSTRUCTIONS[0];
}

// =============================================================================
// Recommended financial paperwork per stage
// -----------------------------------------------------------------------------
// The user-facing portal "Recommended Paperwork" card reads this map to surface
// the document categories most likely to be requested at the current stage,
// so users can prepare files before the admin formally requests them.
//
// Values reference the document-category keys defined in
// server/routes/content.ts and labelled in
// client/src/components/admin/tabs/DocumentsTab.tsx. Keep keys in sync — an
// unknown key just falls back to its key as the label.
//
// Only the stages where new paperwork commonly becomes relevant are listed;
// other stages return an empty array (the card hides itself when empty).
// =============================================================================
export const STAGE_RECOMMENDED_DOCUMENTS: Record<number, string[]> = {
  1: ["kyc_id", "proof_of_income"],
  3: ["source_of_funds", "bank_statement"],
  6: ["fatca_crs", "tax_return"],
  9: ["aml_screening", "beneficial_ownership"],
  12: ["wallet_ownership_proof"],
};

export function getRecommendedDocumentsForStage(stage: number): string[] {
  return STAGE_RECOMMENDED_DOCUMENTS[stage] ?? [];
}

// Human-readable labels mirrored from the admin CATEGORY_LABELS map so the
// portal can display them without importing admin-only code.
export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  proof_of_income: "Proof of Income",
  source_of_funds: "Source of Funds",
  kyc_id: "KYC Identity",
  fatca_crs: "FATCA / CRS",
  bank_statement: "Bank Statement",
  tax_return: "Tax Return",
  wallet_ownership_proof: "Wallet Ownership Proof",
  aml_screening: "AML / Sanctions Screening",
  beneficial_ownership: "Beneficial Ownership",
  custom: "Other Supporting Document",
};

/**
 * Locale-aware overlay applied on top of the canonical English
 * STAGE_INSTRUCTIONS. We translate the high-visibility fields the user
 * actually reads in the portal cards (title / summary / whatToExpect)
 * and keep the regulatory-basis paragraphs in English so the legal
 * citations remain authoritative. Pass a `t(ns, key)` function so this
 * helper stays runtime-free and can be called from both the React
 * client (via i18next) and the Express server (via services/i18n.ts).
 *
 * Critical: the activation-deposit copy on stage 7 mentions the
 * 1,000 USDT refundable / 500 USDT non-refundable split verbatim — see
 * the deposit-messaging gotcha in replit.md. Translators must preserve
 * the breakdown in every locale.
 */
export type StageTFn = (namespace: string, key: string) => string;

export function applyStageTranslations(
  stage: StageInstruction,
  t: StageTFn,
): StageInstruction {
  const get = (key: string, fallback: string) => {
    const v = t("stages", key);
    return v && v !== key ? v : fallback;
  };
  // Translators may incrementally extend stages.json with `detailedExplanation`,
  // `whyItMatters`, and `whatToDo` (string[]). When absent, we fall back to the
  // English source so partial translations never blank the UI. `regulatoryBasis`
  // citations remain English by design — those are legal references that must
  // retain their authoritative wording.
  const arr = (key: string): string[] | null => {
    const v = t("stages", key);
    if (!v || v === key) return null;
    if (typeof v !== "string") return null;
    // i18next returns joined strings for arrays unless `returnObjects` is set;
    // the server-side `tFor` only returns strings. Translators may use a JSON
    // array OR a newline-delimited string. We accept either.
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* not JSON */
    }
    return v.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  };
  return {
    ...stage,
    title: get(`${stage.stage}.title`, stage.title),
    summary: get(`${stage.stage}.summary`, stage.summary),
    whatToExpect: get(`${stage.stage}.whatToExpect`, stage.whatToExpect),
    detailedExplanation: get(
      `${stage.stage}.detailedExplanation`,
      stage.detailedExplanation,
    ),
    whyItMatters: get(`${stage.stage}.whyItMatters`, stage.whyItMatters),
    whatToDo: arr(`${stage.stage}.whatToDo`) ?? stage.whatToDo,
  };
}

export function getStageInstructionLocalized(
  stageNumber: number,
  t: StageTFn,
): StageInstruction {
  return applyStageTranslations(getStageInstruction(stageNumber), t);
}
