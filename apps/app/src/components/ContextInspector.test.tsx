// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedRunContext } from "../lib/persisted-run-context-query";
import { ContextInspector } from "./ContextInspector";

const state = vi.hoisted(() => ({
  query: {
    data: undefined as { data: PersistedRunContext | null } | undefined,
    error: null as unknown,
    isError: false,
    isPending: false,
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => state.query,
}));
vi.mock("../lib/i18n", () => ({
  useLocale: () => ({
    locale: "en",
    t: (key: string, values?: Record<string, number>) =>
      values === undefined ? key : `${key}:${Object.values(values).join("/")}`,
  }),
}));

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  state.query.data = { data: contextFixture() };
  state.query.error = null;
  state.query.isError = false;
  state.query.isPending = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("ContextInspector", () => {
  it("renders bounded persisted provenance and restores focus after Escape", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            inspect
          </button>
          {open ? (
            <ContextInspector
              chatId="chat-context"
              loading={false}
              onClose={() => setOpen(false)}
              preview={{
                attachments: {
                  currentFiles: [],
                  pendingImages: 0,
                  retainedDocuments: [],
                  retainedImages: 0,
                },
                budget: {
                  estimatedInputTokens: 10,
                  remainingInputTokens: 90,
                  usableInputTokens: 100,
                },
                history: {
                  availableMessages: 1,
                  includedMessages: 1,
                  truncated: false,
                },
                knowledge: [],
                memories: [],
                messages: [
                  {
                    content: "hidden-system-and-provider-body",
                    imageCount: 0,
                    role: "system",
                  },
                ],
                model: {
                  contextWindow: 100,
                  id: "model-safe",
                  name: "Safe model",
                },
                routing: {
                  candidateCount: 1,
                  mode: "selected",
                  requestedModelId: "model-safe",
                  selectedModelId: "model-safe",
                },
              }}
            />
          ) : null}
        </>
      );
    }

    act(() => root.render(<Harness />));
    const trigger = container.querySelector("button")!;
    trigger.focus();
    await act(async () => trigger.click());

    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "closeContextInspector",
    );
    expect(container.textContent).toContain("Visible user request");
    expect(container.textContent).toContain("Current source label");
    expect(container.textContent).toContain("contextSourcesRevoked:1");
    expect(container.textContent).toContain("tool-safe");
    expect(container.textContent).not.toContain(
      "hidden-system-and-provider-body",
    );
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("aria-modal"),
    ).toBe("false");

    act(() =>
      container
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        ),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("exposes localized loading, privacy-safe error, and empty states", () => {
    state.query.data = undefined;
    state.query.isPending = true;
    act(() =>
      root.render(
        <ContextInspector
          chatId="chat-context"
          loading={false}
          onClose={() => undefined}
        />,
      ),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "inspectingContext",
    );

    state.query.isPending = false;
    state.query.isError = true;
    state.query.error = new Error("provider-secret");
    act(() =>
      root.render(
        <ContextInspector
          chatId="chat-context"
          loading={false}
          onClose={() => undefined}
        />,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "contextInspectionFailed",
    );
    expect(container.textContent).not.toContain("provider-secret");

    state.query.isError = false;
    state.query.error = null;
    state.query.data = { data: null };
    act(() =>
      root.render(
        <ContextInspector
          chatId="chat-context"
          loading={false}
          onClose={() => undefined}
        />,
      ),
    );
    expect(container.textContent).toContain("contextNoRun");
  });
});

function contextFixture(): PersistedRunContext {
  return {
    branch: {
      currentTranscriptVersion: "12",
      inputMessageId: "message-user",
      parentMessageId: "message-parent",
      visibleMessageCount: 2,
    },
    checkpoints: [
      {
        createdAt: "2026-08-14T12:00:01.000Z",
        sequence: 1,
        type: "run.started",
      },
    ],
    knowledge: {
      citations: [
        {
          chunkId: "chunk-safe",
          documentId: "document-safe",
          sourceType: "pdf",
          title: "Current source label",
        },
      ],
      revokedOrUnavailableCount: 1,
      totalCitationCount: 2,
    },
    messages: [
      {
        content: "Visible user request",
        contentTruncated: false,
        createdAt: "2026-08-14T12:00:00.000Z",
        id: "message-user",
        role: "user",
      },
    ],
    model: { available: true, displayName: "Safe model", id: "model-safe" },
    policies: {
      blockedTermCount: 3,
      knowledgeGroundingMode: "required",
      memoryMode: "recent_messages",
      promptInjectionGuard: {
        mode: "block",
        scanRetrievedContext: true,
        scanUserInput: true,
      },
    },
    provider: {
      available: true,
      displayName: "Safe provider",
      id: "provider-safe",
    },
    run: {
      agentId: "agent-safe",
      agentVersionId: "agent-version-safe",
      chatId: "chat-context",
      createdAt: "2026-08-14T12:00:00.000Z",
      id: "run-safe",
      status: "completed",
    },
    tools: [
      {
        approvalRequired: true,
        completedAt: "2026-08-14T12:00:03.000Z",
        riskLevel: "high",
        startedAt: "2026-08-14T12:00:02.000Z",
        status: "success",
        toolId: "tool-safe",
      },
    ],
    transformations: [{ count: 1, type: "knowledge_dropped" }],
  };
}
