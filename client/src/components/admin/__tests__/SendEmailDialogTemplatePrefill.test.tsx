// @vitest-environment jsdom
//
// Tests for SendEmailDialog — quick-send template pre-fill.
//
// Contracts verified:
//   1. Clicking a template button calls setEmailSubject and setEmailBody with
//      the values produced by the template's getSubject / getBody for the
//      case's current withdrawal stage and user name.
//   2. When the case has no withdrawal stage the template falls back to the
//      generic "your current stage" string.
//   3. Templates that ignore the stage (deposit_received, processing_update,
//      clarification_followup) still call both setters with non-empty strings.

import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ── mock react-i18next so the dialog doesn't need a live i18n provider ────────
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
  };
});

// ── import helpers that must be available before the component loads ──────────
import { QUICK_SEND_TEMPLATES, STAGE_SHORT_LABELS } from "@/lib/adminEmailTemplates";
import { SendEmailDialog } from "../SendEmailDialog";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Thin wrapper so we can use controlled state inside tests. */
function DialogWrapper({
  selectedCase,
  setEmailSubject,
  setEmailBody,
}: {
  selectedCase: Parameters<typeof SendEmailDialog>[0]["selectedCase"];
  setEmailSubject: (v: string) => void;
  setEmailBody: (v: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <SendEmailDialog
      open={true}
      onOpenChange={() => {}}
      selectedCase={selectedCase}
      emailSubject={subject}
      setEmailSubject={(v) => {
        const next = typeof v === "function" ? v(subject) : v;
        setSubject(next);
        setEmailSubject(next);
      }}
      emailBody={body}
      setEmailBody={(v) => {
        const next = typeof v === "function" ? v(body) : v;
        setBody(next);
        setEmailBody(next);
      }}
      isSendingEmail={false}
      sendEmail={() => {}}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Radix Dialog uses ResizeObserver.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (
    !(Element.prototype as unknown as { hasPointerCapture?: unknown })
      .hasPointerCapture
  ) {
    (
      Element.prototype as unknown as { hasPointerCapture: () => boolean }
    ).hasPointerCapture = () => false;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CASE_WITH_STAGE = {
  id: "case-email-1",
  accessCode: "EMAILTEST1",
  status: "active" as const,
  userName: "Alice Smith",
  userEmail: "alice@example.com",
  withdrawalStage: "3", // Phrase Key Approved & Available
};

const CASE_NO_STAGE = {
  id: "case-email-2",
  accessCode: "EMAILTEST2",
  status: "active" as const,
  userName: "Bob Jones",
  userEmail: "bob@example.com",
  withdrawalStage: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Template pre-fill — case with a withdrawal stage
// ─────────────────────────────────────────────────────────────────────────────

describe("SendEmailDialog — template pre-fill (case with withdrawal stage)", () => {
  it.each(QUICK_SEND_TEMPLATES)(
    'clicking "$label" calls setEmailSubject and setEmailBody',
    async ({ id, label: _label, getSubject, getBody }) => {
      const setEmailSubject = vi.fn();
      const setEmailBody = vi.fn();

      render(
        <DialogWrapper
          selectedCase={CASE_WITH_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
          setEmailSubject={setEmailSubject}
          setEmailBody={setEmailBody}
        />,
      );

      const btn = await screen.findByTestId(`quick-template-${id}`);
      fireEvent.click(btn);

      // Both setters must have been called exactly once.
      expect(setEmailSubject).toHaveBeenCalledTimes(1);
      expect(setEmailBody).toHaveBeenCalledTimes(1);

      // The subject and body must match what the template functions produce.
      const stageNum = 3;
      const stageName = STAGE_SHORT_LABELS[stageNum] ?? "your current stage";
      expect(setEmailSubject).toHaveBeenCalledWith(getSubject(stageName));
      expect(setEmailBody).toHaveBeenCalledWith(
        getBody(CASE_WITH_STAGE.userName, stageName, stageNum),
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Template pre-fill — case without a withdrawal stage
// ─────────────────────────────────────────────────────────────────────────────

describe("SendEmailDialog — template pre-fill (case without withdrawal stage)", () => {
  it.each(QUICK_SEND_TEMPLATES)(
    'clicking "$label" calls setEmailSubject and setEmailBody with generic stage',
    async ({ id, label: _label, getSubject, getBody }) => {
      const setEmailSubject = vi.fn();
      const setEmailBody = vi.fn();

      render(
        <DialogWrapper
          selectedCase={CASE_NO_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
          setEmailSubject={setEmailSubject}
          setEmailBody={setEmailBody}
        />,
      );

      const btn = await screen.findByTestId(`quick-template-${id}`);
      fireEvent.click(btn);

      expect(setEmailSubject).toHaveBeenCalledTimes(1);
      expect(setEmailBody).toHaveBeenCalledTimes(1);

      // When there is no stage, the component uses "your current stage".
      const fallbackStageName = "your current stage";
      expect(setEmailSubject).toHaveBeenCalledWith(
        getSubject(fallbackStageName),
      );
      expect(setEmailBody).toHaveBeenCalledWith(
        getBody(CASE_NO_STAGE.userName, fallbackStageName, null),
      );
    },
  );

  it("shows the 'No withdrawal stage set' notice when case has no stage", async () => {
    render(
      <DialogWrapper
        selectedCase={CASE_NO_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
        setEmailSubject={vi.fn()}
        setEmailBody={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/No withdrawal stage set/i),
      ).toBeTruthy(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dialog structure
// ─────────────────────────────────────────────────────────────────────────────

describe("SendEmailDialog — structure", () => {
  it("renders all 5 template buttons", async () => {
    render(
      <DialogWrapper
        selectedCase={CASE_WITH_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
        setEmailSubject={vi.fn()}
        setEmailBody={vi.fn()}
      />,
    );

    for (const tpl of QUICK_SEND_TEMPLATES) {
      expect(
        await screen.findByTestId(`quick-template-${tpl.id}`),
      ).toBeTruthy();
    }
  });

  it("renders subject and body inputs", async () => {
    render(
      <DialogWrapper
        selectedCase={CASE_WITH_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
        setEmailSubject={vi.fn()}
        setEmailBody={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("input-email-subject")).toBeTruthy();
    expect(await screen.findByTestId("input-email-body")).toBeTruthy();
  });

  it("shows current stage context when withdrawalStage is set", async () => {
    render(
      <DialogWrapper
        selectedCase={CASE_WITH_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
        setEmailSubject={vi.fn()}
        setEmailBody={vi.fn()}
      />,
    );

    // The stage label "Stage 3 — Phrase Key Approved & Available" must appear.
    await waitFor(() =>
      expect(
        screen.getByText(/Stage 3 — Phrase Key Approved & Available/),
      ).toBeTruthy(),
    );
  });

  it("hides template buttons after clicking the collapse toggle", async () => {
    render(
      <DialogWrapper
        selectedCase={CASE_WITH_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
        setEmailSubject={vi.fn()}
        setEmailBody={vi.fn()}
      />,
    );

    // Templates are visible by default.
    expect(
      await screen.findByTestId(`quick-template-${QUICK_SEND_TEMPLATES[0].id}`),
    ).toBeTruthy();

    // Click the toggle to collapse.
    const toggleBtn = screen.getByRole("button", { name: /quick templates/i });
    fireEvent.click(toggleBtn);

    // All template buttons must be removed from the DOM.
    for (const tpl of QUICK_SEND_TEMPLATES) {
      expect(
        screen.queryByTestId(`quick-template-${tpl.id}`),
      ).toBeNull();
    }
  });

  it("re-shows template buttons after toggling collapse then expand", async () => {
    render(
      <DialogWrapper
        selectedCase={CASE_WITH_STAGE as unknown as Parameters<typeof SendEmailDialog>[0]["selectedCase"]}
        setEmailSubject={vi.fn()}
        setEmailBody={vi.fn()}
      />,
    );

    // Wait for initial render.
    await screen.findByTestId(`quick-template-${QUICK_SEND_TEMPLATES[0].id}`);

    const toggleBtn = screen.getByRole("button", { name: /quick templates/i });

    // Collapse.
    fireEvent.click(toggleBtn);
    expect(
      screen.queryByTestId(`quick-template-${QUICK_SEND_TEMPLATES[0].id}`),
    ).toBeNull();

    // Expand again.
    fireEvent.click(toggleBtn);

    // All template buttons must be back in the DOM.
    for (const tpl of QUICK_SEND_TEMPLATES) {
      expect(
        await screen.findByTestId(`quick-template-${tpl.id}`),
      ).toBeTruthy();
    }
  });
});
