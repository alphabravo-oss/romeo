import type {
  ProviderChatParameterOmission,
  ProviderChatParameterResolutionSummary,
  ProviderChatParameterSnapshot,
  ProviderReasoningParameters,
  ProviderStructuredOutput,
} from "./chat-parameter-types";
import type {
  ProviderKind,
  ProviderSampling,
  ProviderToolDefinition,
  StreamChatInput,
} from "./types";
import { ProviderNormalizedRequestError } from "./error-normalization";
import { resolveProviderReasoningPolicy } from "./reasoning-policy";

const MAX_SCHEMA_BYTES = 65_536;
const MAX_TOOLS = 64;
const MAX_OUTPUT_TOKENS = 200_000;

interface DialectParameterPolicy {
  reasoningEffort: boolean;
  reasoningSummary: boolean;
  structuredOutput: boolean;
  temperatureMax: number;
  toolNameMaxLength: number;
}

const policies = {
  anthropic: {
    reasoningEffort: false,
    reasoningSummary: false,
    structuredOutput: false,
    temperatureMax: 1,
    toolNameMaxLength: 64,
  },
  ollama: {
    reasoningEffort: false,
    reasoningSummary: false,
    structuredOutput: false,
    temperatureMax: 2,
    toolNameMaxLength: 64,
  },
  "openai-compatible": {
    reasoningEffort: true,
    reasoningSummary: false,
    structuredOutput: true,
    temperatureMax: 2,
    toolNameMaxLength: 64,
  },
  "openai-responses-compatible": {
    reasoningEffort: true,
    reasoningSummary: true,
    structuredOutput: true,
    temperatureMax: 2,
    toolNameMaxLength: 64,
  },
} as const satisfies Record<ProviderKind, DialectParameterPolicy>;

export interface TranslatedProviderChatParameters {
  readonly effective: {
    reasoning?: ProviderReasoningParameters;
    sampling?: ProviderSampling;
    structuredOutput?: ProviderStructuredOutput;
    tools?: ProviderToolDefinition[];
  };
  readonly summary: ProviderChatParameterResolutionSummary;
}

/**
 * Resolves generic chat knobs against both protocol and selected model/provider
 * support. Invalid or unsupported values are omitted before an SDK sees them.
 */
export function translateProviderChatParameters(
  input: Pick<
    StreamChatInput,
    | "model"
    | "provider"
    | "reasoning"
    | "reasoningPolicy"
    | "sampling"
    | "structuredOutput"
    | "tools"
  > & { kind?: ProviderKind },
): TranslatedProviderChatParameters {
  const kind = input.kind ?? input.provider.type;
  const policy = policies[kind];
  const omissions: ProviderChatParameterOmission[] = [];
  const requested = requestedSnapshot(input);
  const sampling = effectiveSampling(input, policy, omissions);
  const reasoningPolicy =
    input.reasoningPolicy === undefined
      ? undefined
      : resolveProviderReasoningPolicy({
          kind,
          layers: input.reasoningPolicy,
          model: input.model,
          provider: input.provider,
        });
  if (reasoningPolicy?.rejected === true) {
    throw new ProviderNormalizedRequestError({
      category: "invalid_request_or_capability",
      code: "provider_invalid_request_or_capability",
      errorCode: "provider_invalid_request_or_capability",
      errorType: "invalid_request_or_capability",
      kind,
      operation: "chat",
      retryable: false,
      safeMessage: "The requested reasoning policy cannot be enforced.",
      status: 400,
    });
  }
  const reasoning =
    reasoningPolicy === undefined
      ? effectiveReasoning(input, policy, omissions)
      : reasoningPolicy.nativeParameters;
  const structuredOutput = effectiveStructuredOutput(input, policy, omissions);
  const tools = effectiveTools(input, policy, omissions);
  const effective = {
    ...(sampling === undefined ? {} : { sampling }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
    ...(tools === undefined ? {} : { tools }),
  };
  return Object.freeze({
    effective,
    summary: Object.freeze({
      effective: requestedSnapshot(effective),
      omissions: Object.freeze(omissions),
      ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
      requested,
    }),
  });
}

export function hasRequestedProviderChatParameters(
  summary: ProviderChatParameterResolutionSummary,
): boolean {
  return (
    Object.keys(summary.requested).length > 0 ||
    summary.omissions.length > 0 ||
    summary.reasoningPolicy !== undefined
  );
}

function effectiveSampling(
  input: Parameters<typeof translateProviderChatParameters>[0],
  policy: DialectParameterPolicy,
  omissions: ProviderChatParameterOmission[],
): ProviderSampling | undefined {
  const requested = input.sampling;
  if (requested === undefined) return undefined;
  const supportsTemperature =
    input.provider.capabilities?.temperature !== false &&
    input.model.capabilities?.temperature !== false;
  const sampling: ProviderSampling = {};
  if (requested.temperature !== undefined) {
    if (!supportsTemperature) {
      omit(
        omissions,
        "sampling.temperature",
        "unsupported_by_model_or_provider",
      );
    } else if (
      !boundedNumber(requested.temperature, 0, policy.temperatureMax)
    ) {
      omit(omissions, "sampling.temperature", "invalid_value");
    } else sampling.temperature = requested.temperature;
  }
  if (requested.topP !== undefined) {
    if (!supportsTemperature) {
      omit(omissions, "sampling.topP", "unsupported_by_model_or_provider");
    } else if (!boundedNumber(requested.topP, 0, 1)) {
      omit(omissions, "sampling.topP", "invalid_value");
    } else sampling.topP = requested.topP;
  }
  if (requested.maxTokens !== undefined) {
    const modelLimit = validPositiveInteger(input.model.contextWindow)
      ? Math.min(input.model.contextWindow, MAX_OUTPUT_TOKENS)
      : MAX_OUTPUT_TOKENS;
    if (
      !validPositiveInteger(requested.maxTokens) ||
      requested.maxTokens > modelLimit
    ) {
      omit(omissions, "sampling.maxTokens", "invalid_value");
    } else sampling.maxTokens = requested.maxTokens;
  }
  return Object.keys(sampling).length === 0 ? undefined : sampling;
}

function effectiveReasoning(
  input: Parameters<typeof translateProviderChatParameters>[0],
  policy: DialectParameterPolicy,
  omissions: ProviderChatParameterOmission[],
): ProviderReasoningParameters | undefined {
  const requested = input.reasoning;
  if (requested === undefined || Object.keys(requested).length === 0)
    return undefined;
  if (!supportsCapability(input, "reasoning")) {
    omit(omissions, "reasoning", "unsupported_by_model_or_provider");
    return undefined;
  }
  const effective: ProviderReasoningParameters = {};
  if (requested.effort !== undefined) {
    if (!reasoningEffort(requested.effort))
      omit(omissions, "reasoning.effort", "invalid_value");
    else if (!policy.reasoningEffort)
      omit(omissions, "reasoning.effort", "unsupported_by_dialect");
    else effective.effort = requested.effort;
  }
  if (requested.summary !== undefined) {
    if (!reasoningSummary(requested.summary))
      omit(omissions, "reasoning.summary", "invalid_value");
    else if (!policy.reasoningSummary)
      omit(omissions, "reasoning.summary", "unsupported_by_dialect");
    else effective.summary = requested.summary;
  }
  return Object.keys(effective).length === 0 ? undefined : effective;
}

function effectiveStructuredOutput(
  input: Parameters<typeof translateProviderChatParameters>[0],
  policy: DialectParameterPolicy,
  omissions: ProviderChatParameterOmission[],
): ProviderStructuredOutput | undefined {
  const requested = input.structuredOutput;
  if (requested === undefined) return undefined;
  if (!policy.structuredOutput) {
    omit(omissions, "structuredOutput", "unsupported_by_dialect");
    return undefined;
  }
  if (!supportsCapability(input, "structuredJson")) {
    omit(omissions, "structuredOutput", "unsupported_by_model_or_provider");
    return undefined;
  }
  if (!validStructuredOutput(requested)) {
    omit(omissions, "structuredOutput", "invalid_value");
    return undefined;
  }
  return requested;
}

function effectiveTools(
  input: Parameters<typeof translateProviderChatParameters>[0],
  policy: DialectParameterPolicy,
  omissions: ProviderChatParameterOmission[],
): ProviderToolDefinition[] | undefined {
  const requested = input.tools;
  if (requested === undefined || requested.length === 0) return undefined;
  if (!supportsCapability(input, "toolCalling")) {
    omit(omissions, "tools", "unsupported_by_model_or_provider");
    return undefined;
  }
  if (
    requested.length > MAX_TOOLS ||
    requested.some((tool) => !validTool(tool, policy))
  ) {
    // A partial set changes what the model is allowed to do. Reject before an adapter can start a
    // provider request rather than running a tool-less or partially tooled prompt.
    throw new ProviderNormalizedRequestError({
      category: "invalid_request_or_capability",
      code: "provider_invalid_request_or_capability",
      errorCode: "provider_invalid_request_or_capability",
      errorType: "invalid_request_or_capability",
      kind: input.kind ?? input.provider.type,
      operation: "chat",
      retryable: false,
      safeMessage: "The provider request contains an invalid tool definition.",
      status: 400,
    });
  }
  return requested;
}

function requestedSnapshot(input: {
  reasoning?: ProviderReasoningParameters;
  sampling?: ProviderSampling;
  structuredOutput?: ProviderStructuredOutput;
  tools?: readonly ProviderToolDefinition[];
}): ProviderChatParameterSnapshot {
  return {
    ...(input.sampling === undefined
      ? {}
      : {
          sampling: {
            ...(finiteNumber(input.sampling.temperature)
              ? { temperature: input.sampling.temperature }
              : {}),
            ...(finiteNumber(input.sampling.topP)
              ? { topP: input.sampling.topP }
              : {}),
            ...(finiteNumber(input.sampling.maxTokens)
              ? { maxTokens: input.sampling.maxTokens }
              : {}),
          },
        }),
    ...(input.reasoning === undefined
      ? {}
      : {
          reasoning: {
            ...(reasoningEffort(input.reasoning.effort)
              ? { effort: input.reasoning.effort }
              : {}),
            ...(reasoningSummary(input.reasoning.summary)
              ? { summary: input.reasoning.summary }
              : {}),
          },
        }),
    ...(input.structuredOutput?.type === "json_object"
      ? { structuredOutput: { type: "json_object" as const } }
      : input.structuredOutput?.type === "json_schema"
        ? {
            structuredOutput: {
              type: "json_schema" as const,
              ...(input.structuredOutput.strict === undefined
                ? {}
                : { strict: input.structuredOutput.strict }),
            },
          }
        : {}),
    ...(input.tools === undefined || input.tools.length === 0
      ? {}
      : { tools: { count: input.tools.length } }),
  };
}

function supportsCapability(
  input: Parameters<typeof translateProviderChatParameters>[0],
  capability: "reasoning" | "structuredJson" | "toolCalling",
): boolean {
  return (
    input.provider.capabilities?.[capability] === true &&
    input.model.capabilities?.[capability] === true
  );
}

function validStructuredOutput(value: ProviderStructuredOutput): boolean {
  if (value.type === "json_object") return true;
  return (
    value.type === "json_schema" &&
    /^[A-Za-z0-9_-]{1,64}$/u.test(value.name) &&
    plainRecord(value.schema) &&
    jsonSize(value.schema) <= MAX_SCHEMA_BYTES &&
    (value.strict === undefined || typeof value.strict === "boolean")
  );
}

function validTool(
  tool: ProviderToolDefinition,
  policy: DialectParameterPolicy,
): boolean {
  return (
    typeof tool.name === "string" &&
    tool.name.length <= policy.toolNameMaxLength &&
    /^[A-Za-z0-9_-]+$/u.test(tool.name) &&
    typeof tool.description === "string" &&
    tool.description.length <= 2_000 &&
    plainRecord(tool.parameters) &&
    jsonSize(tool.parameters) <= MAX_SCHEMA_BYTES
  );
}

function jsonSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function reasoningEffort(value: unknown): value is "high" | "low" | "medium" {
  return value === "high" || value === "low" || value === "medium";
}

function reasoningSummary(
  value: unknown,
): value is "auto" | "concise" | "detailed" {
  return value === "auto" || value === "concise" || value === "detailed";
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return finiteNumber(value) && value >= minimum && value <= maximum;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function omit(
  omissions: ProviderChatParameterOmission[],
  parameter: ProviderChatParameterOmission["parameter"],
  reason: ProviderChatParameterOmission["reason"],
): void {
  omissions.push({ parameter, reason });
}
