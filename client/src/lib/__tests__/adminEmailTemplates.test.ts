// @vitest-environment jsdom
//
// Unit tests for adminEmailTemplates — covers STAGE_SHORT_LABELS and every
// QUICK_SEND_TEMPLATES entry.
//
// Contracts verified:
//   1. STAGE_SHORT_LABELS maps every known stage number to a non-empty string.
//   2. Each template's getSubject interpolates the stageName correctly.
//   3. Each template's getBody includes the userName (or "Valued Client" when
//      the name is blank) and the stageName.
//   4. The stage_instructions template embeds stage-specific instructions when
//      a valid stageNum is provided, and falls back to generic copy when not.

import { describe, it, expect } from "vitest";
import {
  QUICK_SEND_TEMPLATES,
  STAGE_SHORT_LABELS,
} from "../adminEmailTemplates";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTemplate(id: string) {
  const tpl = QUICK_SEND_TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error(`Template "${id}" not found`);
  return tpl;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE_SHORT_LABELS
// ─────────────────────────────────────────────────────────────────────────────

describe("STAGE_SHORT_LABELS", () => {
  it("maps all 14 stage numbers to non-empty label strings", () => {
    for (let stage = 1; stage <= 14; stage++) {
      expect(STAGE_SHORT_LABELS[stage]).toBeTruthy();
      expect(typeof STAGE_SHORT_LABELS[stage]).toBe("string");
    }
  });

  it("returns the correct title for stage 3", () => {
    expect(STAGE_SHORT_LABELS[3]).toBe("Phrase Key Approved & Available");
  });

  it("returns the correct title for stage 1", () => {
    expect(STAGE_SHORT_LABELS[1]).toBe("Phrase Key Deposit Received");
  });

  it("returns the correct title for stage 14", () => {
    expect(STAGE_SHORT_LABELS[14]).toBe("Time-Stamp Deposit for Final Delivery");
  });

  it("does not contain an entry for stage 0", () => {
    expect(STAGE_SHORT_LABELS[0]).toBeUndefined();
  });

  it("does not contain an entry for stage 15", () => {
    expect(STAGE_SHORT_LABELS[15]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUICK_SEND_TEMPLATES — exhaustive list
// ─────────────────────────────────────────────────────────────────────────────

describe("QUICK_SEND_TEMPLATES — catalogue", () => {
  it("contains exactly 5 templates", () => {
    expect(QUICK_SEND_TEMPLATES).toHaveLength(5);
  });

  it("exports the expected template ids in order", () => {
    const ids = QUICK_SEND_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual([
      "stage_instructions",
      "withdrawal_reminder",
      "deposit_received",
      "processing_update",
      "clarification_followup",
    ]);
  });

  it("every template has a non-empty label string", () => {
    for (const tpl of QUICK_SEND_TEMPLATES) {
      expect(tpl.label).toBeTruthy();
      expect(typeof tpl.label).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stage_instructions template
// ─────────────────────────────────────────────────────────────────────────────

describe('template: "stage_instructions"', () => {
  const tpl = getTemplate("stage_instructions");

  describe("getSubject", () => {
    it("interpolates the stageName", () => {
      expect(tpl.getSubject("Phrase Key Approved & Available")).toBe(
        "Your Case Update — Phrase Key Approved & Available",
      );
    });

    it("uses 'your current stage' verbatim when passed", () => {
      expect(tpl.getSubject("your current stage")).toContain(
        "your current stage",
      );
    });
  });

  describe("getBody — with a valid stageNum", () => {
    const body = tpl.getBody("Alice", "Phrase Key Approved & Available", 3);

    it("addresses the user by name", () => {
      expect(body).toContain("Dear Alice");
    });

    it("includes the stage number", () => {
      expect(body).toContain("Stage 3");
    });

    it("includes the stage title", () => {
      expect(body).toContain("Phrase Key Approved & Available");
    });

    it("includes a WHAT TO DO section", () => {
      expect(body).toContain("WHAT TO DO");
    });

    it("includes a WHAT TO EXPECT section", () => {
      expect(body).toContain("WHAT TO EXPECT");
    });

    it("ends with the IBCCF sign-off", () => {
      expect(body).toContain("IBCCF Compliance Management Team");
    });
  });

  describe("getBody — without a stageNum (generic fallback)", () => {
    const body = tpl.getBody("Bob", "your current stage", null);

    it("addresses the user by name", () => {
      expect(body).toContain("Dear Bob");
    });

    it("uses generic portal instructions (no WHAT TO DO section)", () => {
      expect(body).not.toContain("WHAT TO DO");
      expect(body).toContain("log in to your secure portal");
    });

    it("ends with the IBCCF sign-off", () => {
      expect(body).toContain("IBCCF Compliance Management Team");
    });
  });

  describe("getBody — blank userName falls back to 'Valued Client'", () => {
    it("uses 'Valued Client' when userName is empty string", () => {
      expect(tpl.getBody("", "Phrase Key Approved & Available", 3)).toContain(
        "Dear Valued Client",
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withdrawal_reminder template
// ─────────────────────────────────────────────────────────────────────────────

describe('template: "withdrawal_reminder"', () => {
  const tpl = getTemplate("withdrawal_reminder");

  it("subject includes 'Reminder' and the stage name", () => {
    const subject = tpl.getSubject("Initial Deposit Verification");
    expect(subject).toContain("Reminder");
    expect(subject).toContain("Initial Deposit Verification");
  });

  it("body addresses user by name", () => {
    const body = tpl.getBody("Carol", "Initial Deposit Verification", 5);
    expect(body).toContain("Dear Carol");
  });

  it("body includes the stage name", () => {
    const body = tpl.getBody("Carol", "Initial Deposit Verification", 5);
    expect(body).toContain("Initial Deposit Verification");
  });

  it("body ends with the IBCCF sign-off", () => {
    const body = tpl.getBody("Carol", "Initial Deposit Verification", 5);
    expect(body).toContain("IBCCF Compliance Management Team");
  });

  it("falls back to 'Valued Client' when userName is blank", () => {
    const body = tpl.getBody("", "Initial Deposit Verification", 5);
    expect(body).toContain("Dear Valued Client");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deposit_received template
// ─────────────────────────────────────────────────────────────────────────────

describe('template: "deposit_received"', () => {
  const tpl = getTemplate("deposit_received");

  it("subject mentions deposit received regardless of stage", () => {
    expect(tpl.getSubject("any stage")).toContain("Deposit Received");
  });

  it("body addresses user by name", () => {
    expect(tpl.getBody("Dave", "any stage", null)).toContain("Dear Dave");
  });

  it("body states no further action is required", () => {
    expect(tpl.getBody("Dave", "any stage", null)).toContain(
      "No further action is required",
    );
  });

  it("falls back to 'Valued Client' when userName is blank", () => {
    expect(tpl.getBody("", "any stage", null)).toContain("Dear Valued Client");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processing_update template
// ─────────────────────────────────────────────────────────────────────────────

describe('template: "processing_update"', () => {
  const tpl = getTemplate("processing_update");

  it("subject mentions processing update", () => {
    expect(tpl.getSubject("any stage")).toContain("Processing Update");
  });

  it("body addresses user by name", () => {
    expect(tpl.getBody("Eve", "any stage", null)).toContain("Dear Eve");
  });

  it("body mentions the withdrawal is being processed", () => {
    expect(tpl.getBody("Eve", "any stage", null)).toContain(
      "withdrawal is currently being processed",
    );
  });

  it("falls back to 'Valued Client' when userName is blank", () => {
    expect(tpl.getBody("", "any stage", null)).toContain("Dear Valued Client");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clarification_followup template
// ─────────────────────────────────────────────────────────────────────────────

describe('template: "clarification_followup"', () => {
  const tpl = getTemplate("clarification_followup");

  it("subject mentions 'Please Review and Follow Up'", () => {
    expect(tpl.getSubject("any stage")).toContain("Please Review and Follow Up");
  });

  it("body addresses user by name", () => {
    expect(tpl.getBody("Frank", "any stage", null)).toContain("Dear Frank");
  });

  it("body includes placeholder for admin message", () => {
    expect(tpl.getBody("Frank", "any stage", null)).toContain(
      "[Add your message here]",
    );
  });

  it("falls back to 'Valued Client' when userName is blank", () => {
    expect(tpl.getBody("", "any stage", null)).toContain("Dear Valued Client");
  });
});
