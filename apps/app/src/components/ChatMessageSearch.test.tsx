// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatMessageSearch } from "./ChatMessageSearch";

const state = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  queryClient: {},
  search: {
    data: {
      pages: [
        {
          data: [
            {
              branch: "active" as const,
              branchLeafMessageId: "message-active",
              createdAt: "2026-08-14T12:00:00.000Z",
              messageId: "message-active",
              role: "user" as const,
              snippet: "Active search result",
            },
            {
              branch: "alternate" as const,
              branchLeafMessageId: "message-alternate",
              createdAt: "2026-08-14T12:01:00.000Z",
              messageId: "message-alternate",
              role: "assistant" as const,
              snippet: "Alternate search result",
            },
          ],
          meta: { total: 2 },
        },
      ],
    },
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isPending: false,
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: () => ({
    ...state.search,
    fetchNextPage: state.fetchNextPage,
  }),
  useQueryClient: () => state.queryClient,
}));
vi.mock("../lib/debounce", () => ({
  useDebouncedValue: (value: string) => value,
}));
vi.mock("../lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  state.fetchNextPage.mockReset();
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("ChatMessageSearch", () => {
  it("announces result count and supports keyboard next, previous, and close", async () => {
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <ChatMessageSearch chatId="chat-1" onNavigate={onNavigate} />,
      ),
    );
    const trigger = button("searchCurrentChat");
    await act(async () => trigger.click());
    const input = container.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "security");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("chatSearchResultCount:2");
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      ),
    );
    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageId: "message-active" }),
    );
    expect(window.location.hash).toBe("#message-message-active");
    expect(container.textContent).toContain("activeChatBranch");

    act(() => button("nextChatSearchResult").click());
    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageId: "message-alternate" }),
    );
    expect(container.textContent).toContain("alternateChatBranch");
    act(() => button("previousChatSearchResult").click());
    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageId: "message-active" }),
    );

    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      ),
    );
    expect(container.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(button("searchCurrentChat"));
  });
});

function button(label: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(match).not.toBeNull();
  return match!;
}
