// @vitest-environment jsdom
//
// Regression test for the community rate-limit UI (Task 2420): when the
// server-side community POST rate limiter (server/routes/community.ts) throttles
// a request with 429, the UI must surface a friendly "slow down" message rather
// than a generic/opaque error, and must NOT show a raw server error string.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/community", vi.fn()],
  useRoute: () => [false, {}],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "fake-session-token",
  hasPortalSession: () => true,
}));

vi.mock("@/components/BuildStampLine", () => ({
  BuildStampLine: () => <div data-testid="build-stamp" />,
}));

// Radix Select relies on DOM APIs (scrollIntoView, pointer capture) that jsdom
// doesn't implement; swap in a plain native <select> so department selection
// works deterministically in this environment without touching Radix internals.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      data-testid="select-thread-department"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">Select a department</option>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

import CommunityPage from "../CommunityPage";

function jsonResponse(body: any, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommunityPage />
    </QueryClientProvider>,
  );
}

describe("CommunityPage — 429 rate-limit surfaces a friendly toast", () => {
  beforeEach(() => {
    toastMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/community/participants/me")) {
          return jsonResponse({ anonymousHandle: "TestUser1" });
        }
        if (url.includes("/api/community/departments")) {
          return jsonResponse([{ id: 1, key: "general", name: "General", description: "", icon: "", color: "#000", displayOrder: "1", isActive: true }]);
        }
        if (url.includes("/api/community/stats")) {
          return jsonResponse({ members: 0, threads: 0, posts: 0, onlineNow: 0 });
        }
        if (url.includes("/api/community/threads") && !url.match(/threads\/[0-9]/)) {
          if ((url as any).method) return jsonResponse([]);
          return jsonResponse([]);
        }
        return jsonResponse([]);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a friendly rate-limit toast (not a raw error) when creating a thread hits 429", async () => {
    (global.fetch as any).mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url === "/api/community/threads") {
        return jsonResponse({ message: "Too many requests. Please try again later." }, 429);
      }
      if (url.includes("/api/community/participants/me")) {
        return jsonResponse({ anonymousHandle: "TestUser1" });
      }
      if (url.includes("/api/community/departments")) {
        return jsonResponse([{ id: 1, key: "general", name: "General", description: "", icon: "", color: "#000", displayOrder: "1", isActive: true }]);
      }
      if (url.includes("/api/community/stats")) {
        return jsonResponse({ members: 0, threads: 0, posts: 0, onlineNow: 0 });
      }
      return jsonResponse([]);
    });

    renderPage();

    const newThreadButton = await screen.findByTestId("button-new-thread");
    fireEvent.click(newThreadButton);

    const titleInput = await screen.findByTestId("input-thread-title");
    const contentInput = await screen.findByTestId("input-thread-content");
    fireEvent.change(titleInput, { target: { value: "Has anyone seen this?" } });
    fireEvent.change(contentInput, { target: { value: "Some details about the situation." } });

    const departmentSelect = screen.getByTestId("select-thread-department");
    fireEvent.change(departmentSelect, { target: { value: "1" } });

    const submitButton = screen.getByTestId("button-submit-thread");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
    });

    const call = toastMock.mock.calls.find((args) => args[0]?.variant === "destructive");
    expect(call, "expected a destructive toast to be shown on 429").toBeDefined();
    const toastArg = call![0];
    // The friendly copy must not simply echo the raw server error string.
    expect(toastArg.description).not.toBe("Too many requests. Please try again later.");
    expect(toastArg.title.toLowerCase()).not.toBe("error");
  });
});
