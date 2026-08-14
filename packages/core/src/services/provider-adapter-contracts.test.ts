import { describe, expect, it } from "vitest";

import {
  previewModelCompatibility,
  publicProviderAdapterContract,
  resolveFirstClassProviderTarget,
} from "./provider-adapter-contracts";

describe("first-class provider adapter contracts", () => {
  it("accepts reviewed targets and auth strategies without exposing secrets", () => {
    expect(
      resolveFirstClassProviderTarget({
        target: "bedrock-anthropic",
        auth: "aws_sigv4",
      }),
    ).toEqual({
      outcome: "accepted",
      target: "bedrock-anthropic",
      auth: "aws_sigv4",
    });
    expect(
      resolveFirstClassProviderTarget({
        target: "azure-openai",
        auth: "none",
      }),
    ).toEqual({ outcome: "denied", code: "provider_auth_unsupported" });
    const published = publicProviderAdapterContract({
      target: "gemini",
      auth: "gcp_workload",
      region: "us-central1",
    });
    expect(published.credentialMode).toBe("write_only");
    expect(JSON.stringify(published)).not.toContain("sk-");
    expect(JSON.stringify(published)).not.toContain("token");
  });

  it("previews turn compatibility without executing a provider call", () => {
    expect(
      previewModelCompatibility({
        required: {
          attachments: true,
          tools: true,
          reasoning: false,
          imageOutput: false,
          localOnly: true,
        },
        model: {
          tools: true,
          reasoning: true,
          imageOutput: false,
          localRuntime: false,
          regionAllowed: true,
          entitled: true,
        },
      }),
    ).toEqual({ outcome: "unavailable", constraint: "local_only_policy" });
    expect(
      previewModelCompatibility({
        required: {
          attachments: false,
          tools: false,
          reasoning: false,
          imageOutput: false,
          localOnly: false,
        },
        model: {
          tools: false,
          reasoning: false,
          imageOutput: false,
          localRuntime: true,
          regionAllowed: true,
          entitled: true,
        },
      }),
    ).toEqual({ outcome: "available" });
  });
});
