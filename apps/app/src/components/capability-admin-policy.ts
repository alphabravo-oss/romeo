import type {
  CapabilityAdminOverview,
  CapabilityAssignmentState,
  CapabilityConfiguration,
  CapabilityDefinition,
} from "@romeo/api-client/generated/query";

import type { MessageKey } from "../lib/i18n";

export const imageGenerationSizes = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;

export type CapabilityId =
  | CapabilityDefinition["id"]
  | "content_firewall"
  | "knowledge_acl"
  | "realtime_voice"
  | "image_editing"
  | "secure_compute"
  | "multi_model_compare"
  | "tenant_encryption"
  | "data_export";
export type ImageGenerationSize = (typeof imageGenerationSizes)[number];

export type CapabilityPolicyValues = {
  maxImagesPerRequest: number;
  allowedSizes: ImageGenerationSize[];
  maxSearchResults: number;
  maxUrlsPerRequest: number;
  reasoningModeMaximum: "off" | "auto" | "summary";
  reasoningEffortMaximum: "low" | "medium" | "high";
  maxReasoningTokens: number;
  allowReasoningSummaryRetention: boolean;
};

type CapabilityCopy = {
  name: MessageKey;
  description: MessageKey;
  remediation: MessageKey;
  risk: MessageKey;
};

const capabilityCopy = {
  image_generation: {
    name: "capabilityImageGenerationName",
    description: "capabilityImageGenerationDescription",
    remediation: "capabilityImageGenerationRemediation",
    risk: "capabilityRiskMedium",
  },
  reasoning_policy: {
    name: "capabilityReasoningPolicyName",
    description: "capabilityReasoningPolicyDescription",
    remediation: "capabilityReasoningPolicyRemediation",
    risk: "capabilityRiskHigh",
  },
  voice_processing: {
    name: "capabilityVoiceProcessingName",
    description: "capabilityVoiceProcessingDescription",
    remediation: "capabilityVoiceProcessingRemediation",
    risk: "capabilityRiskMedium",
  },
  web_retrieval: {
    name: "capabilityWebRetrievalName",
    description: "capabilityWebRetrievalDescription",
    remediation: "capabilityWebRetrievalRemediation",
    risk: "capabilityRiskHigh",
  },
  content_firewall: {
    name: "capabilityContentFirewallName",
    description: "capabilityContentFirewallDescription",
    remediation: "capabilityContentFirewallRemediation",
    risk: "capabilityRiskCritical",
  },
  knowledge_acl: {
    name: "capabilityKnowledgeAclName",
    description: "capabilityKnowledgeAclDescription",
    remediation: "capabilityKnowledgeAclRemediation",
    risk: "capabilityRiskCritical",
  },
  realtime_voice: {
    name: "capabilityRealtimeVoiceName",
    description: "capabilityRealtimeVoiceDescription",
    remediation: "capabilityRealtimeVoiceRemediation",
    risk: "capabilityRiskHigh",
  },
  image_editing: {
    name: "capabilityImageEditingName",
    description: "capabilityImageEditingDescription",
    remediation: "capabilityImageEditingRemediation",
    risk: "capabilityRiskMedium",
  },
  secure_compute: {
    name: "capabilitySecureComputeName",
    description: "capabilitySecureComputeDescription",
    remediation: "capabilitySecureComputeRemediation",
    risk: "capabilityRiskCritical",
  },
  multi_model_compare: {
    name: "capabilityMultiModelCompareName",
    description: "capabilityMultiModelCompareDescription",
    remediation: "capabilityMultiModelCompareRemediation",
    risk: "capabilityRiskHigh",
  },
  tenant_encryption: {
    name: "capabilityTenantEncryptionName",
    description: "capabilityTenantEncryptionDescription",
    remediation: "capabilityTenantEncryptionRemediation",
    risk: "capabilityRiskCritical",
  },
  data_export: {
    name: "capabilityDataExportName",
    description: "capabilityDataExportDescription",
    remediation: "capabilityDataExportRemediation",
    risk: "capabilityRiskHigh",
  },
} satisfies Record<CapabilityId, CapabilityCopy>;

export function capabilityCopyFor(id: CapabilityId): CapabilityCopy {
  return capabilityCopy[id];
}

export function initialCapabilityPolicyValues(
  row: CapabilityAdminOverview["capabilities"][number],
): CapabilityPolicyValues {
  const configured = row.configuredAssignment?.configuration;
  const effective = row.effective.effective;
  const defaults = row.definition.defaultConfiguration;
  return {
    maxImagesPerRequest:
      configured?.maxImagesPerRequest ??
      effective.maxImagesPerRequest ??
      defaults.maxImagesPerRequest ??
      1,
    allowedSizes: filterImageGenerationSizes(
      configured?.allowedSizes ??
        effective.allowedSizes ??
        defaults.allowedSizes ??
        imageGenerationSizes,
    ),
    maxSearchResults:
      configured?.maxSearchResults ??
      effective.maxSearchResults ??
      defaults.maxSearchResults ??
      10,
    maxUrlsPerRequest:
      configured?.maxUrlsPerRequest ??
      effective.maxUrlsPerRequest ??
      defaults.maxUrlsPerRequest ??
      5,
    reasoningModeMaximum:
      configured?.reasoningModeMaximum ??
      effective.reasoningModeMaximum ??
      defaults.reasoningModeMaximum ??
      "off",
    reasoningEffortMaximum:
      configured?.reasoningEffortMaximum ??
      effective.reasoningEffortMaximum ??
      defaults.reasoningEffortMaximum ??
      "low",
    maxReasoningTokens:
      configured?.maxReasoningTokens ??
      effective.maxReasoningTokens ??
      defaults.maxReasoningTokens ??
      1,
    allowReasoningSummaryRetention:
      configured?.allowReasoningSummaryRetention ??
      effective.allowReasoningSummaryRetention ??
      defaults.allowReasoningSummaryRetention ??
      false,
  };
}

export function capabilityConfigurationFor(
  id: CapabilityId,
  state: CapabilityAssignmentState,
  values: CapabilityPolicyValues,
): CapabilityConfiguration {
  if (state === "inherit") return {};
  switch (id) {
    case "image_generation":
      return {
        maxImagesPerRequest: values.maxImagesPerRequest,
        allowedSizes: [...values.allowedSizes],
      };
    case "web_retrieval":
      return {
        maxSearchResults: values.maxSearchResults,
        maxUrlsPerRequest: values.maxUrlsPerRequest,
      };
    case "reasoning_policy":
      return {
        reasoningModeMaximum: values.reasoningModeMaximum,
        reasoningEffortMaximum: values.reasoningEffortMaximum,
        maxReasoningTokens: values.maxReasoningTokens,
        allowReasoningSummaryRetention: values.allowReasoningSummaryRetention,
      };
    case "voice_processing":
    case "content_firewall":
    case "knowledge_acl":
    case "realtime_voice":
    case "image_editing":
    case "secure_compute":
    case "multi_model_compare":
    case "tenant_encryption":
    case "data_export":
      return {};
  }
}

export function isCapabilityPolicyValid(
  id: CapabilityId,
  state: CapabilityAssignmentState,
  values: CapabilityPolicyValues,
): boolean {
  if (state === "inherit") return true;
  switch (id) {
    case "image_generation":
      return (
        Number.isInteger(values.maxImagesPerRequest) &&
        values.maxImagesPerRequest >= 1 &&
        values.maxImagesPerRequest <= 4 &&
        values.allowedSizes.length > 0 &&
        values.allowedSizes.length <= imageGenerationSizes.length
      );
    case "web_retrieval":
      return (
        Number.isInteger(values.maxSearchResults) &&
        values.maxSearchResults >= 1 &&
        values.maxSearchResults <= 10 &&
        Number.isInteger(values.maxUrlsPerRequest) &&
        values.maxUrlsPerRequest >= 1 &&
        values.maxUrlsPerRequest <= 5
      );
    case "reasoning_policy":
      return (
        Number.isInteger(values.maxReasoningTokens) &&
        values.maxReasoningTokens >= 1 &&
        values.maxReasoningTokens <= 200_000
      );
    case "voice_processing":
    case "content_firewall":
    case "knowledge_acl":
    case "realtime_voice":
    case "image_editing":
    case "secure_compute":
    case "multi_model_compare":
    case "tenant_encryption":
    case "data_export":
      return true;
  }
}

export function capabilityExpiryInputValue(
  expiresAt: string | undefined,
): string {
  if (expiresAt === undefined) return "";
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

export function isCapabilityExpiryValid(
  value: string,
  now = Date.now(),
): boolean {
  if (value.length === 0) return true;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now;
}

function filterImageGenerationSizes(
  values: readonly string[],
): ImageGenerationSize[] {
  const allowed = new Set<string>(imageGenerationSizes);
  return values.filter((value): value is ImageGenerationSize =>
    allowed.has(value),
  );
}
