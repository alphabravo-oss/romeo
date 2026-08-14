import { assertCapabilityDefaultConfiguration } from "./capability-configuration";

export const capabilityIds = [
  "image_generation",
  "reasoning_policy",
  "voice_processing",
  "web_retrieval",
  "content_firewall",
  "knowledge_acl",
  "realtime_voice",
  "image_editing",
  "secure_compute",
  "multi_model_compare",
  "tenant_encryption",
  "data_export",
] as const;
export type CapabilityId = (typeof capabilityIds)[number];
export type CapabilityAssignmentState =
  | "inherit"
  | "enabled"
  | "disabled"
  | "required";

export const imageGenerationSizes = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;
export type ImageGenerationSize = (typeof imageGenerationSizes)[number];

export interface ImageGenerationCapabilityConfiguration {
  maxImagesPerRequest: number;
  allowedSizes: ImageGenerationSize[];
}

export interface WebRetrievalCapabilityConfiguration {
  maxSearchResults: number;
  maxUrlsPerRequest: number;
}

export interface CapabilityConfiguration {
  allowedSizes?: ImageGenerationSize[];
  maxImagesPerRequest?: number;
  maxSearchResults?: number;
  maxUrlsPerRequest?: number;
  reasoningModeMaximum?: "off" | "auto" | "summary";
  reasoningEffortMaximum?: "low" | "medium" | "high";
  maxReasoningTokens?: number;
  allowReasoningSummaryRetention?: boolean;
}

export interface CapabilityDefinition {
  id: CapabilityId;
  schemaVersion: 1;
  lifecycle: "disabled" | "preview" | "ga" | "deprecated";
  category: "media" | "reasoning" | "retrieval" | "compute" | "compare" | "security" | "governance";
  risk: "low" | "medium" | "high" | "critical";
  controllingLayers: Array<
    | "platform"
    | "organization"
    | "workspace"
    | "agent_version"
    | "agent"
    | "group"
    | "user"
    | "action"
  >;
  allowedStates: CapabilityAssignmentState[];
  defaultState: "enabled" | "disabled";
  defaultConfiguration: CapabilityConfiguration;
  merge: {
    boolean: "deny_dominates";
    maxima: string[];
    allowlists: string[];
  };
  requiredScopes: string[];
  entitlementKey?: string;
  dependencies: string[];
  copy: {
    nameKey: string;
    descriptionKey: string;
    riskKey: string;
    remediationKey: string;
  };
  registryVersion: string;
}

export const CAPABILITY_REGISTRY_VERSION = "cap-registry-v3";

export {
  assertCapabilityDefaultConfiguration,
  imageGenerationConfiguration,
  mergeCapabilityConfiguration,
  parseCapabilityConfigurationPatch,
  webRetrievalConfiguration,
} from "./capability-configuration";

const definitions = [
  {
    id: "image_generation",
    schemaVersion: 1,
    lifecycle: "ga",
    category: "media",
    risk: "medium",
    controllingLayers: [
      "platform",
      "organization",
      "workspace",
      "agent_version",
      "agent",
      "group",
      "user",
      "action",
    ],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "enabled",
    defaultConfiguration: {
      maxImagesPerRequest: 4,
      allowedSizes: [...imageGenerationSizes],
    },
    merge: {
      boolean: "deny_dominates",
      maxima: ["maxImagesPerRequest"],
      allowlists: ["allowedSizes"],
    },
    requiredScopes: ["runs:create", "models:read"],
    dependencies: ["object_storage", "image_provider"],
    copy: {
      nameKey: "capabilityImageGenerationName",
      descriptionKey: "capabilityImageGenerationDescription",
      riskKey: "capabilityRiskMedium",
      remediationKey: "capabilityImageGenerationRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "reasoning_policy",
    schemaVersion: 1,
    lifecycle: "ga",
    category: "reasoning",
    risk: "high",
    controllingLayers: ["platform", "organization", "workspace", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "enabled",
    defaultConfiguration: {
      reasoningModeMaximum: "summary",
      reasoningEffortMaximum: "high",
      maxReasoningTokens: 200_000,
      allowReasoningSummaryRetention: true,
    },
    merge: {
      boolean: "deny_dominates",
      maxima: [
        "reasoningModeMaximum",
        "reasoningEffortMaximum",
        "maxReasoningTokens",
      ],
      allowlists: [],
    },
    requiredScopes: ["runs:create"],
    dependencies: [],
    copy: {
      nameKey: "capabilityReasoningPolicyName",
      descriptionKey: "capabilityReasoningPolicyDescription",
      riskKey: "capabilityRiskHigh",
      remediationKey: "capabilityReasoningPolicyRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "voice_processing",
    schemaVersion: 1,
    lifecycle: "ga",
    category: "media",
    risk: "medium",
    controllingLayers: [
      "organization",
      "agent_version",
      "agent",
      "group",
      "user",
      "action",
    ],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "enabled",
    defaultConfiguration: {},
    merge: {
      boolean: "deny_dominates",
      maxima: [],
      allowlists: [],
    },
    requiredScopes: ["voices:use"],
    dependencies: ["voice_provider"],
    copy: {
      nameKey: "capabilityVoiceProcessingName",
      descriptionKey: "capabilityVoiceProcessingDescription",
      riskKey: "capabilityRiskMedium",
      remediationKey: "capabilityVoiceProcessingRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "web_retrieval",
    schemaVersion: 1,
    lifecycle: "ga",
    category: "retrieval",
    risk: "high",
    controllingLayers: [
      "organization",
      "agent_version",
      "agent",
      "group",
      "user",
      "action",
    ],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "enabled",
    defaultConfiguration: { maxSearchResults: 10, maxUrlsPerRequest: 5 },
    merge: {
      boolean: "deny_dominates",
      maxima: ["maxSearchResults", "maxUrlsPerRequest"],
      allowlists: [],
    },
    requiredScopes: ["runs:create"],
    dependencies: ["web_search_configuration", "network_egress"],
    copy: {
      nameKey: "capabilityWebRetrievalName",
      descriptionKey: "capabilityWebRetrievalDescription",
      riskKey: "capabilityRiskHigh",
      remediationKey: "capabilityWebRetrievalRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "content_firewall",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "security",
    risk: "critical",
    controllingLayers: ["platform", "organization", "workspace", "action"],
    allowedStates: ["inherit", "enabled", "required"],
    defaultState: "enabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["admin:read"],
    dependencies: [],
    copy: {
      nameKey: "capabilityContentFirewallName",
      descriptionKey: "capabilityContentFirewallDescription",
      riskKey: "capabilityRiskCritical",
      remediationKey: "capabilityContentFirewallRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "knowledge_acl",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "retrieval",
    risk: "critical",
    controllingLayers: ["platform", "organization", "workspace", "action"],
    allowedStates: ["inherit", "enabled", "required"],
    defaultState: "enabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["knowledge:read"],
    dependencies: [],
    copy: {
      nameKey: "capabilityKnowledgeAclName",
      descriptionKey: "capabilityKnowledgeAclDescription",
      riskKey: "capabilityRiskCritical",
      remediationKey: "capabilityKnowledgeAclRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "realtime_voice",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "media",
    risk: "high",
    controllingLayers: ["platform", "organization", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "disabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["voices:use"],
    dependencies: ["realtime_gateway"],
    copy: {
      nameKey: "capabilityRealtimeVoiceName",
      descriptionKey: "capabilityRealtimeVoiceDescription",
      riskKey: "capabilityRiskHigh",
      remediationKey: "capabilityRealtimeVoiceRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "image_editing",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "media",
    risk: "medium",
    controllingLayers: ["platform", "organization", "workspace", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "disabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["runs:create"],
    dependencies: ["object_storage", "image_provider"],
    copy: {
      nameKey: "capabilityImageEditingName",
      descriptionKey: "capabilityImageEditingDescription",
      riskKey: "capabilityRiskMedium",
      remediationKey: "capabilityImageEditingRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "secure_compute",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "compute",
    risk: "critical",
    controllingLayers: ["platform", "organization", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "disabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["admin:write"],
    dependencies: ["kata_runtime"],
    copy: {
      nameKey: "capabilitySecureComputeName",
      descriptionKey: "capabilitySecureComputeDescription",
      riskKey: "capabilityRiskCritical",
      remediationKey: "capabilitySecureComputeRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "multi_model_compare",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "compare",
    risk: "high",
    controllingLayers: ["platform", "organization", "workspace", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "disabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["runs:create"],
    dependencies: [],
    copy: {
      nameKey: "capabilityMultiModelCompareName",
      descriptionKey: "capabilityMultiModelCompareDescription",
      riskKey: "capabilityRiskHigh",
      remediationKey: "capabilityMultiModelCompareRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "tenant_encryption",
    schemaVersion: 1,
    lifecycle: "preview",
    category: "security",
    risk: "critical",
    controllingLayers: ["platform", "organization", "action"],
    allowedStates: ["inherit", "enabled", "required"],
    defaultState: "disabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["admin:write"],
    dependencies: ["customer_kms"],
    copy: {
      nameKey: "capabilityTenantEncryptionName",
      descriptionKey: "capabilityTenantEncryptionDescription",
      riskKey: "capabilityRiskCritical",
      remediationKey: "capabilityTenantEncryptionRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
  {
    id: "data_export",
    schemaVersion: 1,
    lifecycle: "ga",
    category: "governance",
    risk: "high",
    controllingLayers: ["platform", "organization", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "enabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: ["admin:read"],
    dependencies: [],
    copy: {
      nameKey: "capabilityDataExportName",
      descriptionKey: "capabilityDataExportDescription",
      riskKey: "capabilityRiskHigh",
      remediationKey: "capabilityDataExportRemediation",
    },
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  },
] satisfies readonly CapabilityDefinition[];

const byId = new Map<CapabilityId, CapabilityDefinition>(
  definitions.map((definition) => [definition.id, definition]),
);

validateRegistry();

export function listCapabilityDefinitions(): CapabilityDefinition[] {
  return definitions.map(cloneDefinition);
}

export function getCapabilityDefinition(
  capabilityId: string,
): CapabilityDefinition | undefined {
  const definition = byId.get(capabilityId as CapabilityId);
  return definition === undefined ? undefined : cloneDefinition(definition);
}



function cloneDefinition(
  definition: CapabilityDefinition,
): CapabilityDefinition {
  return {
    ...definition,
    controllingLayers: [...definition.controllingLayers],
    allowedStates: [...definition.allowedStates],
    defaultConfiguration: structuredClone(definition.defaultConfiguration),
    merge: {
      boolean: definition.merge.boolean,
      maxima: [...definition.merge.maxima],
      allowlists: [...definition.merge.allowlists],
    },
    requiredScopes: [...definition.requiredScopes],
    dependencies: [...definition.dependencies],
    copy: { ...definition.copy },
  };
}

function validateRegistry(): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id))
      throw new Error(`Duplicate capability definition: ${definition.id}`);
    ids.add(definition.id);
    assertCapabilityDefaultConfiguration(definition);
    if (
      definition.allowedStates.includes("disabled") &&
      (definition.id === "content_firewall" ||
        definition.id === "knowledge_acl" ||
        definition.id === "tenant_encryption")
    )
      throw new Error(
        `Capability ${definition.id} is security-mandatory and cannot expose disable.`,
      );
  }
}
