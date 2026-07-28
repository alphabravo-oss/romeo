import { openAiResponsesCompatibleCapabilities } from "../capabilities";
import {
  normalizeProviderToolCall,
  normalizeProviderToolCalls,
  type ProviderToolCallRequest,
} from "../tool-calls";
import type {
  BaseModel,
  ChatMessage,
  ModelProviderAdapter,
  StreamChatChunk,
  StreamChatInput,
} from "../types";
import { usageFromOpenAiResponsesPayload } from "../usage";
import { devEchoStream } from "./dev-echo";
import { discoverCompatibleModels } from "./openai-compatible";
import { createOpenAiClient, normalizeProviderSdkError } from "./provider-sdk";

type ResponsesInputItem = ResponseInputItem;

export const openAiResponsesCompatibleAdapter: ModelProviderAdapter = {
  kind: "openai-responses-compatible",
  async health(provider, options) {
    const models = await discoverCompatibleModels(
      { ...provider, modelIds: [] },
      openAiResponsesCompatibleCapabilities,
      options,
    );
    return models.length > 0
      ? {
          ok: true,
          message: `Connection available (${models.length} model${models.length === 1 ? "" : "s"}).`,
        }
      : { ok: false, message: "The endpoint returned no discoverable models." };
  },
  async listModels(provider, options): Promise<BaseModel[]> {
    return discoverCompatibleModels(
      provider,
      openAiResponsesCompatibleCapabilities,
      options,
    );
  },
  streamChat(input) {
    if (input.apiKey === undefined) {
      if (input.provider.credentialRef !== undefined) {
        return providerCredentialUnavailableStream();
      }
      return devEchoStream(
        input,
        "Romeo OpenAI Responses-compatible response:",
      );
    }
    return streamOpenAiResponsesCompatible(input);
  },
};

async function* providerCredentialUnavailableStream(): AsyncIterable<StreamChatChunk> {
  throw { errorCode: "provider_credential_unavailable" };
}

async function* streamOpenAiResponsesCompatible(
  input: StreamChatInput,
): AsyncIterable<StreamChatChunk> {
  const client = createOpenAiClient(
    input.provider,
    input.apiKey,
    input.fetchImpl,
  );
  const request: ResponseCreateParamsStreaming = {
    model: input.model.name,
    input: input.messages.flatMap(toResponsesInputItems),
    stream: true,
    store: false,
    ...(input.tools === undefined || input.tools.length === 0
      ? {}
      : {
          tool_choice: "auto",
          tools: input.tools.map(
            (tool): FunctionTool => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false,
            }),
          ),
        }),
  };

  try {
    const stream = await client.responses.create(
      request,
      input.signal === undefined ? undefined : { signal: input.signal },
    );
    const toolCalls = new ResponsesToolCallAccumulator();
    for await (const event of stream) {
      const usage = usageFromOpenAiResponsesPayload(event);
      if (usage !== undefined) yield { type: "usage", usage };

      for (const token of textDeltas(event)) yield token;
      const calls = toolCalls.merge(event);
      if (calls.length === 1) yield { type: "tool_call", toolCall: calls[0]! };
      if (calls.length > 1) {
        yield {
          type: "tool_call",
          toolCall: calls[0]!,
          toolCalls: calls,
        };
      }
      if (eventType(event) === "error") {
        throw { errorCode: "provider_stream_error", errorType: "event_error" };
      }
    }
  } catch (caught) {
    throw normalizeProviderSdkError(caught, "openai-responses-compatible");
  }
}

function toResponsesInputItems(message: ChatMessage): ResponsesInputItem[] {
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return [
      ...(message.content.length === 0
        ? []
        : [{ role: "assistant" as const, content: message.content }]),
      ...message.toolCalls.map(toResponsesFunctionCall),
    ];
  }

  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.toolCallId ?? "",
        output: message.content,
      },
    ];
  }

  if (message.role === "user" && message.images?.length) {
    return [
      {
        role: "user",
        content: [
          { type: "input_text", text: message.content },
          ...message.images.map((image) => ({
            type: "input_image" as const,
            image_url: `data:${image.mimeType};base64,${stripDataUrl(image.dataBase64)}`,
            detail: "auto" as const,
          })),
        ],
      },
    ];
  }
  return [
    {
      role: message.role as "assistant" | "system" | "user",
      content: message.content,
    },
  ];
}

function stripDataUrl(value: string): string {
  return value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
}

function toResponsesFunctionCall(
  toolCall: ProviderToolCallRequest,
): ResponsesInputItem {
  return {
    type: "function_call",
    call_id: toolCall.providerCallId,
    name: toolCall.name,
    arguments: JSON.stringify(toolCall.arguments),
  };
}

function textDeltas(payload: unknown): string[] {
  const record = asRecord(payload);
  if (record === undefined) return [];
  if (record.type === "response.output_text.delta") {
    return typeof record.delta === "string" && record.delta.length > 0
      ? [record.delta]
      : [];
  }
  return [];
}

class ResponsesToolCallAccumulator {
  private readonly calls = new Map<
    string,
    { arguments: string; callId?: string; name?: string }
  >();
  private readonly emitted = new Set<string>();

  merge(payload: unknown): ProviderToolCallRequest[] {
    const record = asRecord(payload);
    if (record === undefined) return [];

    const item = asRecord(record.item);
    if (record.type === "response.output_item.added") this.rememberItem(item);

    if (record.type === "response.function_call_arguments.delta") {
      const key = callKey(record);
      if (key !== undefined) {
        const existing = this.calls.get(key) ?? { arguments: "" };
        if (typeof record.call_id === "string")
          existing.callId = record.call_id;
        if (typeof record.name === "string") existing.name = record.name;
        if (typeof record.delta === "string")
          existing.arguments += record.delta;
        this.calls.set(key, existing);
      }
    }

    if (record.type === "response.function_call_arguments.done") {
      const key = callKey(record);
      if (key !== undefined) {
        const existing = this.calls.get(key) ?? { arguments: "" };
        if (typeof record.call_id === "string")
          existing.callId = record.call_id;
        if (typeof record.name === "string") existing.name = record.name;
        if (typeof record.arguments === "string") {
          existing.arguments = record.arguments;
        }
        this.calls.set(key, existing);
        const call = this.flush(key, existing);
        return call === undefined ? [] : [call];
      }
    }

    if (record.type === "response.output_item.done") {
      const calls = normalizeProviderToolCalls(item);
      return calls.filter((call) => this.markEmitted(call.providerCallId));
    }

    const response = asRecord(record.response);
    const output = response?.output;
    if (record.type === "response.completed" && Array.isArray(output)) {
      return normalizeProviderToolCalls(output).filter((call) =>
        this.markEmitted(call.providerCallId),
      );
    }

    return [];
  }

  private rememberItem(item: Record<string, unknown> | undefined): void {
    if (item?.type !== "function_call") return;
    const keys = callKeys(item);
    if (keys.length === 0) return;
    const existing = firstExisting(this.calls, keys) ?? { arguments: "" };
    if (typeof item.call_id === "string") existing.callId = item.call_id;
    if (typeof item.name === "string") existing.name = item.name;
    if (typeof item.arguments === "string") existing.arguments = item.arguments;
    for (const key of keys) this.calls.set(key, existing);
  }

  private flush(
    key: string,
    call: { arguments: string; callId?: string; name?: string },
  ): ProviderToolCallRequest | undefined {
    const normalized = normalizeProviderToolCall({
      call_id: call.callId ?? key,
      name: call.name,
      arguments: call.arguments,
    });
    if (normalized === undefined) return undefined;
    if (!this.markEmitted(normalized.providerCallId)) return undefined;
    this.calls.delete(key);
    return normalized;
  }

  private markEmitted(providerCallId: string): boolean {
    if (this.emitted.has(providerCallId)) return false;
    this.emitted.add(providerCallId);
    return true;
  }
}

function callKey(record: Record<string, unknown>): string | undefined {
  return callKeys(record)[0];
}

function callKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const key of ["item_id", "id", "call_id", "output_index"]) {
    const value = record[key];
    if (
      typeof value === "string" &&
      value.length > 0 &&
      !keys.includes(value)
    ) {
      keys.push(value);
    }
    if (typeof value === "number" && Number.isInteger(value)) {
      const next = String(value);
      if (!keys.includes(next)) keys.push(next);
    }
  }
  return keys;
}

function firstExisting(
  calls: Map<string, { arguments: string; callId?: string; name?: string }>,
  keys: string[],
): { arguments: string; callId?: string; name?: string } | undefined {
  for (const key of keys) {
    const value = calls.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function eventType(payload: unknown): string | undefined {
  return asRecord(payload)?.type as string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
import type {
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
