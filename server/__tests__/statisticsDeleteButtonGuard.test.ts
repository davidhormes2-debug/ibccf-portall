// @vitest-environment node
//
// Source-assertion guard: verifies that the statistics tab in
// ContentManagement.tsx retains its delete-button wiring.
//
// Checked invariants:
//   1. Each statistics row renders a button with data-testid matching
//      `button-delete-stat-${stat.id}` (dynamic testid guard).
//   2. The delete action is gated behind a `confirm(...)` call so the user
//      cannot delete by accident.
//   3. The mutation uses the DELETE HTTP method against the correct endpoint
//      (/api/admin/content/statistics/${id}).
//   4. On success the statistics query key is invalidated so the list
//      re-fetches automatically.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = readFileSync(
  resolve(__dirname, "../../client/src/components/admin/ContentManagement.tsx"),
  "utf-8",
);

describe("ContentManagement.tsx — statistics delete-button source guard", () => {
  it("renders a delete button with a data-testid that encodes the stat id", () => {
    expect(
      SRC,
      [
        "Expected ContentManagement.tsx to contain a delete button with",
        'data-testid={`button-delete-stat-${stat.id}`}.',
        "A future refactor may have removed or renamed the testid.",
      ].join(" "),
    ).toContain("button-delete-stat-${stat.id}");
  });

  it("gates the delete behind a confirm() call", () => {
    expect(
      SRC,
      [
        "Expected ContentManagement.tsx to call confirm() before deleting a statistic.",
        "The confirm guard prevents accidental deletes; re-add it to the delete handler.",
      ].join(" "),
    ).toMatch(/confirm\s*\(/);
  });

  it("the deleteStatMutation mutationFn uses the DELETE HTTP method", () => {
    expect(
      SRC,
      [
        'Expected deleteStatMutation to call apiRequest with method: "DELETE".',
        "Without this, the delete button sends the wrong HTTP verb.",
      ].join(" "),
    ).toMatch(/deleteStatMutation[\s\S]{0,400}method:\s*["']DELETE["']/);
  });

  it("the deleteStatMutation mutationFn targets the statistics endpoint", () => {
    expect(
      SRC,
      [
        "Expected deleteStatMutation to call the /api/admin/content/statistics/${id} endpoint.",
        "Without this, the delete button points at the wrong URL.",
      ].join(" "),
    ).toContain("/api/admin/content/statistics/${id}");
  });

  it("on success the statistics query key is invalidated so the list re-fetches", () => {
    expect(
      SRC,
      [
        'Expected deleteStatMutation.onSuccess to call queryClient.invalidateQueries',
        'with the "/api/admin/content/statistics" query key.',
        "Without this, the statistics list does not refresh after a delete.",
      ].join(" "),
    ).toContain("/api/admin/content/statistics");

    expect(
      SRC,
      [
        "Expected deleteStatMutation.onSuccess block to call invalidateQueries.",
        "Without it, the list stays stale after a successful delete.",
      ].join(" "),
    ).toMatch(/deleteStatMutation[\s\S]{0,500}invalidateQueries/);
  });
});
