import { describe, expect, it } from "vitest";

import type { AgentGalleryItem } from "../features/managed-models";
import {
  resolveActiveAssistant,
  resolveChatAuthorNames,
} from "./assistant-selection";

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

  it("resolves the assistant a management surface is standing on", () => {
    expect(
      resolveActiveAssistant({
        activeAgentId: "blocked",
        agents,
        includeDrafts: true,
      })?.id,
    ).toBe("blocked");
  });
});

describe("chat author names (base model + custom model)", () => {
  it("treats a custom model as the selected model, not a separate assistant", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Support bot",
        modelDisplayName: "Kimi K2.5",
      }),
    ).toEqual({ nextTurn: "Support bot", transcript: "Support bot" });
  });

  it("never surfaces Romeo Assistant as a transcript label", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Romeo Assistant",
        modelDisplayName: "Kimi K2.5",
      }),
    ).toEqual({ nextTurn: "Kimi K2.5", transcript: undefined });
  });

  it("omits custom model when it matches the base model name", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Kimi K2.5",
        modelDisplayName: "Kimi K2.5",
      }),
    ).toEqual({ nextTurn: "Kimi K2.5", transcript: undefined });
  });

  it("uses custom model when no base model display name is known", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Support bot",
        modelDisplayName: undefined,
      }),
    ).toEqual({ nextTurn: "Support bot", transcript: "Support bot" });
  });

  it("stays quiet when nothing is resolved", () => {
    expect(
      resolveChatAuthorNames({
        agentName: undefined,
        modelDisplayName: undefined,
      }),
    ).toEqual({ nextTurn: undefined, transcript: undefined });
  });

  it("prefers the custom model over the base model", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Support bot",
        modelDisplayName: "DeepSeek V3",
      }),
    ).toEqual({ nextTurn: "Support bot", transcript: "Support bot" });
  });
});

function assistant(
  id: string,
  readinessStatus: AgentGalleryItem["readinessStatus"],
): AgentGalleryItem {
  return {
    id,
    name: id,
    readinessStatus,
    publishedVersionId: readinessStatus === "ready" ? `ver_${id}` : undefined,
  } as AgentGalleryItem;
}
