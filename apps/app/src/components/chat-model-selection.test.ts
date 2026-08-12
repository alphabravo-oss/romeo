import { describe, expect, it } from "vitest";

import {
  lastAssistantModelId,
  resolveChatModelSelection,
} from "./chat-model-selection";

describe("chat model selection", () => {
  it("uses the assistant model when nothing else is set", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: undefined,
        defaultModelId: undefined,
        lastModelId: undefined,
        overrideModelId: undefined,
      }),
    ).toBe("model_default");
  });

  it("restores a model persisted on an existing chat", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: "model_chat",
        defaultModelId: "model_user_default",
        lastModelId: "model_last",
        overrideModelId: undefined,
      }),
    ).toBe("model_chat");
  });

  it("prefers the user default over last-used for a new chat", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: undefined,
        defaultModelId: "model_user_default",
        lastModelId: "model_last",
        overrideModelId: undefined,
      }),
    ).toBe("model_user_default");
  });

  it("falls back to last-used when there is no explicit default", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: undefined,
        defaultModelId: undefined,
        lastModelId: "model_last",
        overrideModelId: undefined,
      }),
    ).toBe("model_last");
  });

  it("keeps a newly selected model while the chat is being created", () => {
    expect(
      resolveChatModelSelection({
        assistantModelId: "model_default",
        chatModelId: undefined,
        defaultModelId: "model_user_default",
        lastModelId: "model_last",
        overrideModelId: "model_selected",
      }),
    ).toBe("model_selected");
  });
});

describe("lastAssistantModelId", () => {
  it("returns the model on the most recent assistant turn", () => {
    expect(
      lastAssistantModelId([
        { role: "user" },
        { role: "assistant", modelId: "model_a" },
        { role: "user" },
        { role: "assistant", modelId: "model_b" },
      ]),
    ).toBe("model_b");
  });

  it("skips assistant turns without provenance", () => {
    expect(
      lastAssistantModelId([
        { role: "assistant", modelId: "model_a" },
        { role: "assistant" },
      ]),
    ).toBe("model_a");
  });

  it("returns undefined when no assistant model is known", () => {
    expect(lastAssistantModelId([{ role: "user" }])).toBeUndefined();
  });
});
