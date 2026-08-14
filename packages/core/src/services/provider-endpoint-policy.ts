export type TenantResidency = "us" | "eu" | "unrestricted";

const regionsByResidency: Record<TenantResidency, readonly string[]> = {
  us: ["us-east-1", "us-west-2", "us-central1"],
  eu: ["eu-west-1", "eu-central-1", "europe-west1"],
  unrestricted: ["us-east-1", "us-west-2", "us-central1", "eu-west-1", "eu-central-1", "europe-west1"],
};

export function validateRegionalEndpoint(input: {
  region: string;
  project?: string;
  deployment?: string;
  tenantResidency: TenantResidency;
}):
  | {
      outcome: "allowed";
      region: string;
      project?: string;
      deployment?: string;
    }
  | { outcome: "denied"; code: "provider_region_outside_residency" } {
  if (!regionsByResidency[input.tenantResidency].includes(input.region))
    return { outcome: "denied", code: "provider_region_outside_residency" };
  return {
    outcome: "allowed",
    region: input.region,
    ...(input.project === undefined ? {} : { project: input.project }),
    ...(input.deployment === undefined ? {} : { deployment: input.deployment }),
  };
}

export interface CompatibilityProfile {
  id: string;
  dialect: "openai-compatible" | "openai-responses-compatible";
  advertised: {
    reasoning: boolean;
    tools: boolean;
    structuredJson: boolean;
  };
}

export function resolveCompatibilityProfile(input: {
  profile: CompatibilityProfile;
  probed: {
    reasoning: boolean;
    tools: boolean;
    structuredJson: boolean;
  };
}): {
  profileId: string;
  dialect: CompatibilityProfile["dialect"];
  effective: CompatibilityProfile["advertised"];
  probeOverrides: Array<keyof CompatibilityProfile["advertised"]>;
} {
  const probeOverrides = (
    ["reasoning", "tools", "structuredJson"] as const
  ).filter((capability) => input.profile.advertised[capability] && !input.probed[capability]);
  return {
    profileId: input.profile.id,
    dialect: input.profile.dialect,
    effective: {
      reasoning: input.profile.advertised.reasoning && input.probed.reasoning,
      tools: input.profile.advertised.tools && input.probed.tools,
      structuredJson:
        input.profile.advertised.structuredJson && input.probed.structuredJson,
    },
    probeOverrides: [...probeOverrides],
  };
}
