// Shared, type-checked factory for a mock AdminDashboardContext value.
//
// Task #799 — Admin component tests used to hand-roll an untyped object
// literal as the context value. Because the literal was untyped, adding a
// new required field to AdminDashboardContextValue did NOT surface a compile
// error in the tests; they instead crashed at runtime with a confusing
// "Cannot read properties of undefined" once the component touched the
// missing field.
//
// This factory returns a COMPLETE AdminDashboardContextValue with inert
// defaults, typed against the real interface. Adding a new required field to
// the context now breaks compilation here (and in any test that relies on it)
// instead of failing silently at runtime. Tests pass a `Partial<…>` of
// overrides for the handful of values they actually exercise.

import { vi } from "vitest";
import type {
  AdminDashboardContextValue,
} from "@/components/admin/AdminDashboardContext";

const noop = () => {};
const noopAsync = async () => {};

export function buildMockAdminDashboardContext(
  overrides: Partial<AdminDashboardContextValue> = {},
): AdminDashboardContextValue {
  const base: AdminDashboardContextValue = {
    // Admin auth
    authToken: "test-token",
    adminRole: "super_admin",

    // Cases / submissions
    cases: [],
    filteredCases: [],
    allSubmissions: [],
    isDataLoading: false,
    loadData: noop,
    clearLogs: noop,
    setIsCreateOpen: noop,

    // Search/filter for cases tab
    searchQuery: "",
    setSearchQuery: noop,
    statusFilter: "all",
    setStatusFilter: noop,
    localeFilter: "all",
    setLocaleFilter: noop,
    sealedFilter: "all",
    setSealedFilter: noop,
    stampDutyPendingOnly: false,
    setStampDutyPendingOnly: noop,
    withdrawalPendingCounts: {},
    withdrawalPendingOnly: false,
    setWithdrawalPendingOnly: noop,
    loadWithdrawalPendingCounts: noop,
    reactivationPendingCounts: {},
    reactivationPendingOnly: false,
    setReactivationPendingOnly: noop,
    loadReactivationPendingCounts: noop,
    refundClaimStatusFilter: "all" as const,
    setRefundClaimStatusFilter: noop,

    // Top-level tab state
    activeTab: "cases",
    setActiveTab: noop,
    setReceiptsInboxFilter: noop,

    // Case actions
    getCaseSubmissionCount: () => 0,
    toggleLetterSent: noop,
    openFinalizeModal: noop,
    openLetterEditor: noop,
    openSubmissionsModal: noop,
    openChat: noop,
    openAdminMessageDialog: noop,
    openCaseEmailDelivery: noop,
    openReceiptsDialog: noop,
    openSendEmailDialog: noop,
    openWithdrawalRequestsDialog: noop,

    // Declaration of Compliance
    requestDeclaration: noop,
    regenerateDeclarationAccessCode: noop,
    clearDeclarationRequest: noop,
    openDeclarationDialog: noop,

    // Letter reissue
    openReissueLetterDialog: noop,
    clearLetterReissue: noop,

    // Account autonomy
    openEditAccountDialog: noop,
    openUserMirror: noop,

    // NDA admin previews
    openSignedNdaDialog: noop,
    openPreviewNdaDialog: noop,
    forceLogoutUser: noop,
    handleChatScroll: noop,
    toggleUserAccess: noop,
    resetUserPin: noop,
    handleDeleteSubmission: noop,

    // Conversations tab
    chatCase: null,
    setChatCase: noop,
    chatMessages: [],
    loadChatMessages: noop,
    sendChatMessage: noop,
    newMessage: "",
    setNewMessage: noop,
    isSendingMessage: false,
    unreadCounts: {},
    chatScrollRef: { current: null },

    // Settings tab — common
    settingsView: "main",
    setSettingsView: noop,
    theme: "dark",
    toggleTheme: noop,

    // Settings - Audit
    auditLogs: [],
    loadAuditLogs: noop,
    emergencyResetActivity: { events: [], lastUsedAt: null },
    loadEmergencyResetActivity: noop,

    // Settings - Admin sessions
    adminSessions: [],
    loadAdminSessions: noop,
    revokeAdminSession: noopAsync,
    revokeOtherAdminSessions: noopAsync,

    // Settings - Failed login attempts
    failedLogins: [],
    failedLoginCount24h: 0,
    loadFailedLogins: noop,
    failedLoginsByIp: [],
    failedLoginsByIpWindowHours: 24,
    loadFailedLoginsByIp: noop,

    // Settings - Suspicious declaration-read attempts
    declarationReadAttempts: [],
    declarationReadCount24h: 0,
    loadDeclarationReadAttempts: noop,
    declarationReadByIp: [],
    declarationReadByIpWindowHours: 24,
    loadDeclarationReadByIp: noop,

    // Settings - Scheduled messages
    scheduledMessages: [],
    loadScheduledMessages: noop,
    createScheduledMessage: noop,
    cancelScheduledMessage: noop,
    newScheduledMessage: {
      caseId: "",
      messageType: "chat",
      category: "",
      title: "",
      content: "",
      scheduledFor: "",
    },
    setNewScheduledMessage: noop,

    // Settings - Message templates
    messageTemplates: [],
    loadMessageTemplates: noop,
    createMessageTemplate: noop,
    deleteMessageTemplate: noop,
    newMessageTemplate: { name: "", content: "", category: "" },
    setNewMessageTemplate: noop,

    // Settings - Help articles
    helpArticles: [],
    loadHelpArticles: noop,
    createHelpArticle: noop,
    deleteHelpArticle: noop,
    newHelpArticle: {
      title: "",
      content: "",
      category: "",
      isPublished: false,
    },
    setNewHelpArticle: noop,

    // Settings - User feedback
    userFeedback: [],
    loadUserFeedback: noop,

    // Settings - Document requests
    documentRequests: [],
    loadDocumentRequests: noop,
    userDocPendingCounts: {},
    loadUserDocPendingCounts: noop,
    mutedAlertCaseIds: new Set<string>(),
    loadMutedAlertCases: noop,
    toggleAlertMute: noopAsync,
    isAlertMuteSaving: false,
    mutedWalletAlertCaseIds: new Set<string>(),
    fetchDocumentFile: async () => null,
    createDocumentRequest: noop,
    newDocumentRequest: {
      caseId: "",
      documentType: "",
      description: "",
      deadline: "",
      category: "",
    },
    setNewDocumentRequest: noop,
    setDocumentRequestUploadsEnabled: noop,
    approveDocumentRequest: noop,
    rejectDocumentRequest: noop,
    markDocumentUnderReview: noop,
    requestKycIdBundle: noop,

    // Settings - Admin users / user sessions
    adminUsers: [],
    loadAdminUsers: noop,
    userSessions: [],
    loadUserSessions: noop,
    deactivateUserSession: noop,

    // Settings - Translations
    translations: [],
    selectedLocale: "en",
    setSelectedLocale: noop,
    loadTranslations: noop,
    createTranslation: noop,
    deleteTranslation: noop,
    newTranslationKey: "",
    setNewTranslationKey: noop,
    newTranslationValue: "",
    setNewTranslationValue: noop,

    // Settings - card counts
    chatTemplates: [],
    setIsTemplateManagerOpen: noop,

    // Settings - Audit-log retention window
    auditRetention: null,
    isAuditRetentionLoading: false,
    isAuditRetentionSaving: false,
    loadAuditRetention: noop,
    saveAuditRetention: noop,

    // Settings - Community-participant cleanup retention window
    communityParticipantRetention: null,
    isCommunityParticipantRetentionLoading: false,
    isCommunityParticipantRetentionSaving: false,
    isCommunityParticipantRetentionRunning: false,
    lastCommunityParticipantRetentionRun: null,
    loadCommunityParticipantRetention: noop,
    saveCommunityParticipantRetention: noop,
    runCommunityParticipantRetention: noop,

    // Settings - Wallet-connect alert marker cleanup
    isWalletConnectAlertMarkerCleanupRunning: false,
    lastWalletConnectAlertMarkerCleanupRun: null,
    runWalletConnectAlertMarkerCleanup: noop,
    walletConnectAlertMarkerCount: null,
    isWalletConnectAlertMarkerCountLoading: false,
    loadWalletConnectAlertMarkerCount: noop,
    isWalletConnectCompletionBackfillRunning: false,
    lastWalletConnectCompletionBackfillRun: null,
    runWalletConnectCompletionBackfill: noop,
    walletConnectCompletionBackfillCount: null,
    isWalletConnectCompletionBackfillCountLoading: false,
    loadWalletConnectCompletionBackfillCount: noop,

    // Settings - Wallet-connect alert marker cleanup sweep cadence
    walletConnectAlertCleanupInterval: null,
    isWalletConnectAlertCleanupIntervalLoading: false,
    isWalletConnectAlertCleanupIntervalSaving: false,
    loadWalletConnectAlertCleanupInterval: noop,
    saveWalletConnectAlertCleanupInterval: noop,

    // Settings - Community thread-views cleanup
    isCommunityThreadViewsCleanupRunning: false,
    lastCommunityThreadViewsCleanupRun: null,
    runCommunityThreadViewsCleanup: noop,
    communityThreadViewsStaleCount: null,
    isCommunityThreadViewsStaleCountLoading: false,
    loadCommunityThreadViewsStaleCount: noop,

    // Settings - Sealed-NDA integrity sweep cadence
    ndaSweepInterval: null,
    isNdaSweepIntervalLoading: false,
    isNdaSweepIntervalSaving: false,
    loadNdaSweepInterval: noop,
    saveNdaSweepInterval: noop,

    // Settings - Sealed-NDA integrity sweep summary cadence
    ndaSweepSummaryFrequency: null,
    isNdaSweepSummaryFrequencyLoading: false,
    isNdaSweepSummaryFrequencySaving: false,
    loadNdaSweepSummaryFrequency: noop,
    saveNdaSweepSummaryFrequency: noop,
    ndaIntegritySweep: null,

    // Settings - Stale-sweep watchdog grace window
    ndaSweepStaleGrace: null,
    isNdaSweepStaleGraceLoading: false,
    isNdaSweepStaleGraceSaving: false,
    loadNdaSweepStaleGrace: noop,
    saveNdaSweepStaleGrace: noop,

    // Settings - Email-failure alert cooldown
    emailFailureAlertCooldown: null,
    isEmailFailureAlertCooldownLoading: false,
    isEmailFailureAlertCooldownSaving: false,
    loadEmailFailureAlertCooldown: noop,
    saveEmailFailureAlertCooldown: noop,

    // Settings - Sealed-NDA tamper alert email recipient
    tamperAlertEmail: null,
    isTamperAlertEmailLoading: false,
    isTamperAlertEmailSaving: false,
    isTamperAlertEmailTesting: false,
    loadTamperAlertEmail: noop,
    saveTamperAlertEmail: noop,
    sendTamperAlertEmailTest: noop,

    // Settings - Document upload alert email recipient
    documentUploadAlertEmail: null,
    isDocumentUploadAlertEmailLoading: false,
    isDocumentUploadAlertEmailSaving: false,
    isDocumentUploadAlertEmailTesting: false,
    loadDocumentUploadAlertEmail: noop,
    saveDocumentUploadAlertEmail: noop,
    sendDocumentUploadAlertEmailTest: noop,

    // Settings - Document upload alert cooldown
    docUploadAlertCooldown: null,
    isDocUploadAlertCooldownLoading: false,
    isDocUploadAlertCooldownSaving: false,
    loadDocUploadAlertCooldown: noop,
    saveDocUploadAlertCooldown: noop,

    // Settings - Stale-sweep watchdog
    ndaSweepStaleness: null,
    isNdaSweepStalenessLoading: false,
    loadNdaSweepStaleness: noop,

    // Toast
    toast: vi.fn() as unknown as AdminDashboardContextValue["toast"],
  };

  return { ...base, ...overrides };
}
