/**
 * Shared mock implementations for DashboardView test suites.
 *
 * Each test file keeps its own vi.mock() call-sites (required by Vitest's
 * hoisting) but imports the factory objects from here via async factories:
 *
 *   vi.mock("framer-motion", async () =>
 *     (await import("./__tests__/dashboardMocks")).framerMotionMock,
 *   );
 *
 * Adding a new DashboardView dependency requires updating only this file.
 * All export shapes are typed inline so TypeScript keeps them honest.
 */

import React from "react";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// framer-motion
// Renders animated elements as plain HTML in jsdom; strips animation props
// so they don't leak into the DOM and trigger unknown-prop warnings.
// ---------------------------------------------------------------------------
function makePassthrough(tag: string) {
  const C = ({ children, ...rest }: Record<string, unknown>) => {
    const clean = Object.fromEntries(
      Object.entries(rest).filter(
        ([k]) =>
          !k.startsWith("animate") &&
          !k.startsWith("initial") &&
          !k.startsWith("exit") &&
          !k.startsWith("whileHover") &&
          !k.startsWith("transition") &&
          k !== "variants",
      ),
    );
    return React.createElement(tag as any, clean as any, children as any);
  };
  C.displayName = `motion.${tag}`;
  return C;
}

export const framerMotionMock = {
  motion: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => makePassthrough(prop),
  }),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useReducedMotion: () => false,
};

// ---------------------------------------------------------------------------
// react-i18next
// t() returns defaultValue when provided, otherwise returns the key verbatim.
// ---------------------------------------------------------------------------
export const reactI18nextMock = {
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts === "object" && "defaultValue" in opts
        ? (opts.defaultValue as string)
        : key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  initReactI18next: { type: "3rdParty", init: () => {} },
};

// ---------------------------------------------------------------------------
// @/i18n/useLocale
// ---------------------------------------------------------------------------
export const useLocaleMock = {
  useLocale: () => ({ locale: { code: "en" }, setLocale: () => {} }),
};

// ---------------------------------------------------------------------------
// @/i18n
// ---------------------------------------------------------------------------
export const i18nMock = {
  SUPPORTED_LOCALES: [{ code: "en", label: "English", nativeLabel: "English" }],
};

// ---------------------------------------------------------------------------
// wouter — includes both Link and useLocation so both test files can use this.
// ---------------------------------------------------------------------------
export const wouterMock = {
  Link: ({ children, href, ...rest }: { children?: React.ReactNode; href?: string; [k: string]: unknown }) =>
    React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/portal", vi.fn()] as const,
};

// ---------------------------------------------------------------------------
// @/hooks/use-toast
// ---------------------------------------------------------------------------
export const useToastMock = {
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
};

// ---------------------------------------------------------------------------
// @/hooks/use-chat-autoscroll
// ---------------------------------------------------------------------------
export const useChatAutoScrollMock = {
  useChatAutoScroll: () => ({ onScroll: vi.fn() }),
};

// ---------------------------------------------------------------------------
// @/lib/portalSession — superset of both test files' usages.
// ---------------------------------------------------------------------------
export const portalSessionMock = {
  getPortalToken: vi.fn(() => "test-portal-token"),
  setPortalToken: vi.fn(),
  clearPortalToken: vi.fn(),
  getPortalSessionExpiresAt: vi.fn(() => null),
};

// ---------------------------------------------------------------------------
// @/lib/stageHistory
// ---------------------------------------------------------------------------
export const stageHistoryMock = {
  recordStageObservation: vi.fn(() => ({ previousStage: null, isNew: false })),
  hasSeenStageBanner: vi.fn(() => false),
  markStageBannerSeen: vi.fn(),
};

// ---------------------------------------------------------------------------
// @/lib/payoutWalletHistory
// ---------------------------------------------------------------------------
export const payoutWalletHistoryMock = {
  recordPayoutWalletObservation: vi.fn(() => ({ isNew: false })),
  hasSeenPayoutWalletBanner: vi.fn(() => false),
  markPayoutWalletBannerSeen: vi.fn(),
};

// ---------------------------------------------------------------------------
// @/lib/stampDutyHistory
// ---------------------------------------------------------------------------
export const stampDutyHistoryMock = {
  recordStampDutyObservation: vi.fn(() => ({ isNew: false })),
  hasSeenStampDutyBanner: vi.fn(() => false),
  markStampDutyBannerSeen: vi.fn(),
};

// ---------------------------------------------------------------------------
// @/lib/withdrawalActivationHistory
// ---------------------------------------------------------------------------
export const withdrawalActivationHistoryMock = {
  recordActivationObservation: vi.fn(() => ({ previous: null, isNew: false })),
  hasSeenActivationBanner: vi.fn(() => false),
  markActivationBannerSeen: vi.fn(),
};

// ---------------------------------------------------------------------------
// @/lib/withdrawalRequestHistory — superset of both test files' return shapes.
// ---------------------------------------------------------------------------
export const withdrawalRequestHistoryMock = {
  recordWithdrawalRequestObservation: vi.fn(() => ({
    previousStatus: null,
    isNew: false,
  })),
  hasSeenWithdrawalRequestBanner: vi.fn(() => false),
  markWithdrawalRequestBannerSeen: vi.fn(),
};

// ---------------------------------------------------------------------------
// @shared/stageInstructions
// ---------------------------------------------------------------------------
const stubInstruction = {
  stage: 1,
  icon: "⚙️",
  title: "Compliance Review",
  summary: "Your case is under compliance review.",
  detailedExplanation: "A compliance officer is reviewing your case.",
  whyItMatters: "Regulatory requirement.",
  regulatoryBasis: [] as string[],
  whatToDo: [] as string[],
  whatToExpect: "Review within 3 business days.",
};

export const stageInstructionsMock = {
  getStageInstruction: vi.fn(() => stubInstruction),
  getStageInstructionLocalized: vi.fn(() => stubInstruction),
  getRecommendedDocumentsForStage: vi.fn(() => []),
  DOCUMENT_CATEGORY_LABELS: {},
};

// ---------------------------------------------------------------------------
// @shared/tokenDeposit
// ---------------------------------------------------------------------------
export const tokenDepositMock = {
  formatTokenDepositRequired: vi.fn(() => null),
};

// ---------------------------------------------------------------------------
// @/i18n/format
// ---------------------------------------------------------------------------
export const i18nFormatMock = {
  useFormat: () => ({
    formatDate: vi.fn((d: unknown) => String(d)),
    formatDateTime: vi.fn((d: unknown) => String(d)),
    formatRelative: vi.fn((d: unknown) => String(d)),
    formatNumber: vi.fn((n: unknown) => String(n)),
    formatCurrency: vi.fn((n: unknown) => String(n)),
  }),
};

// ---------------------------------------------------------------------------
// @tanstack/react-query — superset of both test files' usages.
// ---------------------------------------------------------------------------
export const tanstackQueryMock = {
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
};

// ---------------------------------------------------------------------------
// ../stageCta — complete shape used by DashboardView.
// ---------------------------------------------------------------------------
export const stageCtaMock = {
  getStageCta: vi.fn((_stage: number) => ({
    stage: 1,
    blocker: "system_processing",
    ctaLabelKey: "stageCta.1.label",
    ctaView: "messages",
    shortHeadlineKey: "stageCta.1.headline",
    label: "Continue",
    description: "",
  })),
  getStageTitle: vi.fn(() => "Stage"),
  getStageWhatsNext: vi.fn(() => ""),
  blockerLabel: vi.fn(() => "System Processing"),
  blockerColors: vi.fn(() => ({
    bg: "",
    text: "",
    border: "",
    badgeBg: "bg-slate-700/30",
    badgeText: "text-slate-400",
    ring: "ring-slate-500/20",
    glow: "rgba(100,116,139,0.15)",
    dot: "bg-slate-400",
    stripe: "from-slate-500/10 to-transparent",
  })),
  StageBlocker: {},
};

// ---------------------------------------------------------------------------
// @/components/portal/AccountHistoryCard
// ---------------------------------------------------------------------------
export const accountHistoryCardMock = {
  AccountHistoryCard: () => null,
};

// ---------------------------------------------------------------------------
// @/components/portal/LocalizedAmount
// Uses `value` prop — the prop name used by the real component.
// ---------------------------------------------------------------------------
export const localizedAmountMock = {
  LocalizedAmount: ({ value }: { value?: unknown }) =>
    React.createElement("span", null, String(value ?? "")),
};

// ---------------------------------------------------------------------------
// shadcn/ui primitives — passthrough wrappers so DashboardView's JSX resolves.
// ---------------------------------------------------------------------------
export const uiButtonMock = {
  Button: ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("button", rest as any, children),
};

export const uiBadgeMock = {
  Badge: ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("span", rest as any, children),
};

export const uiInputMock = {
  Input: (props: Record<string, unknown>) => React.createElement("input", props as any),
};

export const uiTextareaMock = {
  Textarea: (props: Record<string, unknown>) =>
    React.createElement("textarea", props as any),
};

export const uiDialogMock = {
  Dialog: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogDescription: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
};

// ---------------------------------------------------------------------------
// Base portal context stub — common fields shared by all DashboardView tests.
// Individual tests merge their own case shape on top of this.
// ---------------------------------------------------------------------------
export const basePortalContextFields = {
  adminMessages: [] as unknown[],
  submissions: [] as unknown[],
  depositReceipts: [] as unknown[],
  chatMessages: [] as unknown[],
  unreadCount: 0,
  unreadAdminMessages: 0,
  isChatOpen: false,
  setIsChatOpen: vi.fn(),
  sendMessage: vi.fn(async () => {}),
  setViewState: vi.fn(),
  hasUrgentMessages: false,
  keyRequestNotification: null,
  dismissKeyRequestNotification: vi.fn(),
  loadAllData: vi.fn(async () => {}),
  declaration: null,
  documentRequests: [] as unknown[],
  refreshDeclaration: vi.fn(),
};

// ---------------------------------------------------------------------------
// Base case fixture — shared minimal case shape for DashboardView tests.
// ---------------------------------------------------------------------------
export const baseCaseFixture = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "test@example.com",
  status: "active" as const,
  withdrawalStage: null,
  letterSent: false,
  isRegulated: false,
  vipStatus: null,
  sealedAt: null,
  declarationStatus: "not_requested",
  withdrawalGuideVisible: false,
};
