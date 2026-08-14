export const FIRST_CLASS_PROVIDER_TARGETS = [
  "openai",
  "azure-openai",
  "anthropic",
  "bedrock-anthropic",
  "gemini",
  "ollama",
  "vllm",
  "openai-compatible",
] as const;
export type FirstClassProviderTarget =
  (typeof FIRST_CLASS_PROVIDER_TARGETS)[number];

export const PROVIDER_AUTH_STRATEGIES = [
  "api_key",
  "workload_identity",
  "azure_entra",
  "aws_sigv4",
  "gcp_workload",
  "none",
] as const;
export type ProviderAuthStrategy = (typeof PROVIDER_AUTH_STRATEGIES)[number];

const allowedAuth: Record<FirstClassProviderTarget, readonly ProviderAuthStrategy[]> = {
  openai: ["api_key"],
  "azure-openai": ["api_key", "azure_entra", "workload_identity"],
  anthropic: ["api_key"],
  "bedrock-anthropic": ["aws_sigv4", "workload_identity"],
  gemini: ["api_key", "gcp_workload", "workload_identity"],
  ollama: ["none", "api_key"],
  vllm: ["none", "api_key"],
  "openai-compatible": ["api_key", "none"],
};

export function resolveFirstClassProviderTarget(input: {
  target: string;
  auth: string;
}):
  | {
      outcome: "accepted";
      target: FirstClassProviderTarget;
      auth: ProviderAuthStrategy;
    }
  | {
      outcome: "denied";
      code:
        | "provider_target_unsupported"
        | "provider_auth_unsupported"
        | "provider_secret_forbidden";
    } {
  if (!isFirstClassTarget(input.target))
    return { outcome: "denied", code: "provider_target_unsupported" };
  if (!isAuthStrategy(input.auth))
    return { outcome: "denied", code: "provider_auth_unsupported" };
  if (!allowedAuth[input.target].includes(input.auth))
    return { outcome: "denied", code: "provider_auth_unsupported" };
  return { outcome: "accepted", target: input.target, auth: input.auth };
}

export function publicProviderAdapterContract(input: {
  target: FirstClassProviderTarget;
  auth: ProviderAuthStrategy;
  region?: string;
}): {
  target: FirstClassProviderTarget;
  auth: ProviderAuthStrategy;
  credentialMode: "write_only";
  region?: string;
} {
  return {
    target: input.target,
    auth: input.auth,
    credentialMode: "write_only",
    ...(input.region === undefined ? {} : { region: input.region }),
  };
}

export function previewModelCompatibility(input: {
  required: {
    attachments: boolean;
    tools: boolean;
    reasoning: boolean;
    imageOutput: boolean;
    localOnly: boolean;
  };
  model: {
    tools: boolean;
    reasoning: boolean;
    imageOutput: boolean;
    localRuntime: boolean;
    regionAllowed: boolean;
    entitled: boolean;
  };
}):
  | { outcome: "available" }
  | {
      outcome: "unavailable";
      constraint:
        | "tools_unsupported"
        | "reasoning_unsupported"
        | "image_output_unsupported"
        | "local_only_policy"
        | "region_outside_residency"
        | "not_entitled";
    } {
  if (!input.model.entitled)
    return { outcome: "unavailable", constraint: "not_entitled" };
  if (input.required.localOnly && !input.model.localRuntime)
    return { outcome: "unavailable", constraint: "local_only_policy" };
  if (!input.model.regionAllowed)
    return { outcome: "unavailable", constraint: "region_outside_residency" };
  if (input.required.tools && !input.model.tools)
    return { outcome: "unavailable", constraint: "tools_unsupported" };
  if (input.required.reasoning && !input.model.reasoning)
    return { outcome: "unavailable", constraint: "reasoning_unsupported" };
  if (input.required.imageOutput && !input.model.imageOutput)
    return { outcome: "unavailable", constraint: "image_output_unsupported" };
  return { outcome: "available" };
}

function isFirstClassTarget(value: string): value is FirstClassProviderTarget {
  return (FIRST_CLASS_PROVIDER_TARGETS as readonly string[]).includes(value);
}

function isAuthStrategy(value: string): value is ProviderAuthStrategy {
  return (PROVIDER_AUTH_STRATEGIES as readonly string[]).includes(value);
}
