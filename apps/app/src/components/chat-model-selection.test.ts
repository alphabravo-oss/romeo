import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveChatModelSelection } from "./chat-model-selection";

describe("chat model selection", () => {
  it("uses the assistant model when the chat has no explicit choice", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: undefined,
        overrideModelId: undefined,
      }),
    ).toBe("model_default");
  });

  it("restores a model persisted on an existing chat", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: "model_chat",
        overrideModelId: undefined,
      }),
    ).toBe("model_chat");
  });

  it("keeps a newly selected model while the chat is being created", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: undefined,
        overrideModelId: "model_selected",
      }),
    ).toBe("model_selected");
  });

  it("keeps the visible picker wired through to text runs", () => {
    const composer = readFileSync(
      new URL("ChatComposer.tsx", import.meta.url),
      "utf8",
    );
    const shell = readFileSync(
      new URL("WorkspaceShell.tsx", import.meta.url),
      "utf8",
    );
    const turnActions = readFileSync(
      new URL("useWorkspaceTurnActions.ts", import.meta.url),
      "utf8",
    );

    expect(composer).toMatch(/<ComposerModelSelect\b/u);
    expect(shell).toMatch(/workspace\.handleSelectModel/u);
    expect(turnActions).toMatch(/\{\s*modelId: options\.selectedModelId\s*\}/u);
  });
});
