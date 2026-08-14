export type ProviderReasoningEffort = "high" | "low" | "medium";
export type ProviderReasoningSummary = "auto" | "concise" | "detailed";

import type { ProviderReasoningPolicyResolution } from "./reasoning-policy";

export interface ProviderReasoningParameters {
  effort?: ProviderReasoningEffort;
  summary?: ProviderReasoningSummary;
}

export type ProviderStructuredOutput =
  | { type: "json_object" }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

export type ProviderChatParameterPath =
  | "reasoning"
  | "reasoning.effort"
  | "reasoning.summary"
  | "sampling.maxTokens"
  | "sampling.temperature"
  | "sampling.topP"
  | "structuredOutput"
  | "tools";

export type ProviderChatParameterOmissionReason =
  | "invalid_value"
  | "unsupported_by_dialect"
  | "unsupported_by_model_or_provider";

export interface ProviderChatParameterOmission {
  parameter: ProviderChatParameterPath;
  reason: ProviderChatParameterOmissionReason;
}

export interface ProviderChatParameterSnapshot {
  reasoning?: ProviderReasoningParameters;
  sampling?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
  structuredOutput?: {
    strict?: boolean;
    type: ProviderStructuredOutput["type"];
  };
  tools?: { count: number };
}

/** Safe to persist: contains no prompts, schemas, tool names, or credentials. */
export interface ProviderChatParameterResolutionSummary {
  effective: ProviderChatParameterSnapshot;
  omissions: readonly ProviderChatParameterOmission[];
  reasoningPolicy?: ProviderReasoningPolicyResolution;
  requested: ProviderChatParameterSnapshot;
}
