import { describe, expect, it } from "vitest";

import type { AgentGalleryItem } from "../features/managed-models";
import { resolveActiveAssistant } from "./assistant-selection";

const agents = [
  assistant("blocked", "blocked"),
  assistant("workspace-default", "ready"),
  assistant("user-default", "ready"),
  assistant("url", "ready"),
  assistant("chat", "ready"),
];

describe("assistant resolution", () => {
  it("uses chat, URL, user, workspace, then first-ready priority", () => {
    expect(
      resolveActiveAssistant({
        agents,
        chatAgentId: "chat",
        requestedAgentId: "url",
        userDefaultAgentId: "user-default",
        workspaceDefaultAgentId: "workspace-default",
      })?.id,
    ).toBe("chat");
    expect(
      resolveActiveAssistant({
        agents,
        requestedAgentId: "url",
        userDefaultAgentId: "user-default",
        workspaceDefaultAgentId: "workspace-default",
      })?.id,
    ).toBe("url");
    expect(
      resolveActiveAssistant({
        agents,
        userDefaultAgentId: "user-default",
        workspaceDefaultAgentId: "workspace-default",
      })?.id,
    ).toBe("user-default");
    expect(
      resolveActiveAssistant({
        agents,
        workspaceDefaultAgentId: "workspace-default",
      })?.id,
    ).toBe("workspace-default");
    expect(resolveActiveAssistant({ agents })?.id).toBe("workspace-default");
  });

  it("skips blocked choices for chat and includes drafts in management", () => {
    expect(
      resolveActiveAssistant({
        agents,
        chatAgentId: "blocked",
        requestedAgentId: "url",
      })?.id,
    ).toBe("url");
    expect(
      resolveActiveAssistant({
        agents,
        includeDrafts: true,
        requestedAgentId: "blocked",
      })?.id,
    ).toBe("blocked");
  });
});

function assistant(
  id: string,
  readinessStatus: "blocked" | "ready",
): AgentGalleryItem {
  return {
    id,
    orgId: "org",
    workspaceId: "workspace",
    name: id,
    createdBy: "admin",
    baseModelId: "base",
    systemPrompt: "Be helpful.",
    parameters: {},
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    updatedAt: "2026-07-29T00:00:00.000Z",
    favorite: false,
    readinessStatus,
  };
}
