import type {
  BaseModel,
  ProviderInstance,
  ProviderTokenUsage,
  ProviderToolCallRequest,
  StreamChatInput,
  StreamChatChunk,
} from "@romeo/providers";
import { translateProviderChatParameters } from "@romeo/providers";
import type { OpenAiChatCompletionRequest } from "@romeo/contracts";

import { providerChatApiError } from "./provider-api-error";

export function assertOpenAiChatProviderParameters(
  request: OpenAiChatCompletionRequest,
  target: { model: BaseModel; provider: ProviderInstance },
): void {
  try {
    translateProviderChatParameters({
      kind: target.provider.type,
      model: target.model,
      provider: target.provider,
      ...providerToolFields(request),
      ...providerParameterFields(request),
    });
  } catch (error) {
    throw providerChatApiError(error, target.provider.type);
  }
}

export function providerParameterFields(
  request: OpenAiChatCompletionRequest,
): Pick<StreamChatInput, "reasoning" | "sampling" | "structuredOutput"> {
  return {
    ...(request.sampling === undefined ? {} : { sampling: request.sampling }),
    ...(request.reasoning === undefined
      ? {}
      : { reasoning: request.reasoning }),
    ...(request.structuredOutput === undefined
      ? {}
      : { structuredOutput: request.structuredOutput }),
  };
}

export function providerToolFields(
  request: OpenAiChatCompletionRequest,
): Pick<StreamChatInput, "tools"> {
  return request.tools === undefined || request.tools.length === 0
    ? {}
    : {
        tools: request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description ?? "",
          parameters: tool.function.parameters ?? { type: "object" },
        })),
      };
}

export function toolCallsFromChunk(
  chunk: Extract<StreamChatChunk, { type: "tool_call" }>,
): ProviderToolCallRequest[] {
  return chunk.toolCalls ?? [chunk.toolCall];
}

export function dedupeToolCalls(
  toolCalls: ProviderToolCallRequest[],
): ProviderToolCallRequest[] {
  return [
    ...new Map(
      toolCalls.map((toolCall) => [toolCall.providerCallId, toolCall]),
    ).values(),
  ];
}

export function isUsageChunk(
  chunk: Exclude<StreamChatChunk, string>,
): chunk is { type: "usage"; usage: ProviderTokenUsage } {
  return chunk.type === "usage";
}

export function isToolCallChunk(
  chunk: Exclude<StreamChatChunk, string>,
): chunk is Extract<StreamChatChunk, { type: "tool_call" }> {
  return chunk.type === "tool_call";
}
