import type { BaseModel } from "../features/providers/types";

export const modelConfigIssueCodes = [
  "invalid_context_window",
  "missing_max_output",
  "missing_pricing",
  "unavailable",
] as const;

export type ModelConfigIssueCode = (typeof modelConfigIssueCodes)[number];

export function modelConfigIssues(model: BaseModel): ModelConfigIssueCode[] {
  if (!model.enabled) return [];
  const issues: ModelConfigIssueCode[] = [];
  if (model.available === false) issues.push("unavailable");
  if (!Number.isInteger(model.contextWindow) || model.contextWindow < 1) {
    issues.push("invalid_context_window");
  }
  if (needsTokenPricing(model) && !hasPositiveTokenPricing(model)) {
    issues.push("missing_pricing");
  }
  if (needsMaxOutput(model) && !hasMaxOutput(model)) {
    issues.push("missing_max_output");
  }
  return issues;
}

export function collectModelConfigAttention(models: readonly BaseModel[]) {
  return models
    .map((model) => ({
      displayName: model.displayName || model.name,
      issues: modelConfigIssues(model),
      modelId: model.id,
      providerId: model.providerId,
    }))
    .filter((item) => item.issues.length > 0)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function needsTokenPricing(model: BaseModel): boolean {
  const modalities = model.capabilities.modalities;
  if (modalities.includes("embeddings") && !modalities.includes("text")) {
    return false;
  }
  return modalities.includes("text") || modalities.length === 0;
}

function hasPositiveTokenPricing(model: BaseModel): boolean {
  const pricing = model.pricing;
  return (
    pricing !== undefined &&
    Number.isFinite(pricing.inputTokenUsd) &&
    pricing.inputTokenUsd > 0 &&
    Number.isFinite(pricing.outputTokenUsd) &&
    pricing.outputTokenUsd > 0
  );
}

function needsMaxOutput(model: BaseModel): boolean {
  return needsTokenPricing(model);
}

function hasMaxOutput(model: BaseModel): boolean {
  const maxOutput = model.defaultParameters?.maxOutputTokens;
  return (
    typeof maxOutput === "number" &&
    Number.isInteger(maxOutput) &&
    maxOutput > 0
  );
}
