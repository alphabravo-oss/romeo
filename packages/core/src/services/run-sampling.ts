import {
  type BaseModel,
  type ProviderReasoningParameters,
  type ProviderReasoningPolicyLayers,
  type ProviderSampling,
  type ProviderStructuredOutput,
} from "@romeo/providers";

import type { AgentParameters } from "../domain/agent-entities";

/**
 * Narrows a managed model version's stored `parameters` to the sampling knobs a provider request
 * can carry.
 *
 * `AgentParameters` is an open record, so it can hold anything an operator or an imported document
 * put there. Forwarding an unrecognised key to a provider is how a saved preference becomes a 400,
 * and forwarding a non-number `temperature` is how it becomes one intermittently — hence the
 * per-key type check rather than a spread.
 *
 * This parser deliberately recognizes only Romeo's provider-neutral sampling contract. The
 * centralized provider translator performs dialect and selected-target validation immediately
 * before dispatch.
 */
export function samplingFromParameters(
  parameters: AgentParameters | Record<string, unknown> | undefined,
): ProviderSampling | undefined {
  if (parameters === undefined) return undefined;
  const sampling: ProviderSampling = {
    ...(isFiniteNumber(parameters.temperature)
      ? { temperature: parameters.temperature }
      : {}),
    ...(isFiniteNumber(parameters.topP) ? { topP: parameters.topP } : {}),
    ...(isFiniteNumber(parameters.maxTokens)
      ? { maxTokens: parameters.maxTokens }
      : isFiniteNumber(parameters.maxOutputTokens)
        ? { maxTokens: parameters.maxOutputTokens }
        : {}),
  };
  return Object.keys(sampling).length === 0 ? undefined : sampling;
}

export interface RequestedProviderChatParameters {
  reasoning?: ProviderReasoningParameters;
  reasoningPolicy?: ProviderReasoningPolicyLayers;
  sampling?: ProviderSampling;
  structuredOutput?: ProviderStructuredOutput;
}

export function requestedChatParametersForModel(
  model: BaseModel,
  parameters: AgentParameters | Record<string, unknown> | undefined,
  reasoningPolicy?: ProviderReasoningPolicyLayers,
): RequestedProviderChatParameters {
  const defaults = samplingFromParameters(
    model.defaultParameters as Record<string, unknown> | undefined,
  );
  const requested = chatParametersFromParameters(parameters);
  const sampling = { ...defaults, ...requested.sampling };
  return {
    ...(Object.keys(sampling).length === 0 ? {} : { sampling }),
    ...(reasoningPolicy === undefined
      ? requested.reasoning === undefined
        ? {}
        : { reasoning: requested.reasoning }
      : { reasoningPolicy }),
    ...(requested.structuredOutput === undefined
      ? {}
      : { structuredOutput: requested.structuredOutput }),
  };
}

export function chatParametersFromParameters(
  parameters: AgentParameters | Record<string, unknown> | undefined,
): RequestedProviderChatParameters {
  if (parameters === undefined) return {};
  const sampling = samplingFromParameters(parameters);
  const nestedReasoning = record(parameters.reasoning);
  const effort = nestedReasoning?.effort ?? parameters.reasoningEffort;
  const summary = nestedReasoning?.summary ?? parameters.reasoningSummary;
  const reasoning: ProviderReasoningParameters = {
    ...(effort === "low" || effort === "medium" || effort === "high"
      ? { effort }
      : {}),
    ...(summary === "auto" || summary === "concise" || summary === "detailed"
      ? { summary }
      : {}),
  };
  const structuredOutput = providerStructuredOutput(
    parameters.structuredOutput,
  );
  return {
    ...(sampling === undefined ? {} : { sampling }),
    ...(Object.keys(reasoning).length === 0 ? {} : { reasoning }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function providerStructuredOutput(
  value: unknown,
): ProviderStructuredOutput | undefined {
  const output = record(value);
  if (output?.type === "json_object") return { type: "json_object" };
  const schema = record(output?.schema);
  if (
    output?.type !== "json_schema" ||
    typeof output.name !== "string" ||
    schema === undefined ||
    (output.strict !== undefined && typeof output.strict !== "boolean")
  ) {
    return undefined;
  }
  return {
    type: "json_schema",
    name: output.name,
    schema,
    ...(output.strict === undefined ? {} : { strict: output.strict }),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
