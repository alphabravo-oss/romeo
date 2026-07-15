import { describe, expect, it } from "vitest";

import { defaultProviderCapabilities } from "./capabilities";

describe("provider capabilities", () => {
  it("describes hosted OpenAI-compatible deployment and model features", () => {
    expect(defaultProviderCapabilities("openai-compatible")).toMatchObject({
      streaming: true,
      toolCalling: true,
      structuredJson: true,
      modalities: ["text"],
      deployment: {
        mode: "hosted-api",
        networkAccess: "external-http",
        credentialRequired: true,
      },
    });
  });

  it("describes Responses-compatible providers as hosted tool-capable reasoning providers", () => {
    expect(
      defaultProviderCapabilities("openai-responses-compatible"),
    ).toMatchObject({
      streaming: true,
      toolCalling: true,
      structuredJson: true,
      reasoning: true,
      modalities: ["text"],
      deployment: {
        mode: "hosted-api",
        networkAccess: "external-http",
        credentialRequired: true,
      },
    });
  });

  it("describes local Ollama deployment constraints separately from hosted APIs", () => {
    expect(defaultProviderCapabilities("ollama")).toMatchObject({
      streaming: true,
      toolCalling: true,
      structuredJson: false,
      modalities: ["text"],
      deployment: {
        mode: "local-runtime",
        networkAccess: "local-http",
        credentialRequired: false,
      },
    });
  });
});
