import type {
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
  OpenAiCompletionUsage,
  OpenAiToolCall,
} from "@romeo/contracts";
import type {
  ProviderTokenUsage,
  ProviderToolCallRequest,
  StreamChatChunk,
} from "@romeo/providers";

import { createId } from "../ids";
import {
  dedupeToolCalls,
  isToolCallChunk,
  isUsageChunk,
  toolCallsFromChunk,
} from "./openai-chat-chunk-helpers";
import {
  chatCompletionChunk,
  createdSeconds,
} from "./openai-chat-completion-protocol";

export interface ProviderOutput {
  content: string;
  toolCalls: ProviderToolCallRequest[];
  toolArgumentCharacters?: number;
  usage?: ProviderTokenUsage;
}

const MAX_COMPATIBILITY_OUTPUT_CHARACTERS = 2_000_000;
const MAX_COMPATIBILITY_TOOL_CALL_CHUNKS = 4_096;
const MAX_COMPATIBILITY_TOOL_ARGUMENT_CHARACTERS = 1_000_000;
const MAX_COMPATIBILITY_TOOL_ARGUMENT_KEYS = 256;

export function collectChatProviderChunk(
  output: ProviderOutput,
  chunk: StreamChatChunk,
): void {
  if (typeof chunk === "string") {
    output.content += chunk;
    if (output.content.length > MAX_COMPATIBILITY_OUTPUT_CHARACTERS)
      throw new Error("Provider chat output exceeded the compatibility limit.");
    return;
  }
  if (isUsageChunk(chunk)) {
    output.usage = chunk.usage;
    return;
  }
  if (isToolCallChunk(chunk)) {
    const toolCalls = toolCallsFromChunk(chunk);
    const argumentCharacters = toolCalls.reduce((total, toolCall) => {
      if (toolCall.argumentKeys.length > MAX_COMPATIBILITY_TOOL_ARGUMENT_KEYS)
        throw new Error("Provider tool-call arguments exceeded the key limit.");
      return total + JSON.stringify(toolCall.arguments).length;
    }, 0);
    output.toolArgumentCharacters =
      (output.toolArgumentCharacters ?? 0) + argumentCharacters;
    if (
      output.toolArgumentCharacters > MAX_COMPATIBILITY_TOOL_ARGUMENT_CHARACTERS
    )
      throw new Error("Provider tool-call arguments exceeded the size limit.");
    output.toolCalls.push(...toolCalls);
    if (output.toolCalls.length > MAX_COMPATIBILITY_TOOL_CALL_CHUNKS)
      throw new Error(
        "Provider tool-call output exceeded the compatibility limit.",
      );
  }
  if (
    (chunk.type === "reasoning" || chunk.type === "reasoning_summary") &&
    chunk.text.length > MAX_COMPATIBILITY_OUTPUT_CHARACTERS
  )
    throw new Error(
      "Provider reasoning output exceeded the compatibility limit.",
    );
}

export function openAiChatCompletionStream(
  request: OpenAiChatCompletionRequest,
  output: ProviderOutput,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = createId("chatcmpl");
  const created = createdSeconds();
  const frames = completionStreamFrames(request, output, id, created);

  return new ReadableStream({
    pull(controller) {
      const next = frames.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(
          next.value === streamDone
            ? "data: [DONE]\n\n"
            : `data: ${JSON.stringify(next.value)}\n\n`,
        ),
      );
    },
    cancel() {
      frames.return(undefined);
    },
  });
}

const streamDone = Symbol("stream_done");

function* completionStreamFrames(
  request: OpenAiChatCompletionRequest,
  output: ProviderOutput,
  id: string,
  created: number,
): Generator<unknown | typeof streamDone> {
  yield chatCompletionChunk(id, created, request.model, {
    role: "assistant",
  });
  for (let offset = 0; offset < output.content.length; offset += 16_384)
    yield chatCompletionChunk(id, created, request.model, {
      content: output.content.slice(offset, offset + 16_384),
    });
  const toolCalls = dedupeToolCalls(output.toolCalls);
  for (const [index, toolCall] of toolCalls.entries())
    yield chatCompletionChunk(id, created, request.model, {
      tool_calls: [toOpenAiToolCallDelta(toolCall, index)],
    });
  yield chatCompletionChunk(
    id,
    created,
    request.model,
    {},
    toolCalls.length > 0 ? "tool_calls" : "stop",
  );
  if (
    request.streamOptions?.includeUsage === true &&
    output.usage !== undefined
  )
    yield {
      id,
      object: "chat.completion.chunk",
      created,
      model: request.model,
      choices: [],
      usage: toOpenAiUsage(output.usage),
    };
  yield streamDone;
}

export function chatCompletionResponse(
  requestedModel: string,
  output: ProviderOutput,
): OpenAiChatCompletionResponse {
  const toolCalls = dedupeToolCalls(output.toolCalls);
  return {
    id: createId("chatcmpl"),
    object: "chat.completion",
    created: createdSeconds(),
    model: requestedModel,
    choices: [
      {
        index: 0,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content:
            toolCalls.length > 0 && output.content.length === 0
              ? null
              : output.content,
          ...(toolCalls.length === 0
            ? {}
            : { tool_calls: toolCalls.map(toOpenAiToolCall) }),
        },
      },
    ],
    usage: output.usage === undefined ? null : toOpenAiUsage(output.usage),
  };
}

function toOpenAiToolCall(toolCall: ProviderToolCallRequest): OpenAiToolCall {
  return {
    id: toolCall.providerCallId,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function toOpenAiToolCallDelta(
  toolCall: ProviderToolCallRequest,
  index: number,
) {
  return {
    index,
    id: toolCall.providerCallId,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function toOpenAiUsage(usage: ProviderTokenUsage): OpenAiCompletionUsage {
  return {
    ...(usage.inputTokens === undefined
      ? {}
      : { prompt_tokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? {}
      : { completion_tokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined
      ? {}
      : { total_tokens: usage.totalTokens }),
    ...(usage.cachedInputTokens === undefined
      ? {}
      : { prompt_tokens_details: { cached_tokens: usage.cachedInputTokens } }),
    ...(usage.reasoningTokens === undefined
      ? {}
      : {
          completion_tokens_details: {
            reasoning_tokens: usage.reasoningTokens,
          },
        }),
  };
}
