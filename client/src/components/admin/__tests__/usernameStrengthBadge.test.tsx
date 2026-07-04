// @vitest-environment jsdom
//
// Task #659 — Username-strength badge: appearance and colour
//
// SettingsTab fetches GET /api/admin/security-flags on mount and uses the
// `adminUsernameTrivial` boolean from the response to drive which badge is
// shown on the Change Username card in the 'main' settings grid:
//
//   true  → <Badge data-testid="badge-username-strength-trivial"> (red)
//   false → <Badge data-testid="badge-username-strength-ok">      (teal)
//   null  → fallback "Security" badge (no testid — loading / fetch failed)
//
// Tests mount the real SettingsTab component behind a mock
// AdminDashboardContext provider (settingsView: 'main') so the card grid
// with the Change Username card is rendered. fetch is mocked globally so
// the security-flags endpoint can return different flag values per test.

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

// ── minimal context mock ────────────────────────────────────────────────────
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
    // Auth
    authToken: "tok-test",

    // Cases / submissions
    cases: [],
    filteredCases: [],
    allSubmissions: [],
    isDataLoading: false,
    loadData: noop,
    clearLogs: noop,
    setIsCreateOpen: noop,

    // Search / filter
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

    // Top-level tab
    activeTab: "settings",
    setActiveTab: noop,

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

    // Declarations
    requestDeclaration: noop,
    regenerateDeclarationAccessCode: noop,
    clearDeclarationRequest: noop,
    openDeclarationDialog: noop,

    // Letter reissue
    openReissueLetterDialog: noop,
    clearLetterReissue: noop,

    // Account
    openEditAccountDialog: noop,
    openUserMirror: noop,

    // NDA
    openSignedNdaDialog: noop,
    openPreviewNdaDialog: noop,

    // Force logout
    forceLogoutUser: noop,

    // Chat scroll
    handleChatScroll: noop,

    // Toggle access
    toggleUserAccess: noop,

    // Submissions tab
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
    chatScrollRef: createRef(),

    // Settings - common
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
    revokeAdminSession: noop,
    revokeOtherAdminSessions: noop,

    // Settings - Failed logins
    failedLogins: [],
    failedLoginCount24h: 0,
    loadFailedLogins: noop,
    failedLoginsByIp: [],
    failedLoginsByIpWindowHours: 24,
    loadFailedLoginsByIp: noop,

    // Settings - Declaration reads
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

    // Settings - Admin users / sessions
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

    // Settings - Audit-log retention
    auditRetention: null,
    isAuditRetentionLoading: false,
    isAuditRetentionSaving: false,
    loadAuditRetention: noop,
    saveAuditRetention: noop,

    // Settings - Community participant retention
    communityParticipantRetention: null,
    isCommunityParticipantRetentionLoading: false,
    isCommunityParticipantRetentionSaving: false,
    isCommunityParticipantRetentionRunning: false,
    lastCommunityParticipantRetentionRun: null,
    loadCommunityParticipantRetention: noop,
    saveCommunityParticipantRetention: noop,
    runCommunityParticipantRetention: noop,

    // Settings - NDA sweep interval
    ndaSweepInterval: null,
    isNdaSweepIntervalLoading: false,
    isNdaSweepIntervalSaving: false,
    loadNdaSweepInterval: noop,
    saveNdaSweepInterval: noop,

    // Settings - NDA sweep summary frequency
    ndaSweepSummaryFrequency: null,
    isNdaSweepSummaryFrequencyLoading: false,
    isNdaSweepSummaryFrequencySaving: false,
    loadNdaSweepSummaryFrequency: noop,
    saveNdaSweepSummaryFrequency: noop,

    // Settings - NDA integrity sweep latest result
    ndaIntegritySweep: null,

    // Settings - NDA stale grace window
    ndaSweepStaleGrace: null,
    isNdaSweepStaleGraceLoading: false,
    isNdaSweepStaleGraceSaving: false,
    loadNdaSweepStaleGrace: noop,
    saveNdaSweepStaleGrace: noop,

    // Settings - Email failure alert cooldown
    emailFailureAlertCooldown: null,
    isEmailFailureAlertCooldownLoading: false,
    isEmailFailureAlertCooldownSaving: false,
    loadEmailFailureAlertCooldown: noop,
    saveEmailFailureAlertCooldown: noop,

    // Settings - Tamper alert email
    tamperAlertEmail: null,
    isTamperAlertEmailLoading: false,
    isTamperAlertEmailSaving: false,
    isTamperAlertEmailTesting: false,
    loadTamperAlertEmail: noop,
    saveTamperAlertEmail: noop,
    sendTamperAlertEmailTest: noop,

    // Settings - Document upload alert email
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

    // Settings - NDA sweep staleness
    ndaSweepStaleness: null,
    isNdaSweepStalenessLoading: false,
    loadNdaSweepStaleness: noop,

    // Toast
    toast: vi.fn(),

    ...overrides,
  } as AdminDashboardContextValue;
}

// ── helpers ────────────────────────────────────────────────────────────────

function renderSettingsTab(contextOverrides: Partial<AdminDashboardContextValue> = {}) {
  const ctx = makeContextValue(contextOverrides);
  return render(
    <AdminDashboardContext.Provider value={ctx}>
      <SettingsTab />
    </AdminDashboardContext.Provider>,
  );
}

/**
 * Installs a global fetch mock that responds to the two endpoints SettingsTab
 * calls on mount (password-override-status + security-flags) and returns a
 * catch-all non-ok response for everything else so internal hooks don't throw.
 */
function mockFetchForSecurityFlags(adminUsernameTrivial: boolean) {
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
        }),
      });
    }
    if (url.includes("/api/admin/password-override-status")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ active: false, changedAt: null }),
      });
    }
    // All other internal fetches (blocked-IPs, declaration-read drilldown,
    // etc.) get a benign non-ok response so they silently bail out.
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

// ── setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.setItem("adminToken", "tok-test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  sessionStorage.clear();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("Username-strength badge — badge-username-strength-trivial", () => {
  it("shows the trivial badge when security-flags returns adminUsernameTrivial: true", async () => {
    mockFetchForSecurityFlags(true);

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

  it("trivial badge carries the expected red colour class", async () => {
    mockFetchForSecurityFlags(true);

    await act(async () => {
      renderSettingsTab();
    });

    const badge = await screen.findByTestId("badge-username-strength-trivial");
    expect(badge.className).toContain("text-red-300");
  });

  it("trivial badge displays 'Trivial — change now'", async () => {
    mockFetchForSecurityFlags(true);

    await act(async () => {
      renderSettingsTab();
    });

    const badge = await screen.findByTestId("badge-username-strength-trivial");
    expect(badge.textContent).toContain("Trivial — change now");
  });
});

describe("Username-strength badge — badge-username-strength-ok", () => {
  it("shows the OK badge when security-flags returns adminUsernameTrivial: false", async () => {
    mockFetchForSecurityFlags(false);

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

  it("OK badge carries the expected teal colour class", async () => {
    mockFetchForSecurityFlags(false);

    await act(async () => {
      renderSettingsTab();
    });

    const badge = await screen.findByTestId("badge-username-strength-ok");
    expect(badge.className).toContain("text-teal-300");
  });

  it("OK badge displays 'OK'", async () => {
    mockFetchForSecurityFlags(false);

    await act(async () => {
      renderSettingsTab();
    });

    const badge = await screen.findByTestId("badge-username-strength-ok");
    expect(badge.textContent).toBe("OK");
  });
});

describe("Username-strength badge — loading skeleton while fetch is in flight", () => {
  it("shows the loading skeleton before the security-flags fetch resolves", async () => {
    // fetch never resolves — simulates a slow network response
    (global.fetch as Mock).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      renderSettingsTab();
    });

    expect(
      screen.queryByTestId("badge-username-strength-loading"),
    ).not.toBeNull();
    expect(screen.queryByTestId("badge-username-strength-trivial")).toBeNull();
    expect(screen.queryByTestId("badge-username-strength-ok")).toBeNull();
  });

  it("loading skeleton has the expected aria-label", async () => {
    (global.fetch as Mock).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      renderSettingsTab();
    });

    const skeleton = screen.queryByTestId("badge-username-strength-loading");
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute("aria-label")).toBe(
      "Loading username strength\u2026",
    );
  });

  it("loading skeleton is replaced by the OK badge once fetch resolves", async () => {
    mockFetchForSecurityFlags(false);

    await act(async () => {
      renderSettingsTab();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("badge-username-strength-ok")).not.toBeNull();
    });

    expect(
      screen.queryByTestId("badge-username-strength-loading"),
    ).toBeNull();
  });
});

describe("Username-strength badge — no badge before fetch resolves", () => {
  it("shows no strength badge when fetch rejects (network error)", async () => {
    (global.fetch as Mock).mockRejectedValue(new Error("network error"));

    await act(async () => {
      renderSettingsTab();
    });

    expect(
      screen.queryByTestId("badge-username-strength-trivial"),
    ).toBeNull();
    expect(screen.queryByTestId("badge-username-strength-ok")).toBeNull();
  });

  it("shows no strength badge when security-flags omits adminUsernameTrivial", async () => {
    (global.fetch as Mock).mockImplementation((url: string) => {
      if (url.includes("/api/admin/security-flags")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            weakAdminPasswordAllowed: false,
            weakAdminUsernameAllowed: false,
            // adminUsernameTrivial intentionally absent
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    await act(async () => {
      renderSettingsTab();
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("badge-username-strength-trivial"),
      ).toBeNull();
      expect(screen.queryByTestId("badge-username-strength-ok")).toBeNull();
    });
  });
});
