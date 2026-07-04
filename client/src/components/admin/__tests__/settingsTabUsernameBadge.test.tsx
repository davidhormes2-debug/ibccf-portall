// @vitest-environment jsdom
//
// Integration guard: username-strength badge appears inside the real SettingsTab
//
// SettingsTab.tsx fetches GET /api/admin/security-flags on mount and uses the
// `adminUsernameTrivial` boolean from the response to decide which badge to
// render on the Change Username card:
//
//   true  → <Badge data-testid="badge-username-strength-trivial"> (red)
//   false → <Badge data-testid="badge-username-strength-ok">      (teal)
//   null  → fallback "Security" badge (loading / fetch failed)
//
// The unit-level badge behaviour is already exercised by
// usernameStrengthBadge.test.tsx. This file closes the remaining integration
// gap by mounting the REAL SettingsTab component and confirming the full
// fetch→state→badge pipeline works end-to-end — catching any regression
// that breaks wiring inside SettingsTab itself (wrong key, dropped useEffect
// dependency, missing settingsView guard, etc.) and that a harness test
// cannot catch.
//
// The component is mounted under a minimal AdminDashboardContext provider with
// `settingsView: "main"` so the card grid that contains the Change Username
// card is rendered. fetch is mocked globally so the security-flags endpoint
// can return different flag values per test.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { createRef } from "react";
import {
  AdminDashboardContext,
  type AdminDashboardContextValue,
} from "../AdminDashboardContext";
import { SettingsTab } from "../tabs/SettingsTab";

// ── minimal context mock ─────────────────────────────────────────────────────
//
// SettingsTab destructures a large context. We only need to provide real
// values for the fields it actually reads at render time; everything else
// gets a noop / empty default so the component doesn't throw.

const noop = () => {};
const asyncNoop = async () => {};

function makeContextValue(
  overrides: Partial<AdminDashboardContextValue> = {},
): AdminDashboardContextValue {
  return {
    authToken: "tok-test",
    cases: [],
    filteredCases: [],
    allSubmissions: [],
    isDataLoading: false,
    loadData: noop,
    clearLogs: noop,
    setIsCreateOpen: noop,
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
    activeTab: "settings",
    setActiveTab: noop,
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
    requestDeclaration: noop,
    regenerateDeclarationAccessCode: noop,
    clearDeclarationRequest: noop,
    openDeclarationDialog: noop,
    openReissueLetterDialog: noop,
    clearLetterReissue: noop,
    openEditAccountDialog: noop,
    openUserMirror: noop,
    openSignedNdaDialog: noop,
    openPreviewNdaDialog: noop,
    forceLogoutUser: noop,
    handleChatScroll: noop,
    toggleUserAccess: noop,
    handleDeleteSubmission: noop,
    chatCase: null,
    setChatCase: noop,
    chatMessages: [],
    loadChatMessages: noop,
    sendChatMessage: noop,
    newMessage: "",
    setNewMessage: noop,
    isSendingMessage: false,
    unreadCounts: {},
    chatScrollRef: createRef(),
    settingsView: "main",
    setSettingsView: noop,
    theme: "dark",
    toggleTheme: noop,
    auditLogs: [],
    loadAuditLogs: noop,
    emergencyResetActivity: { events: [], lastUsedAt: null },
    loadEmergencyResetActivity: noop,
    adminSessions: [],
    loadAdminSessions: noop,
    revokeAdminSession: noop,
    revokeOtherAdminSessions: noop,
    failedLogins: [],
    failedLoginCount24h: 0,
    loadFailedLogins: noop,
    failedLoginsByIp: [],
    failedLoginsByIpWindowHours: 24,
    loadFailedLoginsByIp: noop,
    declarationReadAttempts: [],
    declarationReadCount24h: 0,
    loadDeclarationReadAttempts: noop,
    declarationReadByIp: [],
    declarationReadByIpWindowHours: 24,
    loadDeclarationReadByIp: noop,
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
    messageTemplates: [],
    loadMessageTemplates: noop,
    createMessageTemplate: noop,
    deleteMessageTemplate: noop,
    newMessageTemplate: { name: "", content: "", category: "" },
    setNewMessageTemplate: noop,
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
    userFeedback: [],
    loadUserFeedback: noop,
    documentRequests: [],
    loadDocumentRequests: noop,
    createDocumentRequest: noop,
    newDocumentRequest: {
      caseId: "",
      documentType: "",
      description: "",
      deadline: "",
    },
    setNewDocumentRequest: noop,
    setDocumentRequestUploadsEnabled: noop,
    approveDocumentRequest: noop,
    rejectDocumentRequest: noop,
    markDocumentUnderReview: noop,
    requestKycIdBundle: noop,
    userDocPendingCounts: {},
    loadUserDocPendingCounts: noop,
    mutedAlertCaseIds: new Set(),
    loadMutedAlertCases: noop,
    toggleAlertMute: asyncNoop,
    isAlertMuteSaving: false,
    mutedWalletAlertCaseIds: new Set(),
    fetchDocumentFile: asyncNoop,
    adminUsers: [],
    loadAdminUsers: noop,
    userSessions: [],
    loadUserSessions: noop,
    deactivateUserSession: noop,
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
    chatTemplates: [],
    setIsTemplateManagerOpen: noop,
    auditRetention: null,
    isAuditRetentionLoading: false,
    isAuditRetentionSaving: false,
    loadAuditRetention: noop,
    saveAuditRetention: noop,
    communityParticipantRetention: null,
    isCommunityParticipantRetentionLoading: false,
    isCommunityParticipantRetentionSaving: false,
    isCommunityParticipantRetentionRunning: false,
    lastCommunityParticipantRetentionRun: null,
    loadCommunityParticipantRetention: noop,
    saveCommunityParticipantRetention: noop,
    runCommunityParticipantRetention: noop,
    ndaSweepInterval: null,
    isNdaSweepIntervalLoading: false,
    isNdaSweepIntervalSaving: false,
    loadNdaSweepInterval: noop,
    saveNdaSweepInterval: noop,
    ndaSweepSummaryFrequency: null,
    isNdaSweepSummaryFrequencyLoading: false,
    isNdaSweepSummaryFrequencySaving: false,
    loadNdaSweepSummaryFrequency: noop,
    saveNdaSweepSummaryFrequency: noop,
    ndaIntegritySweep: null,
    ndaSweepStaleGrace: null,
    isNdaSweepStaleGraceLoading: false,
    isNdaSweepStaleGraceSaving: false,
    loadNdaSweepStaleGrace: noop,
    saveNdaSweepStaleGrace: noop,
    emailFailureAlertCooldown: null,
    isEmailFailureAlertCooldownLoading: false,
    isEmailFailureAlertCooldownSaving: false,
    loadEmailFailureAlertCooldown: noop,
    saveEmailFailureAlertCooldown: noop,
    tamperAlertEmail: null,
    isTamperAlertEmailLoading: false,
    isTamperAlertEmailSaving: false,
    isTamperAlertEmailTesting: false,
    loadTamperAlertEmail: noop,
    saveTamperAlertEmail: noop,
    sendTamperAlertEmailTest: noop,
    documentUploadAlertEmail: null,
    isDocumentUploadAlertEmailLoading: false,
    isDocumentUploadAlertEmailSaving: false,
    isDocumentUploadAlertEmailTesting: false,
    loadDocumentUploadAlertEmail: noop,
    saveDocumentUploadAlertEmail: noop,
    sendDocumentUploadAlertEmailTest: noop,
    docUploadAlertCooldown: null,
    isDocUploadAlertCooldownLoading: false,
    isDocUploadAlertCooldownSaving: false,
    loadDocUploadAlertCooldown: noop,
    saveDocUploadAlertCooldown: noop,
    ndaSweepStaleness: null,
    isNdaSweepStalenessLoading: false,
    loadNdaSweepStaleness: noop,
    toast: vi.fn(),
    ...overrides,
  } as AdminDashboardContextValue;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function renderSettingsTab(
  contextOverrides: Partial<AdminDashboardContextValue> = {},
) {
  const ctx = makeContextValue(contextOverrides);
  return render(
    <AdminDashboardContext.Provider value={ctx}>
      <SettingsTab />
    </AdminDashboardContext.Provider>,
  );
}

/**
 * Mocks the two endpoints SettingsTab fetches on mount
 * (security-flags + password-override-status). Every other URL gets a
 * benign non-ok response so internal hooks don't throw.
 */
function mockSecurityFlags(adminUsernameTrivial: boolean) {
  (global.fetch as Mock).mockImplementation((url: string) => {
    if (url.includes("/api/admin/security-flags")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          weakAdminPasswordAllowed: false,
          weakAdminUsernameAllowed: false,
          weakSessionSecretAllowed: false,
          isProduction: false,
          adminUsernameTrivial,
          weakPassword: false,
          adminPasswordStrength: "Strong",
        }),
      });
    }
    if (url.includes("/api/admin/password-override-status")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ active: false, changedAt: null }),
      });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.setItem("adminToken", "tok-test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("SettingsTab — username-strength badge integration (real component)", () => {
  it("shows badge-username-strength-trivial when security-flags returns adminUsernameTrivial: true", async () => {
    mockSecurityFlags(true);

    await act(async () => {
      renderSettingsTab();
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("badge-username-strength-trivial"),
      ).not.toBeNull();
    });

    expect(screen.queryByTestId("badge-username-strength-ok")).toBeNull();
  });

  it("shows badge-username-strength-ok when security-flags returns adminUsernameTrivial: false", async () => {
    mockSecurityFlags(false);

    await act(async () => {
      renderSettingsTab();
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("badge-username-strength-ok"),
      ).not.toBeNull();
    });

    expect(screen.queryByTestId("badge-username-strength-trivial")).toBeNull();
  });
});
