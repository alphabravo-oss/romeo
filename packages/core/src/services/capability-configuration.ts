import { z } from "zod";

import type {
  CapabilityConfiguration,
  CapabilityDefinition,
  CapabilityId,
  ImageGenerationCapabilityConfiguration,
  ImageGenerationSize,
  WebRetrievalCapabilityConfiguration,
} from "./capability-definition-registry";

const imageGenerationConfigurationSchema = z.strictObject({
  maxImagesPerRequest: z.number().int().min(1).max(4),
  allowedSizes: z
    .array(z.enum(["1024x1024", "1024x1536", "1536x1024"]))
    .min(1)
    .max(3),
});
const webRetrievalConfigurationSchema = z.strictObject({
  maxSearchResults: z.number().int().min(1).max(10),
  maxUrlsPerRequest: z.number().int().min(1).max(5),
});
const reasoningPolicyConfigurationSchema = z.strictObject({
  reasoningModeMaximum: z.enum(["off", "auto", "summary"]),
  reasoningEffortMaximum: z.enum(["low", "medium", "high"]),
  maxReasoningTokens: z.number().int().min(1).max(200_000),
  allowReasoningSummaryRetention: z.boolean(),
});
const emptyConfigurationSchema = z.strictObject({});

export function parseCapabilityConfigurationPatch(
  capabilityId: CapabilityId,
  value: unknown,
): CapabilityConfiguration {
  return configurationSchema(capabilityId).partial().parse(value);
}

export function mergeCapabilityConfiguration(
  definition: CapabilityDefinition,
  current: CapabilityConfiguration,
  patch: CapabilityConfiguration,
): CapabilityConfiguration {
  const merged = structuredClone(current);
  for (const field of definition.merge.maxima) {
    const existing = merged[field as keyof CapabilityConfiguration];
    const candidate = patch[field as keyof CapabilityConfiguration];
    if (typeof existing === "number" && typeof candidate === "number") {
      (merged as Record<string, unknown>)[field] = Math.min(
        existing,
        candidate,
      );
    } else if (typeof existing === "string" && typeof candidate === "string") {
      (merged as Record<string, unknown>)[field] = lowerOrderedMaximum(
        field,
        existing,
        candidate,
      );
    }
  }
  // Driven by definition.merge.booleans rather than a per-capability branch,
  // so the deny_dominates contract every definition declares actually applies
  // to any boolean field instead of only the reasoning one.
  for (const field of definition.merge.booleans) {
    const existing = merged[field as keyof CapabilityConfiguration];
    const candidate = patch[field as keyof CapabilityConfiguration];
    if (typeof existing === "boolean" && typeof candidate === "boolean") {
      (merged as Record<string, unknown>)[field] = existing && candidate;
    }
  }
  for (const field of definition.merge.allowlists) {
    const existing = merged[field as keyof CapabilityConfiguration];
    const candidate = patch[field as keyof CapabilityConfiguration];
    if (Array.isArray(existing) && Array.isArray(candidate)) {
      (merged as Record<string, unknown>)[field] = existing.filter((item) =>
        candidate.includes(item as ImageGenerationSize),
      );
    }
  }
  return merged;
}

export function imageGenerationConfiguration(
  value: CapabilityConfiguration,
): ImageGenerationCapabilityConfiguration {
  return imageGenerationConfigurationSchema.parse(value);
}

export function webRetrievalConfiguration(
  value: CapabilityConfiguration,
): WebRetrievalCapabilityConfiguration {
  return webRetrievalConfigurationSchema.parse(value);
}

export function assertCapabilityDefaultConfiguration(
  definition: CapabilityDefinition,
): void {
  configurationSchema(definition.id).parse(definition.defaultConfiguration);
}

function configurationSchema(capabilityId: CapabilityId) {
  switch (capabilityId) {
    case "image_generation":
      return imageGenerationConfigurationSchema;
    case "web_retrieval":
      return webRetrievalConfigurationSchema;
    case "reasoning_policy":
      return reasoningPolicyConfigurationSchema;
    case "voice_processing":
    case "content_firewall":
    case "knowledge_acl":
    case "realtime_voice":
    case "image_editing":
    case "secure_compute":
    case "multi_model_compare":
    case "tenant_encryption":
    case "data_export":
      return emptyConfigurationSchema;
  }
}

function lowerOrderedMaximum(
  field: string,
  current: string,
  candidate: string,
): string {
  const order =
    field === "reasoningModeMaximum"
      ? ["off", "auto", "summary"]
      : ["low", "medium", "high"];
  return order[Math.min(order.indexOf(current), order.indexOf(candidate))]!;
}
