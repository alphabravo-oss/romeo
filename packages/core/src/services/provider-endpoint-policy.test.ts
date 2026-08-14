import { describe, expect, it } from "vitest";

import {
  resolveCompatibilityProfile,
  validateRegionalEndpoint,
} from "./provider-endpoint-policy";

describe("provider endpoint policy", () => {
  it("rejects a region outside tenant residency before enable", () => {
    expect(
      validateRegionalEndpoint({
        region: "eu-west-1",
        project: "prod",
        deployment: "chat-east",
        tenantResidency: "us",
      }),
    ).toEqual({
      outcome: "denied",
      code: "provider_region_outside_residency",
    });
    expect(
      validateRegionalEndpoint({
        region: "us-east-1",
        project: "prod",
        deployment: "chat-east",
        tenantResidency: "us",
      }),
    ).toEqual({
      outcome: "allowed",
      region: "us-east-1",
      project: "prod",
      deployment: "chat-east",
    });
  });

  it("lets a model probe strip capabilities a gateway profile advertised", () => {
    const resolved = resolveCompatibilityProfile({
      profile: {
        id: "litellm-openai",
        dialect: "openai-compatible",
        advertised: { reasoning: true, tools: true, structuredJson: true },
      },
      probed: { reasoning: false, tools: true, structuredJson: true },
    });
    expect(resolved.effective).toEqual({
      reasoning: false,
      tools: true,
      structuredJson: true,
    });
    expect(resolved.probeOverrides).toEqual(["reasoning"]);
  });
});
