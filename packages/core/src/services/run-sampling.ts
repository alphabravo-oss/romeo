import {
  modelAcceptsTemperature,
  type BaseModel,
  type ProviderSampling,
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
 * ponytail: three keys, hardcoded. CEILING: a provider-specific knob (presence_penalty, top_k) set
 * in the studio is still silently dropped, exactly as all three of these were before this existed.
 * UPGRADE PATH: a per-provider allowlist keyed off ProviderKind, once a second provider needs one.
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

// NaN and Infinity serialize to null in JSON and are rejected by every provider we speak to, so
// they are dropped here rather than sent and refused.
export function samplingForModel(
  model: BaseModel,
  sampling: ProviderSampling | undefined,
): ProviderSampling | undefined {
  if (sampling === undefined) return undefined;
  if (modelAcceptsTemperature(model.capabilities)) return sampling;
  const next: ProviderSampling = {
    ...(sampling.maxTokens === undefined ? {} : { maxTokens: sampling.maxTokens }),
  };
  return Object.keys(next).length === 0 ? undefined : next;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
