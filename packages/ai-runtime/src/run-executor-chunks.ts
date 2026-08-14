import type {
  ProviderToolCallRequest,
  ProviderKind,
  ProviderTokenUsage,
  StreamChatChunk,
  StreamChatInput,
} from "@romeo/providers";
import { providerToolCallRedactionHash } from "@romeo/providers";

import { hiddenReasoningOmitted, providerSafeReasoningSummary } from "./events";
import type {
  ExecuteRunInput,
  ProviderFallbackTarget,
} from "./run-executor-types";

export function providerApiKeyFor(
  input: ExecuteRunInput,
  providerId: string,
): string | undefined {
  const scopedApiKey = input.providerApiKeys?.[providerId];
  if (scopedApiKey !== undefined) return scopedApiKey;
  return providerId === input.provider.id ? input.apiKey : undefined;
}

export function providerToolsForTarget(
  target: ProviderFallbackTarget,
  tools: StreamChatInput["tools"],
): StreamChatInput["tools"] | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  if (
    target.provider.capabilities.toolCalling !== true ||
    target.model.capabilities.toolCalling !== true
  ) {
    return undefined;
  }
  return tools;
}

export function isUsageChunk(
  chunk: StreamChatChunk,
): chunk is { type: "usage"; usage: ProviderTokenUsage } {
  return typeof chunk === "object" && chunk !== null && chunk.type === "usage";
}

export function reasoningChunkEventData(
  chunk: StreamChatChunk,
  privateReasoningAlreadyObserved: boolean,
  retainProviderSafeSummary: boolean,
):
  | {
      observed: true;
      event?: {
        type: "message.reasoning" | "reasoning.summary.delta";
        data: Record<string, unknown>;
      };
    }
  | undefined {
  if (typeof chunk !== "object" || chunk === null) return undefined;
  if (chunk.type === "reasoning")
    return privateReasoningAlreadyObserved
      ? { observed: true }
      : {
          observed: true,
          event: {
            type: "message.reasoning",
            data: { classification: hiddenReasoningOmitted },
          },
        };
  if (chunk.type !== "reasoning_summary") return undefined;
  if (!retainProviderSafeSummary)
    return privateReasoningAlreadyObserved
      ? { observed: true }
      : {
          observed: true,
          event: {
            type: "message.reasoning",
            data: { classification: hiddenReasoningOmitted },
          },
        };
  return {
    observed: true,
    event: {
      type: "reasoning.summary.delta",
      data: {
        classification: providerSafeReasoningSummary,
        text: chunk.text.slice(0, 4_096),
      },
    },
  };
}

export function isToolCallChunk(chunk: StreamChatChunk): chunk is {
  type: "tool_call";
  toolCall: ProviderToolCallRequest;
  toolCalls?: ProviderToolCallRequest[];
} {
  return (
    typeof chunk === "object" && chunk !== null && chunk.type === "tool_call"
  );
}

export function toolCallsFromChunk(chunk: {
  toolCall: ProviderToolCallRequest;
  toolCalls?: ProviderToolCallRequest[];
}): ProviderToolCallRequest[] {
  return chunk.toolCalls === undefined || chunk.toolCalls.length === 0
    ? [chunk.toolCall]
    : chunk.toolCalls;
}

export function providerToolCallRequestedData(
  toolCall: ProviderToolCallRequest,
): {
  argumentCount: number;
  argumentKeys: string[];
  name: string;
  providerCallIdHash: string;
} {
  const argumentKeys = [...toolCall.argumentKeys].sort();
  return {
    argumentCount: argumentKeys.length,
    argumentKeys,
    name: toolCall.name,
    providerCallIdHash: providerToolCallRedactionHash(
      `provider.tool_call.event.v1\0${toolCall.providerCallId}`,
    ),
  };
}

export function sanitizeUsage(
  usage: ProviderTokenUsage,
  trustedSource: ProviderKind,
): ProviderTokenUsage {
  const sanitized: ProviderTokenUsage = {};
  if (isNonNegativeInteger(usage.inputTokens))
    sanitized.inputTokens = usage.inputTokens;
  if (isNonNegativeInteger(usage.cachedInputTokens))
    sanitized.cachedInputTokens = usage.cachedInputTokens;
  if (isNonNegativeInteger(usage.outputTokens))
    sanitized.outputTokens = usage.outputTokens;
  if (isNonNegativeInteger(usage.reasoningTokens))
    sanitized.reasoningTokens = usage.reasoningTokens;
  if (isNonNegativeInteger(usage.totalTokens))
    sanitized.totalTokens = usage.totalTokens;
  // `source` is metadata on a read-wide usage surface. Never accept it from an
  // upstream/custom chunk; stamp the adapter kind selected by the executor.
  sanitized.source = trustedSource;
  return sanitized;
}

export function mergeProviderUsage(
  previous: ProviderTokenUsage | undefined,
  next: ProviderTokenUsage,
): ProviderTokenUsage {
  return {
    ...previous,
    ...next,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}
