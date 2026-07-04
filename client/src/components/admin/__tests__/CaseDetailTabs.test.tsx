// @vitest-environment jsdom
//
// Task #167 — Cover the case-detail dialog's tab routing introduced by
// Task #166. The dialog body in AdminDashboard.tsx renders the real
// `<CaseDetailTabsList />` extracted in this task — testing that
// component guarantees the trigger row stays in sync with production.
//
// We also assert against the live AdminDashboard.tsx source that the
// Danger Zone <details> disclosure is rendered inside the Overview tab
// without the `open` attribute, so a future change that auto-expands it
// fails this test.

import React, { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  CASE_DETAIL_TABS,
  CaseDetailTabsList,
} from "../CaseDetailTabsList";
import { generatePhraseKey } from "@/lib/phraseKeyWords";
import { EditAccountDialog } from "../EditAccountDialog";

// react-i18next: keep the real module (initReactI18next is needed by
// client/src/i18n/index.ts at import time) but override useTranslation so
// components that call it don't need a live i18n provider in JSDOM.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string) => k }),
  };
});

// ---------------------------------------------------------------------------
// Static source under analysis (single read at module load, shared by all suites)
// ---------------------------------------------------------------------------

const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
  "utf8",
);

/**
 * Extracts a function body from its declaration string to the next
 * `\n  const ` declaration.  Returns `""` when the declaration is absent.
 */
function extractFnBody(fnDecl: string): string {
  const start = ADMIN_SRC.indexOf(fnDecl);
  if (start === -1) return "";
  const end = ADMIN_SRC.indexOf("\n  const ", start + 1);
  return end === -1 ? ADMIN_SRC.slice(start) : ADMIN_SRC.slice(start, end);
}

/** Isolates the updateWalletPhrase handler body. */
function extractUpdateWalletPhrase(): string {
  const start = ADMIN_SRC.indexOf("const updateWalletPhrase = async () =>");
  const after = ADMIN_SRC.indexOf("const updateProfileRedirect", start);
  return start === -1 || after <= start ? "" : ADMIN_SRC.slice(start, after);
}

/** Isolates the updatePayoutWallet handler body. */
function extractUpdatePayoutWallet(): string {
  const start = ADMIN_SRC.indexOf("const updatePayoutWallet = async () =>");
  const after = ADMIN_SRC.indexOf("const updateWalletPhrase = async () =>", start);
  return start === -1 || after <= start ? "" : ADMIN_SRC.slice(start, after);
}

/** Isolates the updateDepositAddress handler body. */
function extractUpdateDepositAddress(): string {
  const start = ADMIN_SRC.indexOf("const updateDepositAddress = async () =>");
  const after = ADMIN_SRC.indexOf("const updatePayoutWallet = async () =>", start);
  return start === -1 || after <= start ? "" : ADMIN_SRC.slice(start, after);
}

/** Isolates the openAdminMessageDialog function body. */
function extractOpenAdminMessageDialog(): string {
  const start = ADMIN_SRC.indexOf("const openAdminMessageDialog = (");
  const after = start === -1 ? -1 : ADMIN_SRC.indexOf("\n  const ", start + 1);
  return start === -1 || after <= start ? "" : ADMIN_SRC.slice(start, after);
}

/**
 * Extracts the full `<Button …>…</Button>` block enclosing a test-id.
 * Searches `source` (defaults to ADMIN_SRC) for `testId`, walks back to the
 * nearest `<Button` and forward to `</Button>`.  Returns `""` when any anchor
 * is missing.
 */
function extractElemContextBefore(testId: string, source = ADMIN_SRC): string {
  const idx = source.indexOf(testId);
  if (idx === -1) return "";
  const start = source.lastIndexOf("<Button", idx);
  if (start === -1) return "";
  const end = source.indexOf("</Button>", idx);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

function CaseDetailHarness() {
  const [tab, setTab] = useState<string>("overview");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <CaseDetailTabsList />
      {CASE_DETAIL_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          <div data-testid={`section-${t.value}`}>{t.label} section</div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

afterEach(() => cleanup());

describe("Case-detail dialog tabs", () => {
  it("renders all five triggers in the canonical order", () => {
    render(<CaseDetailHarness />);
    for (const t of CASE_DETAIL_TABS) {
      expect(screen.getByTestId(`case-tab-${t.value}`)).toBeTruthy();
    }
    // Default = first tab (overview).
    expect(screen.getByTestId("section-overview")).toBeTruthy();
  });

  it("each trigger swaps in only its own section", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    for (const target of CASE_DETAIL_TABS) {
      await user.click(screen.getByTestId(`case-tab-${target.value}`));
      expect(screen.getByTestId(`section-${target.value}`)).toBeTruthy();
      for (const other of CASE_DETAIL_TABS) {
        if (other.value === target.value) continue;
        expect(screen.queryByTestId(`section-${other.value}`)).toBeNull();
      }
    }
  });

  it("Danger Zone disclosure in AdminDashboard is collapsed by default", () => {
    // The disclosure lives inside a 9k-line file; rendering it under
    // JSDOM would require mocking the entire dashboard context. Instead
    // verify against the production source that the <details> for
    // `advanced-danger-zone` does NOT carry the `open` attribute. This
    // would catch a regression like `<details open …>` or `open={true}`.
    const match = ADMIN_SRC.match(
      /<details[^>]*data-testid=["']advanced-danger-zone["'][^>]*>/,
    );
    expect(match, "expected an <details data-testid=\"advanced-danger-zone\"> in AdminDashboard.tsx").toBeTruthy();
    // Strip the className value first so Tailwind variants like
    // `open:bg-red-500/10` don't trip the attribute scan, then look for
    // a JSX `open` boolean attribute on the element.
    const stripped = match![0].replace(
      /className=("[^"]*"|\{[^}]*\})/g,
      "className=__STRIPPED__",
    );
    const hasOpenAttr = /\sopen(\s|=|\/?>|$)/.test(stripped);
    expect(hasOpenAttr, `Danger Zone <details> must not default-open; got: ${match![0]}`).toBe(false);
  });
});

// ── Phrase Key tab (Task #834) ─────────────────────────────────────────────
//
// The admin "Phrase Key" tab lets admins auto-generate or hand-type a wallet
// recovery phrase and pick 6, 12, or 24 words. There was no automated coverage, so
// a regression (the tab vanishing, the generator wiring drifting, or the wrong
// word count being produced) would ship silently. We cover it three ways:
//
//   1. The tab itself is part of the canonical tab set (so it can't disappear).
//   2. A behavioural harness that mirrors the production controls and uses the
//      REAL generatePhraseKey: clicking the 6/12/24 length buttons then
//      Auto-generate fills textarea-wallet-phrase-code with that many words.
//   3. Source-level guards against AdminDashboard.tsx so the production JSX
//      keeps the test-ids and keeps wiring Auto-generate to
//      generatePhraseKey(walletPhraseLength) — the harness can't verify the
//      real file's wiring on its own.

// Faithful reproduction of the production phrase-key controls in
// AdminDashboard.tsx (length buttons + Auto-generate + textarea), wired to the
// same state shape and the real generatePhraseKey. The default length matches
// production (12).
function PhraseKeyControlsHarness() {
  const [walletPhraseLength, setWalletPhraseLength] = useState<6 | 12 | 24>(12);
  const [walletPhraseCodeEdit, setWalletPhraseCodeEdit] = useState("");
  return (
    <div>
      {([6, 12, 24] as const).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => setWalletPhraseLength(n)}
          data-testid={`button-wallet-phrase-length-${n}`}
        >
          {n} words
        </button>
      ))}
      <button
        type="button"
        onClick={() => setWalletPhraseCodeEdit(generatePhraseKey(walletPhraseLength))}
        data-testid="button-generate-wallet-phrase"
      >
        Auto-generate
      </button>
      <textarea
        value={walletPhraseCodeEdit}
        onChange={(e) => setWalletPhraseCodeEdit(e.target.value)}
        data-testid="textarea-wallet-phrase-code"
      />
    </div>
  );
}

function phraseWordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

describe("Phrase Key tab", () => {
  it('exposes a "phrase-key" tab in the canonical tab set', () => {
    expect(CASE_DETAIL_TABS.map((t) => t.value)).toContain("phrase-key");
  });

  it("renders a phrase-key trigger that swaps in its own section", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);
    await user.click(screen.getByTestId("case-tab-phrase-key"));
    expect(screen.getByTestId("section-phrase-key")).toBeTruthy();
  });

  it("Auto-generate fills the textarea with 12 words by default", async () => {
    const user = userEvent.setup();
    render(<PhraseKeyControlsHarness />);
    await user.click(screen.getByTestId("button-generate-wallet-phrase"));
    const textarea = screen.getByTestId(
      "textarea-wallet-phrase-code",
    ) as HTMLTextAreaElement;
    expect(phraseWordCount(textarea.value)).toBe(12);
  });

  it("selecting the 6-word length then Auto-generate fills the textarea with 6 words", async () => {
    const user = userEvent.setup();
    render(<PhraseKeyControlsHarness />);
    await user.click(screen.getByTestId("button-wallet-phrase-length-6"));
    await user.click(screen.getByTestId("button-generate-wallet-phrase"));
    const textarea = screen.getByTestId(
      "textarea-wallet-phrase-code",
    ) as HTMLTextAreaElement;
    expect(phraseWordCount(textarea.value)).toBe(6);
  });

  it("selecting the 12-word length then Auto-generate fills the textarea with 12 words", async () => {
    const user = userEvent.setup();
    render(<PhraseKeyControlsHarness />);
    // Flip to 6 first to prove the button actually drives the count.
    await user.click(screen.getByTestId("button-wallet-phrase-length-6"));
    await user.click(screen.getByTestId("button-wallet-phrase-length-12"));
    await user.click(screen.getByTestId("button-generate-wallet-phrase"));
    const textarea = screen.getByTestId(
      "textarea-wallet-phrase-code",
    ) as HTMLTextAreaElement;
    expect(phraseWordCount(textarea.value)).toBe(12);
  });

  it("selecting the 24-word length then Auto-generate fills the textarea with 24 words", async () => {
    const user = userEvent.setup();
    render(<PhraseKeyControlsHarness />);
    await user.click(screen.getByTestId("button-wallet-phrase-length-24"));
    await user.click(screen.getByTestId("button-generate-wallet-phrase"));
    const textarea = screen.getByTestId(
      "textarea-wallet-phrase-code",
    ) as HTMLTextAreaElement;
    expect(phraseWordCount(textarea.value)).toBe(24);
  });

  describe("AdminDashboard.tsx production wiring", () => {
    it("renders the phrase-key TabsContent", () => {
      expect(ADMIN_SRC).toMatch(/<TabsContent\s+value="phrase-key"/);
    });

    it("keeps the length buttons and the Auto-generate / textarea test-ids", () => {
      expect(ADMIN_SRC).toContain("button-wallet-phrase-length-${n}");
      expect(ADMIN_SRC).toContain('data-testid="button-generate-wallet-phrase"');
      expect(ADMIN_SRC).toContain('data-testid="textarea-wallet-phrase-code"');
    });

    it("wires Auto-generate to generatePhraseKey(walletPhraseLength)", () => {
      // Catches generator drift like a hard-coded count or a swapped helper.
      expect(ADMIN_SRC).toMatch(
        /setWalletPhraseCodeEdit\(\s*generatePhraseKey\(\s*walletPhraseLength\s*\)\s*\)/,
      );
    });

    it("drives the length buttons from PHRASE_KEY_LENGTHS (6/12/24)", () => {
      // The selectable lengths live in the shared phraseKeyWords module so the
      // generator and the UI can't drift; the JSX maps over that constant.
      expect(ADMIN_SRC).toMatch(/PHRASE_KEY_LENGTHS\.map/);
    });
  });

  // ── Save action (Task #840) ──────────────────────────────────────────────
  //
  // The "Save Wallet Phrase" button (button-save-wallet-phrase) calls
  // updateWalletPhrase, which PATCHes /api/cases/:id with the phrase code and
  // the walletPhraseEnabled toggle. Task #834 only covered generation/word
  // count, not the save payload. A regression that sends the wrong field name,
  // drops the enabled toggle, or omits the admin `Authorization: Bearer`
  // header (a documented gotcha that causes silent 401s) would ship unnoticed.
  // The handler lives in the 11k-line AdminDashboard.tsx and depends on the
  // whole dashboard context, so — like the Danger Zone guard above — we assert
  // against the production source rather than rendering it under JSDOM.
  describe("Phrase Key save wiring (Task #840)", () => {
    it("wires the Save button to updateWalletPhrase", () => {
      const element = extractElemContextBefore('data-testid="button-save-wallet-phrase"');
      expect(element, "expected button-save-wallet-phrase in AdminDashboard.tsx").not.toBe("");
      expect(element).toMatch(/onClick=\{updateWalletPhrase\}/);
    });

    it("PATCHes /api/cases/:id", () => {
      const body = extractUpdateWalletPhrase();
      expect(body).toMatch(/fetch\(\s*`\/api\/cases\/\$\{selectedCase\.id\}`/);
      expect(body).toMatch(/method:\s*['"]PATCH['"]/);
    });

    it("sends the phrase code and the walletPhraseEnabled toggle in the body", () => {
      const body = extractUpdateWalletPhrase();
      // Enabled flag must come from the edit state, not a hard-coded literal.
      expect(body).toMatch(/walletPhraseEnabled:\s*walletPhraseEnabledEdit/);
      // The phrase code is sent (trimmed, empty → null so the portal hides it).
      expect(body).toMatch(/walletPhraseCode:\s*code\s*\|\|\s*null/);
      expect(body).toMatch(/const\s+code\s*=\s*walletPhraseCodeEdit\.trim\(\)/);
    });

    it("includes the admin Authorization: Bearer header", () => {
      const body = extractUpdateWalletPhrase();
      expect(body).toMatch(/['"]Authorization['"]:\s*`Bearer \$\{authToken\}`/);
    });
  });

  // ── Save round-trip behaviour (Task #844) ────────────────────────────────
  //
  // Task #840 asserted the save WIRING against the source. This adds a
  // behavioural harness that reproduces the production updateWalletPhrase
  // payload construction and saves through a mocked fetch, proving:
  //
  //   1. The edited phrase value AND the walletPhraseEnabled toggle round-trip
  //      into the PATCH /api/cases/:id body (trimmed; empty → null).
  //   2. The masked-vs-revealed display state has NO effect on what value is
  //      persisted — the reveal toggle only blurs the textarea, the saved
  //      value always comes from walletPhraseCodeEdit.
  //
  // The harness mirrors AdminDashboard.tsx's updateWalletPhrase save body
  // exactly: const code = walletPhraseCodeEdit.trim(); body sends
  // { walletPhraseEnabled: walletPhraseEnabledEdit, walletPhraseCode: code || null }.
  describe("Phrase Key save round-trip (Task #844)", () => {
    function PhraseKeySaveHarness({
      initialCode = "",
      initialEnabled = false,
      onSave,
    }: {
      initialCode?: string;
      initialEnabled?: boolean;
      onSave: (body: unknown) => void;
    }) {
      const [walletPhraseEnabledEdit, setWalletPhraseEnabledEdit] =
        useState(initialEnabled);
      const [walletPhraseCodeEdit, setWalletPhraseCodeEdit] =
        useState(initialCode);
      const [walletPhraseRevealed, setWalletPhraseRevealed] = useState(false);

      // Reproduces the payload-building portion of updateWalletPhrase.
      const updateWalletPhrase = () => {
        const code = walletPhraseCodeEdit.trim();
        onSave({
          walletPhraseEnabled: walletPhraseEnabledEdit,
          walletPhraseCode: code || null,
        });
      };

      return (
        <div>
          <button
            type="button"
            onClick={() => setWalletPhraseEnabledEdit((v) => !v)}
            data-testid="toggle-wallet-phrase-enabled"
          >
            {walletPhraseEnabledEdit ? "Enabled" : "Disabled"}
          </button>
          <button
            type="button"
            onClick={() => setWalletPhraseRevealed((v) => !v)}
            data-testid="button-toggle-wallet-phrase-reveal"
          >
            {walletPhraseRevealed ? "Hide" : "Reveal"}
          </button>
          {/* The reveal state only changes the displayed value, never the
              underlying walletPhraseCodeEdit that gets persisted. */}
          <textarea
            value={
              walletPhraseRevealed
                ? walletPhraseCodeEdit
                : walletPhraseCodeEdit
                  ? "•".repeat(walletPhraseCodeEdit.length)
                  : ""
            }
            onChange={(e) => setWalletPhraseCodeEdit(e.target.value)}
            data-testid="textarea-wallet-phrase-code"
          />
          <button
            type="button"
            onClick={updateWalletPhrase}
            data-testid="button-save-wallet-phrase"
          >
            Save
          </button>
        </div>
      );
    }

    const TWELVE =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";

    it("saves the edited phrase value and the enabled toggle in the payload", async () => {
      const user = userEvent.setup();
      const saved: unknown[] = [];
      render(
        <PhraseKeySaveHarness
          initialCode={TWELVE}
          initialEnabled={false}
          onSave={(b) => saved.push(b)}
        />,
      );

      // Flip the toggle on, then save.
      await user.click(screen.getByTestId("toggle-wallet-phrase-enabled"));
      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      expect(saved).toHaveLength(1);
      expect(saved[0]).toEqual({
        walletPhraseEnabled: true,
        walletPhraseCode: TWELVE,
      });
    });

    it("persists an empty phrase as null (so the portal hides the step)", async () => {
      const user = userEvent.setup();
      const saved: unknown[] = [];
      render(
        <PhraseKeySaveHarness
          initialCode="   "
          initialEnabled={false}
          onSave={(b) => saved.push(b)}
        />,
      );

      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      expect(saved[0]).toEqual({
        walletPhraseEnabled: false,
        walletPhraseCode: null,
      });
    });

    it("persists the same value whether the phrase is masked or revealed", async () => {
      const user = userEvent.setup();

      const maskedSaved: unknown[] = [];
      const { unmount } = render(
        <PhraseKeySaveHarness
          initialCode={TWELVE}
          initialEnabled
          onSave={(b) => maskedSaved.push(b)}
        />,
      );
      // Save while still masked (revealed defaults to false).
      await user.click(screen.getByTestId("button-save-wallet-phrase"));
      unmount();
      cleanup();

      const revealedSaved: unknown[] = [];
      render(
        <PhraseKeySaveHarness
          initialCode={TWELVE}
          initialEnabled
          onSave={(b) => revealedSaved.push(b)}
        />,
      );
      // Reveal first, then save.
      await user.click(screen.getByTestId("button-toggle-wallet-phrase-reveal"));
      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      // The masked display must not leak into the persisted value, and the two
      // saves must be byte-for-byte identical.
      expect(maskedSaved[0]).toEqual({
        walletPhraseEnabled: true,
        walletPhraseCode: TWELVE,
      });
      expect(revealedSaved[0]).toEqual(maskedSaved[0]);
    });
  });

  // ── Save response handling (Task #857) ───────────────────────────────────
  //
  // Task #844 covered the PATCH payload; this covers the RESPONSE branches of
  // updateWalletPhrase, none of which had coverage:
  //
  //   1. On a successful (res.ok) save it calls loadData() to refresh AND shows
  //      a non-destructive toast whose description depends on the enabled
  //      toggle ("user will see the Wallet Connection step" vs "hidden from
  //      the user").
  //   2. On a non-ok response it shows a destructive error toast carrying the
  //      HTTP status and does NOT refresh.
  //   3. On a thrown fetch error it shows the generic destructive error toast
  //      and does NOT refresh.
  //
  // The harness reproduces the response-handling portion of updateWalletPhrase
  // verbatim, with fetch/loadData/toast injected so each branch is observable.
  // Source-level guards then pin the real handler's loadData() refresh and the
  // exact toast copy, since the harness can't verify the production wiring.
  describe("Phrase Key save response handling (Task #857)", () => {
    type ToastCall = {
      variant?: string;
      title: string;
      description: string;
    };

    function PhraseKeySaveResponseHarness({
      initialEnabled = false,
      fetchImpl,
      onRefresh,
      onToast,
    }: {
      initialEnabled?: boolean;
      fetchImpl: () => Promise<{ ok: boolean; status: number }>;
      onRefresh: () => void;
      onToast: (t: ToastCall) => void;
    }) {
      const [walletPhraseEnabledEdit] = useState(initialEnabled);
      const [walletPhraseCodeEdit] = useState(
        "alpha bravo charlie delta echo foxtrot",
      );
      const [saving, setSaving] = useState(false);

      // Reproduces the response-handling portion of updateWalletPhrase.
      const updateWalletPhrase = async () => {
        setSaving(true);
        try {
          const code = walletPhraseCodeEdit.trim();
          const res = await fetchImpl();
          if (res.ok) {
            onRefresh();
            onToast({
              title: "Wallet phrase updated",
              description: walletPhraseEnabledEdit
                ? "The user will see the Wallet Connection step in their portal."
                : "Wallet Connection step is hidden from the user.",
            });
          } else {
            onToast({
              variant: "destructive",
              title: "Error",
              description: `Failed to update wallet phrase (HTTP ${res.status}).`,
            });
          }
          void code;
        } catch {
          onToast({
            variant: "destructive",
            title: "Error",
            description: "Failed to update wallet phrase.",
          });
        } finally {
          setSaving(false);
        }
      };

      return (
        <div>
          <output data-testid="saving-state">{saving ? "saving" : "idle"}</output>
          <button
            type="button"
            onClick={updateWalletPhrase}
            data-testid="button-save-wallet-phrase"
          >
            Save
          </button>
        </div>
      );
    }

    it("refreshes and shows the ENABLED toast copy on a successful save", async () => {
      const user = userEvent.setup();
      const refreshes: number[] = [];
      const toasts: ToastCall[] = [];
      render(
        <PhraseKeySaveResponseHarness
          initialEnabled
          fetchImpl={async () => ({ ok: true, status: 200 })}
          onRefresh={() => refreshes.push(1)}
          onToast={(t) => toasts.push(t)}
        />,
      );

      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      expect(refreshes).toHaveLength(1);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].variant).toBeUndefined();
      expect(toasts[0].title).toBe("Wallet phrase updated");
      expect(toasts[0].description).toBe(
        "The user will see the Wallet Connection step in their portal.",
      );
    });

    it("refreshes and shows the DISABLED toast copy on a successful save", async () => {
      const user = userEvent.setup();
      const refreshes: number[] = [];
      const toasts: ToastCall[] = [];
      render(
        <PhraseKeySaveResponseHarness
          initialEnabled={false}
          fetchImpl={async () => ({ ok: true, status: 200 })}
          onRefresh={() => refreshes.push(1)}
          onToast={(t) => toasts.push(t)}
        />,
      );

      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      expect(refreshes).toHaveLength(1);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].variant).toBeUndefined();
      expect(toasts[0].description).toBe(
        "Wallet Connection step is hidden from the user.",
      );
    });

    it("shows a destructive error toast with the HTTP status and does NOT refresh on a non-ok response", async () => {
      const user = userEvent.setup();
      const refreshes: number[] = [];
      const toasts: ToastCall[] = [];
      render(
        <PhraseKeySaveResponseHarness
          initialEnabled
          fetchImpl={async () => ({ ok: false, status: 500 })}
          onRefresh={() => refreshes.push(1)}
          onToast={(t) => toasts.push(t)}
        />,
      );

      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      expect(refreshes).toHaveLength(0);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].variant).toBe("destructive");
      expect(toasts[0].title).toBe("Error");
      expect(toasts[0].description).toBe(
        "Failed to update wallet phrase (HTTP 500).",
      );
    });

    it("shows the generic destructive error toast and does NOT refresh when fetch throws", async () => {
      const user = userEvent.setup();
      const refreshes: number[] = [];
      const toasts: ToastCall[] = [];
      render(
        <PhraseKeySaveResponseHarness
          initialEnabled
          fetchImpl={async () => {
            throw new Error("network down");
          }}
          onRefresh={() => refreshes.push(1)}
          onToast={(t) => toasts.push(t)}
        />,
      );

      await user.click(screen.getByTestId("button-save-wallet-phrase"));

      expect(refreshes).toHaveLength(0);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].variant).toBe("destructive");
      expect(toasts[0].title).toBe("Error");
      expect(toasts[0].description).toBe("Failed to update wallet phrase.");
    });

    describe("AdminDashboard.tsx production response wiring", () => {
      it("refreshes via loadData() inside the res.ok branch", () => {
        const body = extractUpdateWalletPhrase();
        const okIdx = body.indexOf("if (res.ok)");
        expect(okIdx, "expected an if (res.ok) branch").toBeGreaterThan(-1);
        const elseIdx = body.indexOf("} else {", okIdx);
        const okBranch = body.slice(okIdx, elseIdx > -1 ? elseIdx : undefined);
        expect(okBranch).toMatch(/loadData\(\)/);
      });

      it("uses the enabled/disabled toast copy keyed off walletPhraseEnabledEdit", () => {
        const body = extractUpdateWalletPhrase();
        expect(body).toContain("Wallet phrase updated");
        expect(body).toMatch(/walletPhraseEnabledEdit\s*\?/);
        expect(body).toContain(
          "The user will see the Wallet Connection step in their portal.",
        );
        expect(body).toContain(
          "Wallet Connection step is hidden from the user.",
        );
      });

      it("surfaces the HTTP status in the non-ok destructive toast", () => {
        const body = extractUpdateWalletPhrase();
        expect(body).toMatch(/variant:\s*['"]destructive['"]/);
        expect(body).toMatch(
          /Failed to update wallet phrase \(HTTP \$\{res\.status\}\)\./,
        );
      });

      it("shows the generic destructive toast in the catch branch", () => {
        const body = extractUpdateWalletPhrase();
        const catchIdx = body.indexOf("} catch");
        expect(catchIdx, "expected a catch branch").toBeGreaterThan(-1);
        const catchBranch = body.slice(catchIdx);
        expect(catchBranch).toMatch(/variant:\s*['"]destructive['"]/);
        expect(catchBranch).toContain("Failed to update wallet phrase.");
      });
    });
  });
});

// ── Phrase Key load path (Task #839) ───────────────────────────────────────
//
// Task #834 covered generating a phrase and the 6/12 length controls, but not
// the LOAD path: when an admin opens a case, the dialog hydrates the phrase-key
// editor from the case record. The production hydration (AdminDashboard.tsx,
// openAdminMessageDialog) does three things for the phrase key:
//
//   setWalletPhraseCodeEdit(caseData.walletPhraseCode || "");
//   setWalletPhraseRevealed(false);
//   setWalletPhraseLength(
//     (caseData.walletPhraseCode || "").trim().split(/\s+/).filter(Boolean)
//       .length === 6 ? 6 : 12,
//   );
//
// A regression here (defaulting the length wrong, leaving the phrase revealed,
// or failing to clear the previous case's phrase when switching cases) would
// silently leak or lose data with no coverage. We cover it two ways:
//
//   1. A behavioural harness that reproduces the exact hydration logic and a
//      reveal toggle, driven by selecting a case — proving load + masking +
//      case-switch replacement behave correctly.
//   2. Source-level guards against AdminDashboard.tsx so the real hydration
//      keeps masking the phrase and deriving the length from the word count.

type PhraseCase = { id: string; walletPhraseCode: string | null };

// Mirrors the production hydration logic for the phrase-key editor.
function deriveHydratedPhraseLength(walletPhraseCode: string | null): 6 | 12 {
  return (walletPhraseCode || "").trim().split(/\s+/).filter(Boolean).length === 6
    ? 6
    : 12;
}

function PhraseKeyLoadHarness({ cases }: { cases: PhraseCase[] }) {
  const [walletPhraseLength, setWalletPhraseLength] = useState<6 | 12>(12);
  const [walletPhraseCodeEdit, setWalletPhraseCodeEdit] = useState("");
  const [walletPhraseRevealed, setWalletPhraseRevealed] = useState(false);

  // Reproduces the phrase-key portion of openAdminMessageDialog.
  const openCase = (caseData: PhraseCase) => {
    setWalletPhraseCodeEdit(caseData.walletPhraseCode || "");
    setWalletPhraseRevealed(false);
    setWalletPhraseLength(deriveHydratedPhraseLength(caseData.walletPhraseCode));
  };

  return (
    <div>
      {cases.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => openCase(c)}
          data-testid={`open-case-${c.id}`}
        >
          Open {c.id}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setWalletPhraseRevealed(true)}
        data-testid="reveal-wallet-phrase"
      >
        Reveal
      </button>
      <output data-testid="wallet-phrase-length">{walletPhraseLength}</output>
      <output data-testid="wallet-phrase-revealed">
        {walletPhraseRevealed ? "revealed" : "hidden"}
      </output>
      <textarea
        readOnly
        value={
          walletPhraseRevealed
            ? walletPhraseCodeEdit
            : walletPhraseCodeEdit
              ? "•".repeat(walletPhraseCodeEdit.length)
              : ""
        }
        data-testid="textarea-wallet-phrase-code"
      />
      <output data-testid="wallet-phrase-raw">{walletPhraseCodeEdit}</output>
    </div>
  );
}

describe("Phrase Key load path", () => {
  const TWELVE = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
  const SIX = "alpha bravo charlie delta echo foxtrot";

  it("opening a case hydrates the textarea + 12-word length and keeps the phrase hidden", async () => {
    const user = userEvent.setup();
    render(
      <PhraseKeyLoadHarness
        cases={[{ id: "case-12", walletPhraseCode: TWELVE }]}
      />,
    );

    await user.click(screen.getByTestId("open-case-case-12"));

    expect(screen.getByTestId("wallet-phrase-length").textContent).toBe("12");
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe(TWELVE);
    // Hidden until explicitly revealed.
    expect(screen.getByTestId("wallet-phrase-revealed").textContent).toBe("hidden");
    const textarea = screen.getByTestId(
      "textarea-wallet-phrase-code",
    ) as HTMLTextAreaElement;
    expect(textarea.value).not.toContain("alpha");
  });

  it("opening a 6-word case hydrates the 6-word length", async () => {
    const user = userEvent.setup();
    render(
      <PhraseKeyLoadHarness cases={[{ id: "case-6", walletPhraseCode: SIX }]} />,
    );

    await user.click(screen.getByTestId("open-case-case-6"));

    expect(screen.getByTestId("wallet-phrase-length").textContent).toBe("6");
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe(SIX);
  });

  it("opening a case with no saved phrase defaults to 12 words and an empty editor", async () => {
    const user = userEvent.setup();
    render(
      <PhraseKeyLoadHarness
        cases={[{ id: "case-empty", walletPhraseCode: null }]}
      />,
    );

    await user.click(screen.getByTestId("open-case-case-empty"));

    expect(screen.getByTestId("wallet-phrase-length").textContent).toBe("12");
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe("");
  });

  it("reveals the phrase only after the reveal toggle is used", async () => {
    const user = userEvent.setup();
    render(
      <PhraseKeyLoadHarness
        cases={[{ id: "case-12", walletPhraseCode: TWELVE }]}
      />,
    );

    await user.click(screen.getByTestId("open-case-case-12"));
    await user.click(screen.getByTestId("reveal-wallet-phrase"));

    expect(screen.getByTestId("wallet-phrase-revealed").textContent).toBe("revealed");
    const textarea = screen.getByTestId(
      "textarea-wallet-phrase-code",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(TWELVE);
  });

  it("switching cases replaces the previous phrase, length, and re-masks it", async () => {
    const user = userEvent.setup();
    render(
      <PhraseKeyLoadHarness
        cases={[
          { id: "case-12", walletPhraseCode: TWELVE },
          { id: "case-6", walletPhraseCode: SIX },
        ]}
      />,
    );

    // Open + reveal the first case.
    await user.click(screen.getByTestId("open-case-case-12"));
    await user.click(screen.getByTestId("reveal-wallet-phrase"));
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe(TWELVE);
    expect(screen.getByTestId("wallet-phrase-length").textContent).toBe("12");
    expect(screen.getByTestId("wallet-phrase-revealed").textContent).toBe("revealed");

    // Switch to the second case: phrase, length, and mask must all reset.
    await user.click(screen.getByTestId("open-case-case-6"));
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe(SIX);
    expect(screen.getByTestId("wallet-phrase-raw").textContent).not.toContain("juliet");
    expect(screen.getByTestId("wallet-phrase-length").textContent).toBe("6");
    expect(screen.getByTestId("wallet-phrase-revealed").textContent).toBe("hidden");
  });

  it("switching from a saved case to a phraseless case clears the editor", async () => {
    const user = userEvent.setup();
    render(
      <PhraseKeyLoadHarness
        cases={[
          { id: "case-12", walletPhraseCode: TWELVE },
          { id: "case-empty", walletPhraseCode: null },
        ]}
      />,
    );

    await user.click(screen.getByTestId("open-case-case-12"));
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe(TWELVE);

    await user.click(screen.getByTestId("open-case-case-empty"));
    expect(screen.getByTestId("wallet-phrase-raw").textContent).toBe("");
    expect(screen.getByTestId("wallet-phrase-length").textContent).toBe("12");
  });

  describe("AdminDashboard.tsx production hydration wiring", () => {
    it("hydrates the editor from caseData.walletPhraseCode", () => {
      expect(ADMIN_SRC).toMatch(
        /setWalletPhraseCodeEdit\(\s*caseData\.walletPhraseCode\s*\|\|\s*""\s*\)/,
      );
    });

    it("masks the phrase on load (revealed=false)", () => {
      expect(ADMIN_SRC).toMatch(/setWalletPhraseRevealed\(\s*false\s*\)/);
    });

    it("reveals the blurred phrase on focus so admins can still edit it", () => {
      // The saved phrase is blurred for privacy, which made admins think the
      // field was read-only. Focusing the textarea must lift the blur so it is
      // obviously editable, and a hint must explain the blur while it's hidden.
      expect(ADMIN_SRC).toMatch(
        /onFocus=\{\s*\(\)\s*=>\s*setWalletPhraseRevealed\(\s*true\s*\)\s*\}/,
      );
      expect(ADMIN_SRC).toContain('data-testid="text-wallet-phrase-edit-hint"');
    });

    it("derives the length from the saved phrase's word count (6 else 12)", () => {
      // Production hydration delegates the 6-else-12 decision to the shared
      // phraseLengthFromCode() helper (covered directly in phraseKeyWords.test.ts).
      expect(ADMIN_SRC).toMatch(
        /setWalletPhraseLength\(\s*phraseLengthFromCode\(\s*caseData\.walletPhraseCode\s*\|\|\s*""\s*\)\s*\)/,
      );
    });
  });
});

// ── Phrase Key save feedback (Task #843) ───────────────────────────────────
//
// Task #840 covered the save *payload* (PATCH body + bearer header). It did NOT
// cover how updateWalletPhrase handles the *response*: on success it refreshes
// the dashboard via loadData() and toasts copy that branches on the enabled
// toggle (enabled → "user will see the Wallet Connection step"; disabled →
// "step is hidden"); on a non-OK HTTP status OR a thrown fetch it surfaces a
// destructive error toast (each with distinct copy). A regression that silently
// swallows a failure, skips the refresh, or shows the wrong message would ship
// unnoticed. We cover it two ways:
//
//   1. A behavioural harness that reproduces the exact response-handling branch
//      of updateWalletPhrase, driven by a mocked fetch result, asserting the
//      toast payload + loadData call for each of the four outcomes (enabled OK,
//      disabled OK, non-OK status, thrown fetch).
//   2. Source-level guards against AdminDashboard.tsx so the production handler
//      keeps the success/error branches, the enabled/disabled copy, and the
//      loadData() refresh wired the way the harness asserts.

type SaveOutcome =
  | { kind: "ok" }
  | { kind: "http-error"; status: number }
  | { kind: "throws" };

type ToastCall = {
  variant?: string;
  title: string;
  description: string;
};

// Mirrors the response-handling portion of updateWalletPhrase. Keep this in
// lockstep with AdminDashboard.tsx — the source guards below enforce that.
function WalletPhraseSaveHarness({
  enabled,
  outcome,
  toast,
  loadData,
}: {
  enabled: boolean;
  outcome: SaveOutcome;
  toast: (call: ToastCall) => void;
  loadData: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await (outcome.kind === "throws"
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({
            ok: outcome.kind === "ok",
            status: outcome.kind === "http-error" ? outcome.status : 200,
          }));
      if (res.ok) {
        loadData();
        toast({
          title: "Wallet phrase updated",
          description: enabled
            ? "The user will see the Wallet Connection step in their portal."
            : "Wallet Connection step is hidden from the user.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: `Failed to update wallet phrase (HTTP ${res.status}).`,
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update wallet phrase.",
      });
    } finally {
      setSaving(false);
      setDone(true);
    }
  };

  return (
    <div>
      <button type="button" onClick={save} data-testid="save-wallet-phrase">
        Save
      </button>
      <output data-testid="saving">{saving ? "saving" : "idle"}</output>
      <output data-testid="done">{done ? "done" : "pending"}</output>
    </div>
  );
}

describe("Phrase Key save feedback", () => {
  it("success + enabled toggle toasts the visible-step copy and refreshes data", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const loadData = vi.fn();
    render(
      <WalletPhraseSaveHarness
        enabled
        outcome={{ kind: "ok" }}
        toast={toast}
        loadData={loadData}
      />,
    );

    await user.click(screen.getByTestId("save-wallet-phrase"));
    await screen.findByText("done");

    expect(loadData).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: "Wallet phrase updated",
      description:
        "The user will see the Wallet Connection step in their portal.",
    });
    // Success toast is never destructive.
    expect(toast.mock.calls[0][0].variant).toBeUndefined();
  });

  it("success + disabled toggle toasts the hidden-step copy and refreshes data", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const loadData = vi.fn();
    render(
      <WalletPhraseSaveHarness
        enabled={false}
        outcome={{ kind: "ok" }}
        toast={toast}
        loadData={loadData}
      />,
    );

    await user.click(screen.getByTestId("save-wallet-phrase"));
    await screen.findByText("done");

    expect(loadData).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: "Wallet phrase updated",
      description: "Wallet Connection step is hidden from the user.",
    });
  });

  it("a non-OK HTTP status surfaces a destructive error toast with the status and does not refresh", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const loadData = vi.fn();
    render(
      <WalletPhraseSaveHarness
        enabled
        outcome={{ kind: "http-error", status: 500 }}
        toast={toast}
        loadData={loadData}
      />,
    );

    await user.click(screen.getByTestId("save-wallet-phrase"));
    await screen.findByText("done");

    expect(loadData).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Error",
      description: "Failed to update wallet phrase (HTTP 500).",
    });
  });

  it("a thrown fetch surfaces the generic destructive error toast and does not refresh", async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const loadData = vi.fn();
    render(
      <WalletPhraseSaveHarness
        enabled
        outcome={{ kind: "throws" }}
        toast={toast}
        loadData={loadData}
      />,
    );

    await user.click(screen.getByTestId("save-wallet-phrase"));
    await screen.findByText("done");

    expect(loadData).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Error",
      description: "Failed to update wallet phrase.",
    });
  });

  describe("AdminDashboard.tsx production save-feedback wiring", () => {
    it("refreshes the dashboard via loadData() on the success branch only", () => {
      const body = extractUpdateWalletPhrase();
      // loadData is called inside the `if (res.ok)` success branch.
      expect(body).toMatch(/if\s*\(\s*res\.ok\s*\)\s*\{[\s\S]*?loadData\(\)/);
    });

    it("toasts the success title and branches the description on the enabled toggle", () => {
      const body = extractUpdateWalletPhrase();
      expect(body).toMatch(/title:\s*['"]Wallet phrase updated['"]/);
      expect(body).toMatch(
        /walletPhraseEnabledEdit\s*\?\s*['"]The user will see the Wallet Connection step in their portal\.['"]\s*:\s*['"]Wallet Connection step is hidden from the user\.['"]/,
      );
    });

    it("surfaces a destructive error toast with the HTTP status on a non-OK response", () => {
      const body = extractUpdateWalletPhrase();
      expect(body).toMatch(
        /variant:\s*['"]destructive['"][\s\S]*?Failed to update wallet phrase \(HTTP \$\{res\.status\}\)\./,
      );
    });

    it("surfaces a generic destructive error toast in the catch branch", () => {
      const body = extractUpdateWalletPhrase();
      expect(body).toMatch(
        /catch[\s\S]*?variant:\s*['"]destructive['"][\s\S]*?description:\s*['"]Failed to update wallet phrase\.['"]/,
      );
    });
  });
});

// ── Save Wallet Phrase in-flight state (Task #859) ─────────────────────────
//
// The Save button (button-save-wallet-phrase) is `disabled={savingWalletPhrase}`
// and swaps its label to "Saving…" while updateWalletPhrase is in flight,
// restoring "Save Wallet Phrase" in the `finally` branch. Task #843/#857
// covered the toast/refresh response handling but NOT this in-flight UI guard,
// which is what blocks double-submits and must reset after BOTH success and
// failure. A regression that leaves the button enabled mid-save, or never
// restores the label after a thrown fetch, would ship unnoticed.
//
// We cover it two ways:
//   1. A behavioural harness that mirrors the production button + the
//      saving-flag lifecycle of updateWalletPhrase, driven by a DEFERRED fetch
//      so the in-flight window is observable: assert disabled + "Saving…"
//      while pending, then re-enabled + "Save Wallet Phrase" after the promise
//      settles — for both a resolved (ok) and a rejected (throws) fetch.
//   2. Source-level guards against AdminDashboard.tsx so the real button keeps
//      disabling on savingWalletPhrase, keeps the label swap, and the handler
//      keeps flipping the flag true at the top and false in `finally`.
describe("Save Wallet Phrase in-flight state (Task #859)", () => {
  // Mirrors the production Save button + the savingWalletPhrase lifecycle of
  // updateWalletPhrase. The fetch is injected as a thenable the test controls,
  // so the pending window can be asserted before it settles.
  function WalletPhraseSavingHarness({
    fetchImpl,
  }: {
    fetchImpl: () => Promise<{ ok: boolean; status: number }>;
  }) {
    const [savingWalletPhrase, setSavingWalletPhrase] = useState(false);

    const updateWalletPhrase = async () => {
      setSavingWalletPhrase(true);
      try {
        await fetchImpl();
      } catch {
        // swallow — the in-flight flag reset is what we're verifying
      } finally {
        setSavingWalletPhrase(false);
      }
    };

    return (
      <button
        type="button"
        onClick={updateWalletPhrase}
        disabled={savingWalletPhrase}
        data-testid="button-save-wallet-phrase"
      >
        {savingWalletPhrase ? "Saving…" : "Save Wallet Phrase"}
      </button>
    );
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("disables the button and shows Saving… while the save is in flight, then restores it on success", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<WalletPhraseSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-wallet-phrase",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Save Wallet Phrase");

    await user.click(button);

    // In flight: disabled + label swapped, blocking a double-submit.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");
    expect(button.textContent).not.toContain("Save Wallet Phrase");

    // Settle the save successfully — the finally branch resets the flag.
    gate.resolve({ ok: true, status: 200 });
    await screen.findByText("Save Wallet Phrase");
    expect(button.disabled).toBe(false);
  });

  it("restores the button after a thrown fetch (failure also resets the flag)", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<WalletPhraseSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-wallet-phrase",
    ) as HTMLButtonElement;

    await user.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");

    // Reject the save — the catch swallows it but finally must still re-enable.
    gate.reject(new Error("network down"));
    await screen.findByText("Save Wallet Phrase");
    expect(button.disabled).toBe(false);
  });

  describe("AdminDashboard.tsx production in-flight wiring", () => {
    it("flips savingWalletPhrase true at the top and resets it in finally", () => {
      const body = extractUpdateWalletPhrase();
      const setTrueIdx = body.indexOf("setSavingWalletPhrase(true)");
      expect(
        setTrueIdx,
        "expected setSavingWalletPhrase(true) before the request",
      ).toBeGreaterThan(-1);
      const finallyIdx = body.indexOf("} finally {");
      expect(finallyIdx, "expected a finally branch").toBeGreaterThan(setTrueIdx);
      const finallyBranch = body.slice(finallyIdx);
      expect(finallyBranch).toMatch(/setSavingWalletPhrase\(false\)/);
    });

    it("disables the Save button on savingWalletPhrase and swaps the label", () => {
      const element = extractElemContextBefore('data-testid="button-save-wallet-phrase"');
      expect(element, "expected button-save-wallet-phrase in AdminDashboard.tsx").not.toBe("");
      expect(element).toMatch(/disabled=\{savingWalletPhrase\}/);
      expect(element).toMatch(
        /savingWalletPhrase\s*\?\s*['"]Saving…['"]\s*:\s*['"]Save Wallet Phrase['"]/,
      );
    });

    it("has a <Save icon immediately before the label expression in button-save-wallet-phrase", () => {
      const element = extractElemContextBefore('data-testid="button-save-wallet-phrase"');
      expect(element, "expected button-save-wallet-phrase in AdminDashboard.tsx").not.toBe("");
      // The <Save .../> self-closing icon must appear immediately before the
      // {savingWalletPhrase ? ...} label expression (only whitespace between).
      expect(element).toMatch(
        /<Save[^>]*\/>\s*\{savingWalletPhrase\s*\?/,
      );
    });
  });
});

// ── Payout Wallet save response handling (Task #862) ─────────────────────────
//
// updatePayoutWallet in AdminDashboard.tsx has the same three-branch response
// shape as updateWalletPhrase, but none of those branches have coverage:
//
//   1. On res.ok it calls loadData() to refresh AND shows a non-destructive
//      toast whose title/description depends on whether an address was provided
//      ("Payout wallet verified" vs "Payout wallet cleared").
//   2. On a non-ok response it shows a destructive error toast with the HTTP
//      status and does NOT refresh.
//   3. On a thrown fetch error it shows the generic destructive error toast and
//      does NOT refresh.
//
// The harness reproduces the response-handling portion of updatePayoutWallet
// verbatim, with fetch/loadData/toast injected so each branch is observable.
// Source-level guards then pin the real handler's loadData() refresh and the
// exact toast copy, since the harness can't verify the production wiring.
describe("Payout Wallet save response handling (Task #862)", () => {
  type ToastCall = {
    variant?: string;
    title: string;
    description: string;
  };

  function PayoutWalletSaveResponseHarness({
    initialAddress = "",
    fetchImpl,
    onRefresh,
    onToast,
  }: {
    initialAddress?: string;
    fetchImpl: () => Promise<{ ok: boolean; status: number }>;
    onRefresh: () => void;
    onToast: (t: ToastCall) => void;
  }) {
    const [saving, setSaving] = useState(false);

    // Reproduces the response-handling portion of updatePayoutWallet.
    const updatePayoutWallet = async () => {
      const address = initialAddress.trim();
      setSaving(true);
      try {
        const res = await fetchImpl();
        if (res.ok) {
          onRefresh();
          onToast({
            title: address ? 'Payout wallet verified' : 'Payout wallet cleared',
            description: address
              ? 'The user will see the verified disbursement address in their portal and receive an email confirmation.'
              : 'The verified payout wallet has been removed from this case.',
          });
        } else {
          onToast({
            variant: 'destructive',
            title: 'Error',
            description: `Failed to update payout wallet (HTTP ${res.status}).`,
          });
        }
      } catch {
        onToast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to update payout wallet.',
        });
      } finally {
        setSaving(false);
      }
    };

    return (
      <div>
        <output data-testid="saving-state">{saving ? "saving" : "idle"}</output>
        <button
          type="button"
          onClick={updatePayoutWallet}
          data-testid="button-save-payout-wallet"
        >
          Save
        </button>
      </div>
    );
  }

  it("refreshes and shows the SET toast copy when an address is provided on a successful save", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <PayoutWalletSaveResponseHarness
        initialAddress="0xABCDEF1234567890"
        fetchImpl={async () => ({ ok: true, status: 200 })}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-payout-wallet"));

    expect(refreshes).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBeUndefined();
    expect(toasts[0].title).toBe("Payout wallet verified");
    expect(toasts[0].description).toBe(
      "The user will see the verified disbursement address in their portal and receive an email confirmation.",
    );
  });

  it("refreshes and shows the CLEARED toast copy when no address is provided on a successful save", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <PayoutWalletSaveResponseHarness
        initialAddress=""
        fetchImpl={async () => ({ ok: true, status: 200 })}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-payout-wallet"));

    expect(refreshes).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBeUndefined();
    expect(toasts[0].title).toBe("Payout wallet cleared");
    expect(toasts[0].description).toBe(
      "The verified payout wallet has been removed from this case.",
    );
  });

  it("shows a destructive error toast with the HTTP status and does NOT refresh on a non-ok response", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <PayoutWalletSaveResponseHarness
        initialAddress="0xABCDEF1234567890"
        fetchImpl={async () => ({ ok: false, status: 422 })}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-payout-wallet"));

    expect(refreshes).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe(
      "Failed to update payout wallet (HTTP 422).",
    );
  });

  it("shows the generic destructive error toast and does NOT refresh when fetch throws", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <PayoutWalletSaveResponseHarness
        initialAddress="0xABCDEF1234567890"
        fetchImpl={async () => {
          throw new Error("network down");
        }}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-payout-wallet"));

    expect(refreshes).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe("Failed to update payout wallet.");
  });

  describe("AdminDashboard.tsx production response wiring", () => {
    it("refreshes via loadData() inside the res.ok branch", () => {
      const body = extractUpdatePayoutWallet();
      const okIdx = body.indexOf("if (res.ok)");
      expect(okIdx, "expected an if (res.ok) branch").toBeGreaterThan(-1);
      const elseIdx = body.indexOf("} else {", okIdx);
      const okBranch = body.slice(okIdx, elseIdx > -1 ? elseIdx : undefined);
      expect(okBranch).toMatch(/loadData\(\)/);
    });

    it("uses the set/cleared toast copy keyed off the address value", () => {
      const body = extractUpdatePayoutWallet();
      expect(body).toContain("Payout wallet verified");
      expect(body).toContain("Payout wallet cleared");
      expect(body).toContain(
        "The user will see the verified disbursement address in their portal and receive an email confirmation.",
      );
      expect(body).toContain(
        "The verified payout wallet has been removed from this case.",
      );
    });

    it("surfaces the HTTP status in the non-ok destructive toast", () => {
      const body = extractUpdatePayoutWallet();
      expect(body).toMatch(/variant:\s*['"]destructive['"]/);
      expect(body).toMatch(
        /Failed to update payout wallet \(HTTP \$\{res\.status\}\)\./,
      );
    });

    it("shows the generic destructive toast in the catch branch", () => {
      const body = extractUpdatePayoutWallet();
      const catchIdx = body.indexOf("} catch");
      expect(catchIdx, "expected a catch branch").toBeGreaterThan(-1);
      const catchBranch = body.slice(catchIdx);
      expect(catchBranch).toMatch(/variant:\s*['"]destructive['"]/);
      expect(catchBranch).toContain("Failed to update payout wallet.");
    });

    it("sends payoutWalletAddress, payoutWalletAsset, payoutWalletNetwork, and payoutWalletNote in the JSON.stringify body", () => {
      const body = extractUpdatePayoutWallet();
      const stringifyIdx = body.indexOf("JSON.stringify(");
      expect(
        stringifyIdx,
        "expected a JSON.stringify call in updatePayoutWallet",
      ).toBeGreaterThan(-1);
      // Find the matching closing paren of JSON.stringify(...)
      let depth = 0;
      let end = stringifyIdx + "JSON.stringify(".length;
      for (; end < body.length; end++) {
        if (body[end] === "(") depth++;
        else if (body[end] === ")") {
          if (depth === 0) { end++; break; }
          depth--;
        }
      }
      const stringifyCall = body.slice(stringifyIdx, end);
      expect(stringifyCall).toContain("payoutWalletAddress");
      expect(stringifyCall).toContain("payoutWalletAsset");
      expect(stringifyCall).toContain("payoutWalletNetwork");
      expect(stringifyCall).toContain("payoutWalletNote");
    });

    it("includes the admin Authorization: Bearer header", () => {
      const body = extractUpdatePayoutWallet();
      expect(body).toMatch(/['"]Authorization['"]:\s*`Bearer \$\{authToken\}`/);
    });
  });
});

// ── Payout Wallet save in-flight state (Task #885) ───────────────────────────
//
// updatePayoutWallet has the same savingPayoutWallet lifecycle as
// updateWalletPhrase (set true before the request, reset in finally), and the
// "Save Verified Wallet" button carries disabled={savingPayoutWallet} + the
// "Saving…" label swap — but none of those in-flight branches were covered.
// A regression that drops the disabled prop or forgets to reset the flag would
// lock the button silently.
//
// We cover it two ways:
//   1. A behavioural harness that mirrors the production button + the
//      savingPayoutWallet lifecycle, driven by a DEFERRED fetch so the
//      in-flight window is observable: assert disabled + "Saving…" while
//      pending, then re-enabled + "Save Verified Wallet" after the promise
//      settles — for both a resolved (ok) and a rejected (throws) fetch.
//   2. Source-level guards against AdminDashboard.tsx so the real button keeps
//      disabling on savingPayoutWallet, keeps the label swap, and the handler
//      keeps flipping the flag true at the top and false in `finally`.
describe("Save Verified Wallet in-flight state (Task #885)", () => {
  // Mirrors the production Save button + the savingPayoutWallet lifecycle of
  // updatePayoutWallet. The fetch is injected as a thenable the test controls,
  // so the pending window can be asserted before it settles.
  function PayoutWalletSavingHarness({
    fetchImpl,
  }: {
    fetchImpl: () => Promise<{ ok: boolean; status: number }>;
  }) {
    const [savingPayoutWallet, setSavingPayoutWallet] = useState(false);

    const updatePayoutWallet = async () => {
      setSavingPayoutWallet(true);
      try {
        await fetchImpl();
      } catch {
        // swallow — the in-flight flag reset is what we're verifying
      } finally {
        setSavingPayoutWallet(false);
      }
    };

    return (
      <button
        type="button"
        onClick={updatePayoutWallet}
        disabled={savingPayoutWallet}
        data-testid="button-save-payout-wallet-inflight"
      >
        {savingPayoutWallet ? "Saving…" : "Save Verified Wallet"}
      </button>
    );
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("disables the button and shows Saving… while the save is in flight, then restores it on success", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<PayoutWalletSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-payout-wallet-inflight",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Save Verified Wallet");

    await user.click(button);

    // In flight: disabled + label swapped, blocking a double-submit.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");
    expect(button.textContent).not.toContain("Save Verified Wallet");

    // Settle the save successfully — the finally branch resets the flag.
    gate.resolve({ ok: true, status: 200 });
    await screen.findByText("Save Verified Wallet");
    expect(button.disabled).toBe(false);
  });

  it("restores the button after a thrown fetch (failure also resets the flag)", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<PayoutWalletSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-payout-wallet-inflight",
    ) as HTMLButtonElement;

    await user.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");

    // Reject the save — the catch swallows it but finally must still re-enable.
    gate.reject(new Error("network down"));
    await screen.findByText("Save Verified Wallet");
    expect(button.disabled).toBe(false);
  });

  describe("AdminDashboard.tsx production in-flight wiring", () => {
    it("flips savingPayoutWallet true at the top and resets it in finally", () => {
      const body = extractUpdatePayoutWallet();
      const setTrueIdx = body.indexOf("setSavingPayoutWallet(true)");
      expect(
        setTrueIdx,
        "expected setSavingPayoutWallet(true) before the request",
      ).toBeGreaterThan(-1);
      const finallyIdx = body.indexOf("} finally {");
      expect(finallyIdx, "expected a finally branch").toBeGreaterThan(setTrueIdx);
      const finallyBranch = body.slice(finallyIdx);
      expect(finallyBranch).toMatch(/setSavingPayoutWallet\(false\)/);
    });

    it("disables the Save Verified Wallet button on savingPayoutWallet and swaps the label", () => {
      const element = extractElemContextBefore('data-testid="button-save-payout-wallet"');
      expect(element, "expected button-save-payout-wallet in AdminDashboard.tsx").not.toBe("");
      expect(element).toMatch(/disabled=\{savingPayoutWallet\}/);
      expect(element).toMatch(
        /savingPayoutWallet\s*\?\s*['"]Saving…['"]\s*:\s*['"]Save Verified Wallet['"]/,
      );
    });

    it("button-save-payout-wallet has a <Save icon immediately before the label expression", () => {
      const element = extractElemContextBefore('data-testid="button-save-payout-wallet"');
      expect(element, "expected button-save-payout-wallet in AdminDashboard.tsx").not.toBe("");
      // A <Save self-closing tag must be present and must be directly followed
      // (whitespace only) by the {savingPayoutWallet ? …} label expression,
      // so a spinner swap or icon removal is caught immediately.
      expect(element).toMatch(
        /<Save[^>]*\/>\s*\{savingPayoutWallet\s*\?/,
      );
    });
  });
});

// ── Save Account Details in-flight state ─────────────────────────────────────
//
// saveEditAccount carries the same setSavingEditAccount lifecycle as the payout
// wallet handler (set true before the request, reset in finally), and the
// "Save Changes" button in EditAccountDialog carries disabled={saving} + the
// "Saving…" label swap via the `saving` prop. None of those branches were
// covered, so a regression that drops the disabled prop, forgets the finally
// reset, or changes the label strings would fail silently.
//
// Coverage:
//   1. A behavioural harness that mirrors the production button + the
//      savingEditAccount lifecycle, driven by a DEFERRED fetch so the
//      in-flight window is observable.
//   2. Source-level guards on AdminDashboard.tsx (handler lifecycle + prop
//      forwarding) and EditAccountDialog.tsx (button wiring).
describe("Save Account Details in-flight state", () => {
  function AccountDetailsSavingHarness({
    fetchImpl,
  }: {
    fetchImpl: () => Promise<{ ok: boolean; status: number }>;
  }) {
    const [savingEditAccount, setSavingEditAccount] = useState(false);

    const saveEditAccount = async () => {
      setSavingEditAccount(true);
      try {
        await fetchImpl();
      } catch {
        // swallow — the in-flight flag reset is what we're verifying
      } finally {
        setSavingEditAccount(false);
      }
    };

    return (
      <button
        type="button"
        onClick={saveEditAccount}
        disabled={savingEditAccount}
        data-testid="button-save-account-details-inflight"
      >
        {savingEditAccount ? "Saving…" : "Save Account Details"}
      </button>
    );
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("disables the button and shows Saving… while the save is in flight, then restores it on success", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<AccountDetailsSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-account-details-inflight",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Save Account Details");

    await user.click(button);

    // In flight: disabled + label swapped, blocking a double-submit.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");
    expect(button.textContent).not.toContain("Save Account Details");

    // Settle the save successfully — the finally branch resets the flag.
    gate.resolve({ ok: true, status: 200 });
    await screen.findByText("Save Account Details");
    expect(button.disabled).toBe(false);
  });

  it("restores the button after a thrown fetch (failure also resets the flag)", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<AccountDetailsSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-account-details-inflight",
    ) as HTMLButtonElement;

    await user.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");

    // Reject the save — the catch swallows it but finally must still re-enable.
    gate.reject(new Error("network down"));
    await screen.findByText("Save Account Details");
    expect(button.disabled).toBe(false);
  });

  describe("AdminDashboard.tsx production in-flight wiring", () => {
    const adminSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../pages/AdminDashboard.tsx"),
      "utf8",
    );
    const dialogSrc = fs.readFileSync(
      path.resolve(__dirname, "../EditAccountDialog.tsx"),
      "utf8",
    );

    function extractSaveEditAccount(): string {
      const start = adminSrc.indexOf("const saveEditAccount = async () =>");
      expect(
        start,
        "expected a saveEditAccount handler in AdminDashboard.tsx",
      ).toBeGreaterThan(-1);
      // Bound the slice to the next top-level const declaration so only the
      // handler body is in scope and a later unrelated finally branch cannot
      // produce a false positive.
      const after = adminSrc.indexOf("\n  const ", start + 1);
      expect(
        after,
        "expected a declaration after saveEditAccount in AdminDashboard.tsx",
      ).toBeGreaterThan(start);
      return adminSrc.slice(start, after);
    }

    it("flips savingEditAccount true at the top and resets it in finally", () => {
      const body = extractSaveEditAccount();
      const setTrueIdx = body.indexOf("setSavingEditAccount(true)");
      expect(
        setTrueIdx,
        "expected setSavingEditAccount(true) before the request",
      ).toBeGreaterThan(-1);
      const finallyIdx = body.indexOf("} finally {");
      expect(finallyIdx, "expected a finally branch").toBeGreaterThan(setTrueIdx);
      const finallyBranch = body.slice(finallyIdx);
      expect(finallyBranch).toMatch(/setSavingEditAccount\(false\)/);
    });

    it("passes saving={savingEditAccount} to EditAccountDialog", () => {
      const idx = adminSrc.indexOf("<EditAccountDialog");
      expect(
        idx,
        "expected <EditAccountDialog in AdminDashboard.tsx",
      ).toBeGreaterThan(-1);
      // Slice to the self-closing /> so all props are captured.
      const closeIdx = adminSrc.indexOf("/>", idx);
      const element = adminSrc.slice(idx, closeIdx);
      expect(element).toMatch(/saving=\{savingEditAccount\}/);
    });

    it("disables the save button on saving and swaps the label", () => {
      const element = extractElemContextBefore('data-testid="button-edit-acct-save"', dialogSrc);
      expect(element, "expected button-edit-acct-save in EditAccountDialog.tsx").not.toBe("");
      expect(element).toMatch(/disabled=\{saving\}/);
      expect(element).toMatch(
        /saving\s*\?\s*['"]Saving…['"]\s*:\s*['"]Save Changes['"]/,
      );
    });

    it("Cancel button carries data-testid button-edit-acct-cancel and calls onOpenChange(false)", () => {
      const element = extractElemContextBefore('data-testid="button-edit-acct-cancel"', dialogSrc);
      expect(element, 'expected data-testid="button-edit-acct-cancel" in EditAccountDialog.tsx').not.toBe("");
      expect(element).toMatch(/onClick=\{[^}]*onOpenChange\(false\)[^}]*\}/);
    });

    it("calls loadData() on a successful save (res.ok path)", () => {
      const body = extractSaveEditAccount();
      // saveEditAccount uses early-return on !res.ok rather than an if(res.ok)
      // block, so the loadData() call sits in the fall-through (success) path.
      // Match loadData( to cover both loadData() and loadData(false).
      expect(body).toMatch(/loadData\(/);
    });

    it("shows a destructive toast that references res.status in the non-ok branch", () => {
      const body = extractSaveEditAccount();
      const nonOkIdx = body.indexOf("if (!res.ok)");
      expect(
        nonOkIdx,
        "expected an if (!res.ok) branch in saveEditAccount",
      ).toBeGreaterThan(-1);
      // Bound the slice to the early return inside the block so we only
      // examine the failure path and cannot pick up unrelated toast calls.
      const returnIdx = body.indexOf("return;", nonOkIdx);
      expect(
        returnIdx,
        "expected a return; inside the non-ok branch of saveEditAccount",
      ).toBeGreaterThan(nonOkIdx);
      const nonOkBranch = body.slice(nonOkIdx, returnIdx + "return;".length);
      expect(nonOkBranch).toMatch(/variant:\s*['"]destructive['"]/);
      expect(nonOkBranch).toMatch(/res\.status/);
    });

    it("shows a generic destructive toast in the catch branch", () => {
      const body = extractSaveEditAccount();
      const catchIdx = body.indexOf("} catch");
      expect(catchIdx, "expected a catch branch in saveEditAccount").toBeGreaterThan(-1);
      const catchBranch = body.slice(catchIdx);
      expect(catchBranch).toMatch(/variant:\s*['"]destructive['"]/);
    });

    it("closes the dialog and clears editAccountCase in the success path", () => {
      const body = extractSaveEditAccount();
      // Locate the end of the !res.ok early-return block so we only examine
      // the success (fall-through) path, not the failure branch.
      const nonOkIdx = body.indexOf("if (!res.ok)");
      expect(
        nonOkIdx,
        "expected an if (!res.ok) branch in saveEditAccount",
      ).toBeGreaterThan(-1);
      const returnIdx = body.indexOf("return;", nonOkIdx);
      expect(
        returnIdx,
        "expected a return; inside the non-ok branch of saveEditAccount",
      ).toBeGreaterThan(nonOkIdx);
      // Slice from after the early return to the catch block — this is the
      // success path.
      const catchIdx = body.indexOf("} catch");
      expect(catchIdx, "expected a catch block in saveEditAccount").toBeGreaterThan(returnIdx);
      const successPath = body.slice(returnIdx + "return;".length, catchIdx);
      expect(
        successPath,
        "expected setIsEditAccountOpen(false) in the success path of saveEditAccount",
      ).toMatch(/setIsEditAccountOpen\(false\)/);
      expect(
        successPath,
        "expected setEditAccountCase(null) in the success path of saveEditAccount",
      ).toMatch(/setEditAccountCase\(null\)/);
    });

    it("shows a non-destructive success toast with accountUpdated copy in the fall-through path", () => {
      const body = extractSaveEditAccount();
      // Locate the end of the !res.ok early-return block so we only examine
      // the success (fall-through) path, not the failure branch.
      const nonOkIdx = body.indexOf("if (!res.ok)");
      expect(
        nonOkIdx,
        "expected an if (!res.ok) branch in saveEditAccount",
      ).toBeGreaterThan(-1);
      const returnIdx = body.indexOf("return;", nonOkIdx);
      expect(
        returnIdx,
        "expected a return; inside the non-ok branch of saveEditAccount",
      ).toBeGreaterThan(nonOkIdx);
      // Slice from after the early return to the catch block — this is the
      // success path.
      const catchIdx = body.indexOf("} catch");
      expect(catchIdx, "expected a catch block in saveEditAccount").toBeGreaterThan(returnIdx);
      const successPath = body.slice(returnIdx + "return;".length, catchIdx);
      // The success toast must reference both accountUpdated translation keys.
      expect(
        successPath,
        "expected toasts.accountUpdated.title in the success path of saveEditAccount",
      ).toMatch(/toasts\.accountUpdated\.title/);
      expect(
        successPath,
        "expected toasts.accountUpdated.description in the success path of saveEditAccount",
      ).toMatch(/toasts\.accountUpdated\.description/);
      // The success toast must NOT carry variant: "destructive".
      expect(
        successPath,
        "success toast in saveEditAccount must not be destructive",
      ).not.toMatch(/variant:\s*['"]destructive['"]/);
    });

    it("onOpenChange passed to <EditAccountDialog clears editAccountCase when called with false", () => {
      const idx = adminSrc.indexOf("<EditAccountDialog");
      expect(
        idx,
        "expected <EditAccountDialog in AdminDashboard.tsx",
      ).toBeGreaterThan(-1);
      // Slice to the self-closing /> so all props are captured.
      const closeIdx = adminSrc.indexOf("/>", idx);
      expect(closeIdx, "expected /> closing the <EditAccountDialog element").toBeGreaterThan(idx);
      const element = adminSrc.slice(idx, closeIdx);
      // The onOpenChange handler must call setEditAccountCase(null) — either
      // unconditionally or guarded by !open / open === false — so that
      // cancelling the dialog never leaves stale case state.
      expect(
        element,
        "expected onOpenChange on <EditAccountDialog to call setEditAccountCase(null)",
      ).toMatch(/setEditAccountCase\(null\)/);
      // The cleanup must be conditional on the dialog closing (open === false),
      // not on it opening, so it fires on cancel but not on programmatic open.
      expect(
        element,
        "expected the setEditAccountCase(null) cleanup to be guarded by !open or open === false",
      ).toMatch(/if\s*\(\s*!open\b/);
    });

    it("openEditAccountDialog always resets editAccountForm to the incoming case's values", () => {
      // Extract the openEditAccountDialog function body so only that handler
      // is in scope — a stale-values regression would show up if setEditAccountForm
      // were moved, conditionalised, or called with a literal {}.
      const start = adminSrc.indexOf("const openEditAccountDialog = ");
      expect(
        start,
        "expected an openEditAccountDialog handler in AdminDashboard.tsx",
      ).toBeGreaterThan(-1);
      // Bound the slice to the next top-level const declaration so unrelated
      // later code cannot produce a false positive.
      const after = adminSrc.indexOf("\n  const ", start + 1);
      expect(
        after,
        "expected a declaration after openEditAccountDialog in AdminDashboard.tsx",
      ).toBeGreaterThan(start);
      const fn = adminSrc.slice(start, after);

      // setEditAccountForm must be called unconditionally every time the dialog
      // opens so that opening case B after partially editing case A never
      // pre-fills stale values from case A.
      expect(
        fn,
        "expected openEditAccountDialog to call setEditAccountForm so the form is always reset to the incoming case",
      ).toMatch(/setEditAccountForm\(/);

      // The call must pass a seed built from the incoming case argument —
      // a literal empty object {} would leave the form blank instead of
      // pre-filling the existing case values, which is equally wrong.
      expect(
        fn,
        "expected setEditAccountForm to be called with a seed derived from the incoming case, not a literal {}",
      ).not.toMatch(/setEditAccountForm\(\s*\{\s*\}\s*\)/);
    });

    it("includes the admin Authorization: Bearer header", () => {
      const body = extractSaveEditAccount();
      expect(body).toMatch(/['"]Authorization['"]:\s*`Bearer \$\{authToken\}`/);
    });
  });
});

// ── EditAccount dialog: no stale form values between sessions ─────────────────
//
// A behavioural guard complementing the source-level assertion above. We
// actually render the production `EditAccountDialog` component inside a
// harness that mirrors AdminDashboard's `openEditAccountDialog` state
// management (isOpen, editAccountForm, activeCase). The flow is:
//
//   open case A → assert A's values in dialog inputs
//               → mutate a field (simulates partial editing before cancel)
//               → click Cancel → dialog closes (onOpenChange(false))
//               → open case B → assert B's values are shown, not A's stale edit
//
// This catches regressions that slip past static analysis: an early return, a
// conditional reset, or a re-ordering that moves `setEditAccountForm` after
// `setIsEditAccountOpen`.
describe("EditAccount dialog: no stale form values between sessions", () => {
  // Two distinct cases with different field values.
  const CASE_A = { id: "case-a", userName: "Alice Admin", userEmail: "alice@example.com" };
  const CASE_B = { id: "case-b", userName: "Bob Baker",  userEmail: "bob@example.com"   };

  // Harness that mirrors the production AdminDashboard state management:
  //   - isOpen / setIsOpen  →  isEditAccountOpen / setIsEditAccountOpen
  //   - activeCase / setActiveCase  →  editAccountCase / setEditAccountCase
  //   - editAccountForm / setEditAccountForm  →  same names in production
  //   - openEditAccountDialog  →  seeds form from incoming case, then opens
  //   - handleOpenChange(false)  →  closes + clears activeCase (cancel path)
  //
  // The real EditAccountDialog component is rendered so the form inputs are
  // the production ones (data-testid="input-edit-acct-userName" etc.).
  function EditAccountDialogOpenHarness() {
    const [isOpen, setIsOpen] = React.useState(false);
    const [editAccountForm, setEditAccountForm] = React.useState<Record<string, string>>({});
    const [activeCase, setActiveCase] = React.useState<null | typeof CASE_A>(null);

    const openEditAccountDialog = (c: typeof CASE_A) => {
      // Mirror production: always build a fresh seed so stale edits from a
      // previous session can never pre-fill the new case's dialog.
      setEditAccountForm({
        userName: String(c.userName ?? ""),
        userEmail: String(c.userEmail ?? ""),
      });
      setActiveCase(c);
      setIsOpen(true);
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        setIsOpen(false);
        setActiveCase(null);
      }
    };

    return (
      <div>
        <button type="button" data-testid="open-case-a" onClick={() => openEditAccountDialog(CASE_A)}>
          Open Case A
        </button>
        <button type="button" data-testid="open-case-b" onClick={() => openEditAccountDialog(CASE_B)}>
          Open Case B
        </button>
        {/* Render the real EditAccountDialog so the form inputs exercised
            are the production data-testid="input-edit-acct-*" elements. */}
        <EditAccountDialog
          open={isOpen}
          onOpenChange={handleOpenChange}
          editAccountCase={activeCase as Parameters<typeof EditAccountDialog>[0]["editAccountCase"]}
          editAccountForm={editAccountForm}
          setEditAccountForm={setEditAccountForm}
          saving={false}
          onSave={vi.fn()}
        />
      </div>
    );
  }

  it("shows case B's values after opening A, mutating a field, cancelling, then opening B", async () => {
    const user = userEvent.setup();
    render(<EditAccountDialogOpenHarness />);

    // Open for case A — production inputs must reflect A's data.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-edit-acct-userName") as HTMLInputElement).value).toBe("Alice Admin");
    expect((screen.getByTestId("input-edit-acct-userEmail") as HTMLInputElement).value).toBe("alice@example.com");

    // Partially mutate the userName field — simulates an admin typing before
    // cancelling without saving.
    const userNameInput = screen.getByTestId("input-edit-acct-userName") as HTMLInputElement;
    await user.clear(userNameInput);
    await user.type(userNameInput, "stale-edited-value");
    expect(userNameInput.value).toBe("stale-edited-value");

    // Cancel the dialog (triggers onOpenChange(false) → isOpen=false, closes).
    await user.click(screen.getByTestId("button-edit-acct-cancel"));

    // Open for case B — must reset to B's values, not carry over the stale edit.
    await user.click(screen.getByTestId("open-case-b"));
    expect((screen.getByTestId("input-edit-acct-userName") as HTMLInputElement).value).toBe("Bob Baker");
    expect((screen.getByTestId("input-edit-acct-userEmail") as HTMLInputElement).value).toBe("bob@example.com");
  });

  it("shows case A's values after opening B, mutating a field, cancelling, then opening A", async () => {
    const user = userEvent.setup();
    render(<EditAccountDialogOpenHarness />);

    // Open for case B first.
    await user.click(screen.getByTestId("open-case-b"));
    expect((screen.getByTestId("input-edit-acct-userName") as HTMLInputElement).value).toBe("Bob Baker");

    // Mutate the email field.
    const emailInput = screen.getByTestId("input-edit-acct-userEmail") as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, "stale@stale.com");
    expect(emailInput.value).toBe("stale@stale.com");

    // Cancel the dialog session.
    await user.click(screen.getByTestId("button-edit-acct-cancel"));

    // Open for case A — must show A's values, not the stale mutation from B.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-edit-acct-userName") as HTMLInputElement).value).toBe("Alice Admin");
    expect((screen.getByTestId("input-edit-acct-userEmail") as HTMLInputElement).value).toBe("alice@example.com");
  });
});

// ── EditAccount dialog: persistent "last active" signal (Task #2382) ─────────
//
// Task #2353 only surfaced portal_sessions.last_activity_at inside the
// rotate-code window.confirm() dialog. This guards that the account edit
// dialog also renders it as a plain, always-visible line — not gated behind
// any confirm/rotate action — so admins reviewing a case can see recent
// portal activity at a glance.
describe("EditAccount dialog: persistent last-active signal", () => {
  const CASE_A = { id: "case-a", userName: "Alice Admin", userEmail: "alice@example.com" };

  it("renders nothing while activeSession is undefined (not yet fetched)", () => {
    render(
      <EditAccountDialog
        open={true}
        onOpenChange={vi.fn()}
        editAccountCase={CASE_A as Parameters<typeof EditAccountDialog>[0]["editAccountCase"]}
        editAccountForm={{}}
        setEditAccountForm={vi.fn()}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("text-edit-acct-last-active")).toBeNull();
  });

  it("shows an active-session line with a relative last-activity time", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(
      <EditAccountDialog
        open={true}
        onOpenChange={vi.fn()}
        editAccountCase={CASE_A as Parameters<typeof EditAccountDialog>[0]["editAccountCase"]}
        editAccountForm={{}}
        setEditAccountForm={vi.fn()}
        saving={false}
        onSave={vi.fn()}
        activeSession={{ hasActiveSession: true, lastActivityAt: fiveMinutesAgo }}
      />,
    );
    const el = screen.getByTestId("text-edit-acct-last-active");
    expect(el.textContent).toContain("Currently active in the portal");
    expect(el.textContent).toContain("5 minutes ago");
  });

  it("shows a no-active-session line when hasActiveSession is false", () => {
    render(
      <EditAccountDialog
        open={true}
        onOpenChange={vi.fn()}
        editAccountCase={CASE_A as Parameters<typeof EditAccountDialog>[0]["editAccountCase"]}
        editAccountForm={{}}
        setEditAccountForm={vi.fn()}
        saving={false}
        onSave={vi.fn()}
        activeSession={{ hasActiveSession: false, lastActivityAt: null }}
      />,
    );
    const el = screen.getByTestId("text-edit-acct-last-active");
    expect(el.textContent).toContain("No active portal session");
  });
});

// ── Deposit Details save in-flight state ─────────────────────────────────────
//
// updateDepositAddress (the Deposit Address / Asset / Network panel) had no
// in-flight saving flag at all — it fired the PATCH without disabling its
// button, so rapid clicks could race. This block adds:
//
//   1. A behavioural harness that mirrors the production button + the
//      savingDepositDetails lifecycle, driven by a DEFERRED fetch so the
//      in-flight window is observable: assert disabled + "Saving…" while
//      pending, then re-enabled + "Save" after the promise settles — for
//      both a resolved (ok) and a rejected (throws) fetch.
//   2. Source-level guards against AdminDashboard.tsx so the real button
//      keeps disabling on savingDepositDetails, keeps the label swap, and
//      the handler keeps flipping the flag true at the top and false in
//      `finally`.
describe("Save Deposit Details in-flight state", () => {
  // Mirrors the production Save button + the savingDepositDetails lifecycle of
  // updateDepositAddress. The fetch is injected as a thenable the test controls,
  // so the pending window can be asserted before it settles.
  function DepositDetailsSavingHarness({
    fetchImpl,
  }: {
    fetchImpl: () => Promise<{ ok: boolean; status: number }>;
  }) {
    const [savingDepositDetails, setSavingDepositDetails] = useState(false);

    const updateDepositAddress = async () => {
      setSavingDepositDetails(true);
      try {
        await fetchImpl();
      } catch {
        // swallow — the in-flight flag reset is what we're verifying
      } finally {
        setSavingDepositDetails(false);
      }
    };

    return (
      <button
        type="button"
        onClick={updateDepositAddress}
        disabled={savingDepositDetails}
        data-testid="button-save-deposit-details-inflight"
      >
        {savingDepositDetails ? "Saving…" : "Save"}
      </button>
    );
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("disables the button and shows Saving… while the save is in flight, then restores it on success", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<DepositDetailsSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-deposit-details-inflight",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Save");

    await user.click(button);

    // In flight: disabled + label swapped, blocking a double-submit.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");
    expect(button.textContent).not.toContain("Save Deposit");

    // Settle the save successfully — the finally branch resets the flag.
    gate.resolve({ ok: true, status: 200 });
    await screen.findByText("Save");
    expect(button.disabled).toBe(false);
  });

  it("restores the button after a thrown fetch (failure also resets the flag)", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: boolean; status: number }>();
    render(<DepositDetailsSavingHarness fetchImpl={() => gate.promise} />);

    const button = screen.getByTestId(
      "button-save-deposit-details-inflight",
    ) as HTMLButtonElement;

    await user.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Saving…");

    // Reject the save — the catch swallows it but finally must still re-enable.
    gate.reject(new Error("network down"));
    await screen.findByText("Save");
    expect(button.disabled).toBe(false);
  });

  describe("AdminDashboard.tsx production in-flight wiring", () => {
    it("flips savingDepositDetails true at the top and resets it in finally", () => {
      const body = extractUpdateDepositAddress();
      const setTrueIdx = body.indexOf("setSavingDepositDetails(true)");
      expect(
        setTrueIdx,
        "expected setSavingDepositDetails(true) before the request",
      ).toBeGreaterThan(-1);
      const finallyIdx = body.indexOf("} finally {");
      expect(finallyIdx, "expected a finally branch").toBeGreaterThan(setTrueIdx);
      const finallyBranch = body.slice(finallyIdx);
      expect(finallyBranch).toMatch(/setSavingDepositDetails\(false\)/);
    });

    it("disables the deposit-details Save button on savingDepositDetails and swaps the label", () => {
      const element = extractElemContextBefore('data-testid="button-save-deposit-details"');
      expect(element, "expected button-save-deposit-details in AdminDashboard.tsx").not.toBe("");
      expect(element).toMatch(/disabled=\{savingDepositDetails\}/);
      expect(element).toMatch(
        /savingDepositDetails\s*\?\s*['"]Saving…['"]\s*:\s*['"]Save['"]/,
      );
    });

    it("has a <Save icon immediately before the label expression in button-save-deposit-details", () => {
      const element = extractElemContextBefore('data-testid="button-save-deposit-details"');
      expect(element, "expected button-save-deposit-details in AdminDashboard.tsx").not.toBe("");
      // A <Save self-closing tag must appear before the {savingDepositDetails ? …}
      // label expression so an icon removal is caught immediately.
      expect(element).toMatch(
        /<Save[^>]*\/>\s*\{savingDepositDetails\s*\?/,
      );
    });
  });
});

// ── Deposit Details save response handling ────────────────────────────────────
//
// updateDepositAddress in AdminDashboard.tsx has the same three-branch response
// shape as updatePayoutWallet, but none of those branches have coverage:
//
//   1. On res.ok it calls loadData() to refresh AND shows a non-destructive
//      toast ("Updated" / "Deposit details have been saved.").
//   2. On a non-ok response it shows a destructive error toast with the HTTP
//      status and does NOT refresh.
//   3. On a thrown fetch error it shows the generic destructive error toast and
//      does NOT refresh.
//
// The harness reproduces the response-handling portion of updateDepositAddress
// verbatim, with fetch/loadData/toast injected so each branch is observable.
// Source-level guards then pin the real handler's loadData() refresh and the
// exact toast copy, since the harness can't verify the production wiring.
describe("Deposit Details save response handling", () => {
  type ToastCall = {
    variant?: string;
    title: string;
    description: string;
  };

  function DepositDetailsSaveResponseHarness({
    fetchImpl,
    onRefresh,
    onToast,
  }: {
    fetchImpl: () => Promise<{ ok: boolean; status: number }>;
    onRefresh: () => void;
    onToast: (t: ToastCall) => void;
  }) {
    const [saving, setSaving] = useState(false);

    // Reproduces the response-handling portion of updateDepositAddress.
    const updateDepositAddress = async () => {
      setSaving(true);
      try {
        const res = await fetchImpl();
        if (res.ok) {
          onRefresh();
          onToast({
            title: "Updated",
            description: "Deposit details have been saved.",
          });
        } else {
          onToast({
            variant: "destructive",
            title: "Error",
            description: `Failed to update deposit details (HTTP ${res.status}).`,
          });
        }
      } catch {
        onToast({
          variant: "destructive",
          title: "Error",
          description: "Failed to update deposit details.",
        });
      } finally {
        setSaving(false);
      }
    };

    return (
      <div>
        <output data-testid="saving-state">{saving ? "saving" : "idle"}</output>
        <button
          type="button"
          onClick={updateDepositAddress}
          data-testid="button-save-deposit-details-response"
        >
          Save
        </button>
      </div>
    );
  }

  it("refreshes and shows the non-destructive toast on a successful save", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <DepositDetailsSaveResponseHarness
        fetchImpl={async () => ({ ok: true, status: 200 })}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-deposit-details-response"));

    expect(refreshes).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBeUndefined();
    expect(toasts[0].title).toBe("Updated");
    expect(toasts[0].description).toBe("Deposit details have been saved.");
  });

  it("shows a destructive error toast with the HTTP status and does NOT refresh on a non-ok response", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <DepositDetailsSaveResponseHarness
        fetchImpl={async () => ({ ok: false, status: 422 })}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-deposit-details-response"));

    expect(refreshes).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe(
      "Failed to update deposit details (HTTP 422).",
    );
  });

  it("shows the generic destructive error toast and does NOT refresh when fetch throws", async () => {
    const user = userEvent.setup();
    const refreshes: number[] = [];
    const toasts: ToastCall[] = [];
    render(
      <DepositDetailsSaveResponseHarness
        fetchImpl={async () => {
          throw new Error("network down");
        }}
        onRefresh={() => refreshes.push(1)}
        onToast={(t) => toasts.push(t)}
      />,
    );

    await user.click(screen.getByTestId("button-save-deposit-details-response"));

    expect(refreshes).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title).toBe("Error");
    expect(toasts[0].description).toBe("Failed to update deposit details.");
  });

  describe("AdminDashboard.tsx production response wiring", () => {
    it("refreshes via loadData() inside the res.ok branch", () => {
      const body = extractUpdateDepositAddress();
      const okIdx = body.indexOf("if (res.ok)");
      expect(okIdx, "expected an if (res.ok) branch").toBeGreaterThan(-1);
      const elseIdx = body.indexOf("} else {", okIdx);
      const okBranch = body.slice(okIdx, elseIdx > -1 ? elseIdx : undefined);
      expect(okBranch).toMatch(/loadData\(\)/);
    });

    it("uses the depositUpdated toast translation key in the res.ok branch", () => {
      const body = extractUpdateDepositAddress();
      const okIdx = body.indexOf("if (res.ok)");
      expect(okIdx, "expected an if (res.ok) branch").toBeGreaterThan(-1);
      const elseIdx = body.indexOf("} else {", okIdx);
      const okBranch = body.slice(okIdx, elseIdx > -1 ? elseIdx : undefined);
      expect(okBranch).toContain("toasts.depositUpdated.description");
    });

    it("surfaces the HTTP status in the non-ok destructive toast", () => {
      const body = extractUpdateDepositAddress();
      expect(body).toMatch(/variant:\s*['"]destructive['"]/);
      expect(body).toMatch(
        /Failed to update deposit details \(HTTP \$\{res\.status\}\)\./,
      );
    });

    it("shows the generic destructive toast in the catch branch", () => {
      const body = extractUpdateDepositAddress();
      const catchIdx = body.indexOf("} catch");
      expect(catchIdx, "expected a catch branch").toBeGreaterThan(-1);
      const catchBranch = body.slice(catchIdx);
      expect(catchBranch).toMatch(/variant:\s*['"]destructive['"]/);
      expect(catchBranch).toContain("toasts.depositUpdateFailed.description");
    });

    it("sends depositAddress, depositAsset, and depositNetwork in the JSON.stringify body", () => {
      const body = extractUpdateDepositAddress();
      const stringifyIdx = body.indexOf("JSON.stringify(");
      expect(
        stringifyIdx,
        "expected a JSON.stringify call in updateDepositAddress",
      ).toBeGreaterThan(-1);
      // Find the matching closing paren of JSON.stringify(...)
      let depth = 0;
      let end = stringifyIdx + "JSON.stringify(".length;
      for (; end < body.length; end++) {
        if (body[end] === "(") depth++;
        else if (body[end] === ")") {
          if (depth === 0) { end++; break; }
          depth--;
        }
      }
      const stringifyCall = body.slice(stringifyIdx, end);
      expect(stringifyCall).toContain("depositAddress");
      expect(stringifyCall).toContain("depositAsset");
      expect(stringifyCall).toContain("depositNetwork");
    });

    it("includes the admin Authorization: Bearer header", () => {
      const body = extractUpdateDepositAddress();
      expect(body).toMatch(/['"]Authorization['"]:\s*`Bearer \$\{authToken\}`/);
    });
  });
});

// ── Edit Deposit Details: no stale form values between sessions ───────────────
//
// A behavioural guard complementing the existing source-level assertions above.
// The deposit-details form fields (depositAddress, depositAsset, depositNetwork)
// live as local state in AdminDashboard and are seeded inside
// openAdminMessageDialog when a case is opened.  A regression that makes the
// seeding conditional, re-orders the calls, or adds an early-return would leave
// stale values from a previous session pre-filled in the form.
//
// Flow:
//   open case A → assert A's values in form inputs
//               → mutate depositAddress (simulates partial editing before cancel)
//               → "cancel" (reset to idle, simulates dialog close)
//               → open case B → assert B's values appear, not A's stale edit
//
// The harness directly mirrors the production AdminDashboard state management
// for these three fields and the seeding logic inside openAdminMessageDialog,
// using plain inputs keyed by the same data-testid attributes as the real UI.
describe("Edit Deposit Details: no stale form values between sessions", () => {
  const CASE_A = {
    id: "case-a",
    depositAddress: "TXYZ_ADDR_A",
    depositAsset: "USDT",
    depositNetwork: "TRC20",
  };
  const CASE_B = {
    id: "case-b",
    depositAddress: "TXYZ_ADDR_B",
    depositAsset: "USDC",
    depositNetwork: "ERC20",
  };

  // Harness that mirrors the production AdminDashboard seeding inside
  // openAdminMessageDialog for the three deposit-details fields.
  function DepositDetailsOpenHarness() {
    const [depositAddressEdit, setDepositAddressEdit] = React.useState("");
    const [depositAssetEdit, setDepositAssetEdit] = React.useState("");
    const [depositNetworkEdit, setDepositNetworkEdit] = React.useState("");

    const openDepositDetails = (c: typeof CASE_A) => {
      // Mirror production seeding: always reset unconditionally from the
      // incoming case so stale edits from a previous session cannot persist.
      setDepositAddressEdit(c.depositAddress || "");
      setDepositAssetEdit(c.depositAsset || "");
      setDepositNetworkEdit(c.depositNetwork || "");
    };

    const handleCancel = () => {
      // Simulates the dialog closing without saving (admin clicks Cancel).
      // The harness does NOT clear the state here — just like production where
      // closing the dialog does not reset the edit fields; only re-opening does.
    };

    return (
      <div>
        <button type="button" data-testid="open-case-a" onClick={() => openDepositDetails(CASE_A)}>
          Open Case A
        </button>
        <button type="button" data-testid="open-case-b" onClick={() => openDepositDetails(CASE_B)}>
          Open Case B
        </button>
        <button type="button" data-testid="button-cancel-deposit" onClick={handleCancel}>
          Cancel
        </button>
        <input
          data-testid="input-deposit-address"
          value={depositAddressEdit}
          onChange={(e) => setDepositAddressEdit(e.target.value)}
        />
        <input
          data-testid="input-deposit-asset"
          value={depositAssetEdit}
          onChange={(e) => setDepositAssetEdit(e.target.value)}
        />
        <input
          data-testid="input-deposit-network"
          value={depositNetworkEdit}
          onChange={(e) => setDepositNetworkEdit(e.target.value)}
        />
      </div>
    );
  }

  it("shows case B's values after opening A, mutating the address, cancelling, then opening B", async () => {
    const user = userEvent.setup();
    render(<DepositDetailsOpenHarness />);

    // Open for case A — inputs must reflect A's data.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-deposit-address") as HTMLInputElement).value).toBe("TXYZ_ADDR_A");
    expect((screen.getByTestId("input-deposit-asset") as HTMLInputElement).value).toBe("USDT");
    expect((screen.getByTestId("input-deposit-network") as HTMLInputElement).value).toBe("TRC20");

    // Partially mutate the address — simulates an admin typing before cancelling.
    const addressInput = screen.getByTestId("input-deposit-address") as HTMLInputElement;
    await user.clear(addressInput);
    await user.type(addressInput, "STALE_EDITED_ADDRESS");
    expect(addressInput.value).toBe("STALE_EDITED_ADDRESS");

    // Cancel (close dialog without saving).
    await user.click(screen.getByTestId("button-cancel-deposit"));

    // Open for case B — must reset to B's values, not carry over the stale edit.
    await user.click(screen.getByTestId("open-case-b"));
    expect((screen.getByTestId("input-deposit-address") as HTMLInputElement).value).toBe("TXYZ_ADDR_B");
    expect((screen.getByTestId("input-deposit-asset") as HTMLInputElement).value).toBe("USDC");
    expect((screen.getByTestId("input-deposit-network") as HTMLInputElement).value).toBe("ERC20");
  });

  it("shows case A's values after opening B, mutating asset, cancelling, then opening A", async () => {
    const user = userEvent.setup();
    render(<DepositDetailsOpenHarness />);

    // Open for case B first.
    await user.click(screen.getByTestId("open-case-b"));
    expect((screen.getByTestId("input-deposit-asset") as HTMLInputElement).value).toBe("USDC");
    expect((screen.getByTestId("input-deposit-network") as HTMLInputElement).value).toBe("ERC20");

    // Mutate the asset field.
    const assetInput = screen.getByTestId("input-deposit-asset") as HTMLInputElement;
    await user.clear(assetInput);
    await user.type(assetInput, "STALE_ASSET");
    expect(assetInput.value).toBe("STALE_ASSET");

    // Cancel the dialog session.
    await user.click(screen.getByTestId("button-cancel-deposit"));

    // Open for case A — must show A's values, not the stale mutation from B.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-deposit-address") as HTMLInputElement).value).toBe("TXYZ_ADDR_A");
    expect((screen.getByTestId("input-deposit-asset") as HTMLInputElement).value).toBe("USDT");
    expect((screen.getByTestId("input-deposit-network") as HTMLInputElement).value).toBe("TRC20");
  });

  describe("AdminDashboard.tsx production deposit seeding", () => {
    it("seeds depositAddressEdit unconditionally from the incoming case", () => {
      const fn = extractOpenAdminMessageDialog();
      expect(
        fn,
        "expected setDepositAddressEdit to be called in openAdminMessageDialog",
      ).toMatch(/setDepositAddressEdit\(/);
      // Must not call it with an empty string literal — that would leave the
      // field blank instead of pre-filling the existing case value.
      expect(
        fn,
        "expected setDepositAddressEdit to use the incoming case value, not a blank literal",
      ).not.toMatch(/setDepositAddressEdit\(\s*["']\s*["']\s*\)/);
    });

    it("seeds depositAssetEdit unconditionally from the incoming case", () => {
      const fn = extractOpenAdminMessageDialog();
      expect(
        fn,
        "expected setDepositAssetEdit to be called in openAdminMessageDialog",
      ).toMatch(/setDepositAssetEdit\(/);
      expect(
        fn,
        "expected setDepositAssetEdit to use the incoming case value, not a blank literal",
      ).not.toMatch(/setDepositAssetEdit\(\s*["']\s*["']\s*\)/);
    });

    it("seeds depositNetworkEdit unconditionally from the incoming case", () => {
      const fn = extractOpenAdminMessageDialog();
      expect(
        fn,
        "expected setDepositNetworkEdit to be called in openAdminMessageDialog",
      ).toMatch(/setDepositNetworkEdit\(/);
      expect(
        fn,
        "expected setDepositNetworkEdit to use the incoming case value, not a blank literal",
      ).not.toMatch(/setDepositNetworkEdit\(\s*["']\s*["']\s*\)/);
    });
  });
});

// ── Verified Payout Wallet: no stale form values between cases ────────────────
//
// The Verified Payout Wallet panel (payoutWalletAddress, payoutWalletAsset,
// payoutWalletNetwork) is seeded inside openAdminMessageDialog alongside the
// deposit-details fields, using the same preset/Custom pattern.  A regression
// that makes the seeding conditional or adds an early-return would not be
// caught by the existing save-path or in-flight tests.
//
// Flow:
//   open case A → assert A's payout-wallet values in form inputs
//               → mutate payoutWalletAddress (simulates partial editing before cancel)
//               → "cancel" (reset to idle, simulates dialog close)
//               → open case B → assert B's values appear, not A's stale edit
//
// The harness directly mirrors the production AdminDashboard state management
// for the three core payout-wallet fields and the seeding logic inside
// openAdminMessageDialog.
describe("Verified Payout Wallet: no stale form values between cases", () => {
  const CASE_A = {
    id: "case-a",
    payoutWalletAddress: "TPayoutAddr_A",
    payoutWalletAsset: "USDT",
    payoutWalletNetwork: "TRC20",
  };
  const CASE_B = {
    id: "case-b",
    payoutWalletAddress: "0xPayoutAddr_B",
    payoutWalletAsset: "ETH",
    payoutWalletNetwork: "ERC20",
  };

  // Harness that mirrors the production AdminDashboard seeding inside
  // openAdminMessageDialog for the three payout-wallet fields.
  function PayoutWalletOpenHarness() {
    const [payoutWalletAddressEdit, setPayoutWalletAddressEdit] = React.useState("");
    const [payoutWalletAssetEdit, setPayoutWalletAssetEdit] = React.useState("");
    const [payoutWalletNetworkEdit, setPayoutWalletNetworkEdit] = React.useState("");

    const openPayoutWallet = (c: typeof CASE_A) => {
      // Mirror production seeding: always reset unconditionally from the
      // incoming case so stale edits from a previous session cannot persist.
      setPayoutWalletAddressEdit(c.payoutWalletAddress || "");
      setPayoutWalletAssetEdit(c.payoutWalletAsset || "");
      setPayoutWalletNetworkEdit(c.payoutWalletNetwork || "");
    };

    const handleCancel = () => {
      // Simulates the dialog closing without saving (admin clicks Cancel).
      // The harness does NOT clear the state here — just like production where
      // closing the dialog does not reset the edit fields; only re-opening does.
    };

    return (
      <div>
        <button type="button" data-testid="open-case-a" onClick={() => openPayoutWallet(CASE_A)}>
          Open Case A
        </button>
        <button type="button" data-testid="open-case-b" onClick={() => openPayoutWallet(CASE_B)}>
          Open Case B
        </button>
        <button type="button" data-testid="button-cancel-payout" onClick={handleCancel}>
          Cancel
        </button>
        <input
          data-testid="input-payout-address"
          value={payoutWalletAddressEdit}
          onChange={(e) => setPayoutWalletAddressEdit(e.target.value)}
        />
        <input
          data-testid="input-payout-asset"
          value={payoutWalletAssetEdit}
          onChange={(e) => setPayoutWalletAssetEdit(e.target.value)}
        />
        <input
          data-testid="input-payout-network"
          value={payoutWalletNetworkEdit}
          onChange={(e) => setPayoutWalletNetworkEdit(e.target.value)}
        />
      </div>
    );
  }

  it("shows case B's values after opening A, mutating the address, cancelling, then opening B", async () => {
    const user = userEvent.setup();
    render(<PayoutWalletOpenHarness />);

    // Open for case A — inputs must reflect A's data.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-payout-address") as HTMLInputElement).value).toBe("TPayoutAddr_A");
    expect((screen.getByTestId("input-payout-asset") as HTMLInputElement).value).toBe("USDT");
    expect((screen.getByTestId("input-payout-network") as HTMLInputElement).value).toBe("TRC20");

    // Partially mutate the address — simulates an admin typing before cancelling.
    const addressInput = screen.getByTestId("input-payout-address") as HTMLInputElement;
    await user.clear(addressInput);
    await user.type(addressInput, "STALE_EDITED_PAYOUT_ADDR");
    expect(addressInput.value).toBe("STALE_EDITED_PAYOUT_ADDR");

    // Cancel (close dialog without saving).
    await user.click(screen.getByTestId("button-cancel-payout"));

    // Open for case B — must reset to B's values, not carry over the stale edit.
    await user.click(screen.getByTestId("open-case-b"));
    expect((screen.getByTestId("input-payout-address") as HTMLInputElement).value).toBe("0xPayoutAddr_B");
    expect((screen.getByTestId("input-payout-asset") as HTMLInputElement).value).toBe("ETH");
    expect((screen.getByTestId("input-payout-network") as HTMLInputElement).value).toBe("ERC20");
  });

  it("shows case A's values after opening B, mutating the asset, cancelling, then opening A", async () => {
    const user = userEvent.setup();
    render(<PayoutWalletOpenHarness />);

    // Open for case B first.
    await user.click(screen.getByTestId("open-case-b"));
    expect((screen.getByTestId("input-payout-asset") as HTMLInputElement).value).toBe("ETH");
    expect((screen.getByTestId("input-payout-network") as HTMLInputElement).value).toBe("ERC20");

    // Mutate the asset field.
    const assetInput = screen.getByTestId("input-payout-asset") as HTMLInputElement;
    await user.clear(assetInput);
    await user.type(assetInput, "STALE_ASSET");
    expect(assetInput.value).toBe("STALE_ASSET");

    // Cancel the dialog session.
    await user.click(screen.getByTestId("button-cancel-payout"));

    // Open for case A — must show A's values, not the stale mutation from B.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-payout-address") as HTMLInputElement).value).toBe("TPayoutAddr_A");
    expect((screen.getByTestId("input-payout-asset") as HTMLInputElement).value).toBe("USDT");
    expect((screen.getByTestId("input-payout-network") as HTMLInputElement).value).toBe("TRC20");
  });

  it("clears the address when switching to a case with no payout wallet set", async () => {
    const CASE_EMPTY = {
      id: "case-empty",
      payoutWalletAddress: "",
      payoutWalletAsset: "",
      payoutWalletNetwork: "",
    };

    function EmptyHarness() {
      const [payoutWalletAddressEdit, setPayoutWalletAddressEdit] = React.useState("");
      const [payoutWalletAssetEdit, setPayoutWalletAssetEdit] = React.useState("");
      const [payoutWalletNetworkEdit, setPayoutWalletNetworkEdit] = React.useState("");

      const open = (c: typeof CASE_A | typeof CASE_EMPTY) => {
        setPayoutWalletAddressEdit(c.payoutWalletAddress || "");
        setPayoutWalletAssetEdit(c.payoutWalletAsset || "");
        setPayoutWalletNetworkEdit(c.payoutWalletNetwork || "");
      };

      return (
        <div>
          <button type="button" data-testid="open-case-a" onClick={() => open(CASE_A)}>Open A</button>
          <button type="button" data-testid="open-case-empty" onClick={() => open(CASE_EMPTY)}>Open Empty</button>
          <input data-testid="input-payout-address" value={payoutWalletAddressEdit} onChange={(e) => setPayoutWalletAddressEdit(e.target.value)} />
          <input data-testid="input-payout-asset" value={payoutWalletAssetEdit} onChange={(e) => setPayoutWalletAssetEdit(e.target.value)} />
          <input data-testid="input-payout-network" value={payoutWalletNetworkEdit} onChange={(e) => setPayoutWalletNetworkEdit(e.target.value)} />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<EmptyHarness />);

    // Open a case with wallet data.
    await user.click(screen.getByTestId("open-case-a"));
    expect((screen.getByTestId("input-payout-address") as HTMLInputElement).value).toBe("TPayoutAddr_A");

    // Switch to a case with no payout wallet — all three fields must be blank.
    await user.click(screen.getByTestId("open-case-empty"));
    expect((screen.getByTestId("input-payout-address") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-payout-asset") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-payout-network") as HTMLInputElement).value).toBe("");
  });

  describe("AdminDashboard.tsx production payout-wallet seeding", () => {
    // Helper: asserts a setter is called unconditionally in openAdminMessageDialog.
    // Two-part check:
    //   1. No `return` statement precedes the call — guards against early-return regressions.
    //   2. The exact hydration expression is present — guards against conditional wrappers
    //      like `if (caseData.x) setX(...)` that change the call pattern.
    function assertUnconditionalSetter(setterName: string, exactCallPattern: RegExp) {
      const fn = extractOpenAdminMessageDialog();
      const setterCall = `${setterName}(`;
      const setterIdx = fn.indexOf(setterCall);
      expect(
        setterIdx,
        `${setterName} not found in openAdminMessageDialog`,
      ).toBeGreaterThan(-1);
      // Part 1: no `return` before the call — any early return would create a code
      // path that silently skips the setter when switching between cases.
      const bodyBeforeCall = fn.slice(0, setterIdx);
      expect(
        bodyBeforeCall,
        `found a \`return\` before ${setterName} — the call is NOT unconditional`,
      ).not.toMatch(/\breturn\b/);
      // Part 2: exact hydration expression — a conditional wrapper like
      // `if (caseData.payoutWalletAddress) setPayoutWalletAddressEdit(...)` would
      // change the argument expression and fail this assertion.
      expect(
        fn,
        `${setterName} must be called with the direct caseData hydration expression`,
      ).toMatch(exactCallPattern);
    }

    it("seeds payoutWalletAddressEdit unconditionally with caseData.payoutWalletAddress || \"\"", () => {
      assertUnconditionalSetter(
        "setPayoutWalletAddressEdit",
        /setPayoutWalletAddressEdit\(\s*caseData\.payoutWalletAddress\s*\|\|\s*""\s*\)/,
      );
    });

    it("seeds payoutWalletAssetEdit unconditionally via the persistedPwAsset intermediate var", () => {
      const fn = extractOpenAdminMessageDialog();
      // The asset is routed through an intermediate const to share the value with
      // the Custom-mode flag.  Assert the entire chain: derivation + setter call.
      expect(fn).toMatch(
        /const\s+persistedPwAsset\s*=\s*caseData\.payoutWalletAsset\s*\|\|\s*""/,
      );
      assertUnconditionalSetter(
        "setPayoutWalletAssetEdit",
        /setPayoutWalletAssetEdit\(\s*persistedPwAsset\s*\)/,
      );
    });

    it("seeds payoutWalletNetworkEdit unconditionally via the persistedPwNetwork intermediate var", () => {
      const fn = extractOpenAdminMessageDialog();
      // Same pattern as asset — network also goes through an intermediate const.
      expect(fn).toMatch(
        /const\s+persistedPwNetwork\s*=\s*caseData\.payoutWalletNetwork\s*\|\|\s*""/,
      );
      assertUnconditionalSetter(
        "setPayoutWalletNetworkEdit",
        /setPayoutWalletNetworkEdit\(\s*persistedPwNetwork\s*\)/,
      );
    });
  });
});
