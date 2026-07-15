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
import { readSseJson } from "./sse-json";

type ResponsesInputItem = Record<string, unknown>;

export const openAiResponsesCompatibleAdapter: ModelProviderAdapter = {
  kind: "openai-responses-compatible",
  async health(provider) {
    return {
      ok: provider.enabled,
      message: provider.enabled
        ? "Provider is configured."
        : "Provider is disabled.",
    };
  },
  async listModels(provider): Promise<BaseModel[]> {
    return [
      {
        id: `model_${provider.id}_responses_default`,
        providerId: provider.id,
        name: "gpt-compatible",
        displayName: "OpenAI Responses-compatible default",
        enabled: true,
        capabilities: openAiResponsesCompatibleCapabilities,
        contextWindow: 128000,
      },
    ];
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
  const request: RequestInit = {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model.name,
      input: input.messages.flatMap(toResponsesInputItems),
      stream: true,
      store: false,
      ...(input.tools === undefined || input.tools.length === 0
        ? {}
        : {
            tool_choice: "auto",
            tools: input.tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          }),
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  const response = await (input.fetchImpl ?? fetch)(
    responsesUrl(input),
    request,
  );

  if (!response.ok) {
    throw {
      errorCode: "provider_http_error",
      errorType: `http_${response.status}`,
    };
  }
  if (response.body === null) {
    throw { errorCode: "provider_stream_error", errorType: "empty_body" };
  }

  const toolCalls = new ResponsesToolCallAccumulator();
  for await (const payload of readSseJson(response.body)) {
    const usage = usageFromOpenAiResponsesPayload(payload);
    if (usage !== undefined) yield { type: "usage", usage };

    for (const token of textDeltas(payload)) yield token;
    const calls = toolCalls.merge(payload);
    if (calls.length === 1) yield { type: "tool_call", toolCall: calls[0]! };
    if (calls.length > 1) {
      yield {
        type: "tool_call",
        toolCall: calls[0]!,
        toolCalls: calls,
      };
    }
    if (eventType(payload) === "error") {
      throw { errorCode: "provider_stream_error", errorType: "event_error" };
    }
  }
}

function toResponsesInputItems(message: ChatMessage): ResponsesInputItem[] {
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return [
      ...(message.content.length === 0
        ? []
        : [{ role: "assistant", content: message.content }]),
      ...message.toolCalls.map(toResponsesFunctionCall),
    ];
  }

  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        ...(message.toolCallId === undefined
          ? {}
          : { call_id: message.toolCallId }),
        output: message.content,
      },
    ];
  }

  return [{ role: message.role, content: message.content }];
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

function responsesUrl(input: StreamChatInput): string {
  return new URL(
    "responses",
    input.provider.baseUrl.endsWith("/")
      ? input.provider.baseUrl
      : `${input.provider.baseUrl}/`,
  ).toString();
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
