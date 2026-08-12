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
    // Agent Studio addresses an assistant by id and lists drafts, so the pick
    // is whatever it opened rather than the first publishable row.
    expect(
      resolveActiveAssistant({
        activeAgentId: "blocked",
        agents,
        includeDrafts: true,
      })?.id,
    ).toBe("blocked");
  });
});

describe("chat author names", () => {
  it("names the assistant in both places when assistants are enabled", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Sales Coach",
        assistantsEnabled: true,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "GPT-4o mini",
      }),
    ).toEqual({ nextTurn: "Sales Coach", transcript: "Sales Coach" });
  });

  it("uses the placeholder when enabled but nothing has resolved", () => {
    expect(
      resolveChatAuthorNames({
        agentName: undefined,
        assistantsEnabled: true,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "GPT-4o mini",
      }),
    ).toEqual({ nextTurn: "Romeo Assistant", transcript: "Romeo Assistant" });
  });

  it("names the model for the next turn and nothing for existing rows", () => {
    // Which model wrote a row already on screen is not knowable here, and the
    // picker moves between turns: the same transcript must not be relabelled
    // by choosing a different model for the next send.
    expect(
      resolveChatAuthorNames({
        agentName: "Direct model",
        assistantsEnabled: false,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "GPT-4o mini",
      }),
    ).toEqual({ nextTurn: "GPT-4o mini", transcript: undefined });
    expect(
      resolveChatAuthorNames({
        agentName: "Direct model",
        assistantsEnabled: false,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "Claude Haiku",
      }),
    ).toEqual({ nextTurn: "Claude Haiku", transcript: undefined });
  });

  it("never names the assistant when assistants are off", () => {
    // An older chat, or one opened from a ?agent= link, stays pinned to an
    // assistant that carries a persona. The server withholds that persona's
    // prompt, so the surface must not print its name over the answer.
    expect(
      resolveChatAuthorNames({
        agentName: "Sales Coach",
        assistantsEnabled: false,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "GPT-4o mini",
      }),
    ).toEqual({ nextTurn: "GPT-4o mini", transcript: undefined });
  });

  it("says nothing rather than a product name when the model is unknown", () => {
    expect(
      resolveChatAuthorNames({
        agentName: "Direct model",
        assistantsEnabled: false,
        fallbackName: "Romeo Assistant",
        modelDisplayName: undefined,
      }),
    ).toEqual({ nextTurn: undefined, transcript: undefined });
    expect(
      resolveChatAuthorNames({
        agentName: undefined,
        assistantsEnabled: false,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "   ",
      }),
    ).toEqual({ nextTurn: undefined, transcript: undefined });
  });

  it("says nothing until the setting has loaded", () => {
    // Holding beats guessing: the bare rule applied to an assistants-on
    // workspace would put a model's name over a persona's answer for a paint.
    expect(
      resolveChatAuthorNames({
        agentName: "Sales Coach",
        assistantsEnabled: undefined,
        fallbackName: "Romeo Assistant",
        modelDisplayName: "GPT-4o mini",
      }),
    ).toEqual({ nextTurn: undefined, transcript: undefined });
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
