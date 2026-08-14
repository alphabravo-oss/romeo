import type { RomeoEnv } from "@romeo/config";

import { pass, type ReadinessCheck } from "./readiness-result";

export interface CapabilityPlatformPolicy {
  disabledCapabilityIds: readonly string[];
}

export function capabilityPlatformPolicyFromEnv(
  env: RomeoEnv,
): CapabilityPlatformPolicy {
  return {
    disabledCapabilityIds: [...env.CAPABILITY_PLATFORM_DISABLED_IDS],
  };
}

export function capabilityPlatformPolicyCheck(env: RomeoEnv): ReadinessCheck {
  const disabledIds = env.CAPABILITY_PLATFORM_DISABLED_IDS;
  const imageGenerationDisabled = disabledIds.includes("image_generation");
  return pass(
    "capability_platform_policy",
    "Operator capability controls are parsed and enforced.",
    {
      controlPlane: "deployment_environment",
      operatorOnly: true,
      disabledCount: disabledIds.length,
      imageGeneration: {
        allowed: !imageGenerationDisabled,
        reason: imageGenerationDisabled ? "platform_disabled" : "allowed",
      },
      rawConfigurationReturned: false,
    },
  );
}
