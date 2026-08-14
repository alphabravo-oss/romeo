import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PlatformCapabilityPosture } from "../features/capabilities";
import { LocaleProvider } from "../lib/i18n";
import { CapabilityPlatformPostureView } from "./CapabilityPlatformPosturePanel";

describe("CapabilityPlatformPosture", () => {
  it("shows the immutable global ceiling without exposing environment values", () => {
    const posture: PlatformCapabilityPosture = {
      registryVersion: "cap-registry-v2",
      controlPlane: "deployment_environment",
      mutableViaApi: false,
      capabilities: [
        {
          capabilityId: "image_generation",
          lifecycle: "ga",
          risk: "medium",
          state: "disabled",
          reason: "platform_disabled",
        },
        {
          capabilityId: "web_retrieval",
          lifecycle: "ga",
          risk: "high",
          state: "enabled",
          reason: "allowed",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <LocaleProvider>
        <CapabilityPlatformPostureView posture={posture} />
      </LocaleProvider>,
    );

    expect(markup).toContain("capabilityPlatformReadOnly");
    expect(markup).toContain("capabilityValueDisabled");
    expect(markup).toContain("capabilityValueEnabled");
    expect(markup).toContain('translate="no">cap-registry-v2');
    expect(markup).not.toMatch(
      /CAPABILITY_PLATFORM_DISABLED_IDS|process\.env|secret/iu,
    );
  });
});
