// @vitest-environment jsdom
//
// Regression guard: the Quick Send "Templates" panel and the unread-message
// badge / notification-sound trigger in the visitor chat UI
// (client/src/pages/admin/Conversations.tsx).
//
// Covers:
//   1. The templates toggle button is present when chat templates exist,
//      and clicking it opens the templates panel.
//   2. Selecting a template from the panel pre-fills the compose input
//      with the template's content and closes the panel.
//   3. The unread-count badge renders with the correct count for the right
//      conversation row (and stays hidden for rows with no unread messages).
//   4. `playNotificationSound` fires when a new user message arrives via
//      `loadChatMessages` across two polls, and does NOT fire for a
//      newly-arrived admin-authored message.
//
// Relevant source:
//   - client/src/pages/admin/Conversations.tsx — chat compose UI, badges,
//     loadChatMessages polling
//   - client/src/pages/admin/AdminContext.tsx  — chatTemplates/unreadCounts state

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { mockToast, baseCase, secondCase, chatTemplates, mockAdminState, defaultAdminState } = vi.hoisted(() => {
  const mockToast = vi.fn();

  const baseCase = {
    id: "case-1",
    accessCode: "ABC123",
    status: "active" as const,
    userName: "Jane Doe",
    userEmail: "jane@example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const secondCase = {
    id: "case-2",
    accessCode: "XYZ789",
    status: "active" as const,
    userName: "John Smith",
    userEmail: "john@example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const chatTemplates = [
    { id: 1, name: "Greeting", content: "Hello, thanks for reaching out!", isActive: true, createdAt: new Date().toISOString() },
    { id: 2, name: "Follow-up", content: "Just following up on your case.", isActive: true, createdAt: new Date().toISOString() },
  ];

  const defaultAdminState = () => ({
    cases: [baseCase],
    chatCase: baseCase,
    setChatCase: vi.fn(),
    chatMessages: [] as any[],
    setChatMessages: vi.fn(),
    unreadCounts: {} as Record<string, number>,
    chatTemplates,
    authToken: "test-token",
    toast: mockToast,
    lastMessageCountRef: { current: {} as Record<string, number> },
    isInitialLoadRef: { current: true },
  });

  const mockAdminState: { current: ReturnType<typeof defaultAdminState> } = { current: defaultAdminState() };

  return { mockToast, baseCase, secondCase, chatTemplates, mockAdminState, defaultAdminState };
});

vi.mock("../AdminContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../AdminContext")>();
  return {
    ...actual,
    useAdmin: () => mockAdminState.current,
    playNotificationSound: vi.fn(),
  };
});

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => {
        const map: Record<string, string> = {
          "conversations.templates": "Templates",
          "conversations.inputPlaceholder": "Type your message…",
        };
        return map[key] ?? key;
      },
    }),
  };
});

import { Conversations } from "../Conversations";
import { playNotificationSound } from "../AdminContext";

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminState.current = defaultAdminState();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe("Conversations — Quick Send templates panel", () => {
  it("shows the templates toggle button and opens the panel on click", async () => {
    render(<Conversations />);

    const toggle = screen.getByTestId("button-chat-templates-toggle");
    expect(toggle).toBeInTheDocument();

    expect(screen.queryByTestId("panel-chat-templates")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    const panel = await screen.findByTestId("panel-chat-templates");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("chat-template-1")).toHaveTextContent("Greeting");
    expect(screen.getByTestId("chat-template-2")).toHaveTextContent("Follow-up");
  });

  it("pre-fills the compose input when a template is selected and closes the panel", async () => {
    render(<Conversations />);

    fireEvent.click(screen.getByTestId("button-chat-templates-toggle"));
    const templateItem = await screen.findByTestId("chat-template-1");
    fireEvent.click(templateItem);

    const input = screen.getByTestId("input-admin-chat") as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe("Hello, thanks for reaching out!");
    });

    expect(screen.queryByTestId("panel-chat-templates")).not.toBeInTheDocument();
  });

  it("posts a usage-increment request with the auth header when a template is selected", async () => {
    render(<Conversations />);

    fireEvent.click(screen.getByTestId("button-chat-templates-toggle"));
    const templateItem = await screen.findByTestId("chat-template-1");
    fireEvent.click(templateItem);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/chat-templates/1/use",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });
  });

  it("still pre-fills the compose input when the usage-increment request rejects", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    render(<Conversations />);

    fireEvent.click(screen.getByTestId("button-chat-templates-toggle"));
    const templateItem = await screen.findByTestId("chat-template-1");
    fireEvent.click(templateItem);

    const input = screen.getByTestId("input-admin-chat") as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe("Hello, thanks for reaching out!");
    });

    expect(screen.queryByTestId("panel-chat-templates")).not.toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});

describe("Conversations — unread-count badges", () => {
  it("renders the unread badge with the correct count for the right conversation row only", () => {
    mockAdminState.current.cases = [baseCase, secondCase];
    mockAdminState.current.unreadCounts = { [baseCase.id]: 3 };

    render(<Conversations />);

    const row1 = screen.getByTestId(`chat-user-${baseCase.id}`);
    expect(row1.querySelector(".animate-pulse")).toHaveTextContent("3");

    const row2 = screen.getByTestId(`chat-user-${secondCase.id}`);
    expect(row2.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });

  it("hides the badge entirely when a conversation has zero unread messages", () => {
    mockAdminState.current.cases = [baseCase];
    mockAdminState.current.unreadCounts = { [baseCase.id]: 0 };

    render(<Conversations />);

    const row = screen.getByTestId(`chat-user-${baseCase.id}`);
    expect(row.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });
});

describe("Conversations — new-message notification sound", () => {
  it("plays the notification sound when a new user message arrives on a later poll", async () => {
    mockAdminState.current.isInitialLoadRef.current = true;
    mockAdminState.current.lastMessageCountRef.current = {};

    let call = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/chat/${baseCase.id}`) {
        call += 1;
        const messages =
          call === 1
            ? [{ id: 1, caseId: baseCase.id, sender: "admin", message: "Hi", isRead: "true", createdAt: new Date().toISOString() }]
            : [
                { id: 1, caseId: baseCase.id, sender: "admin", message: "Hi", isRead: "true", createdAt: new Date().toISOString() },
                { id: 2, caseId: baseCase.id, sender: "user", message: "I need help", isRead: "false", createdAt: new Date().toISOString() },
              ];
        return Promise.resolve({ ok: true, json: async () => messages });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    render(<Conversations />);

    const row = screen.getByTestId(`chat-user-${baseCase.id}`);
    fireEvent.click(row);

    await waitFor(() => {
      expect(call).toBe(1);
    });
    expect(playNotificationSound).not.toHaveBeenCalled();

    fireEvent.click(row);

    await waitFor(() => {
      expect(playNotificationSound).toHaveBeenCalledTimes(1);
    });
  });

  it("does not play the notification sound when the newly-arrived message is admin-authored", async () => {
    mockAdminState.current.isInitialLoadRef.current = true;
    mockAdminState.current.lastMessageCountRef.current = {};

    let call = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/chat/${baseCase.id}`) {
        call += 1;
        const messages =
          call === 1
            ? [{ id: 1, caseId: baseCase.id, sender: "user", message: "Hi", isRead: "true", createdAt: new Date().toISOString() }]
            : [
                { id: 1, caseId: baseCase.id, sender: "user", message: "Hi", isRead: "true", createdAt: new Date().toISOString() },
                { id: 2, caseId: baseCase.id, sender: "admin", message: "On it", isRead: "false", createdAt: new Date().toISOString() },
              ];
        return Promise.resolve({ ok: true, json: async () => messages });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    render(<Conversations />);

    const row = screen.getByTestId(`chat-user-${baseCase.id}`);
    fireEvent.click(row);

    await waitFor(() => {
      expect(call).toBe(1);
    });

    fireEvent.click(row);

    await waitFor(() => {
      expect(call).toBe(2);
    });
    expect(playNotificationSound).not.toHaveBeenCalled();
  });
});
