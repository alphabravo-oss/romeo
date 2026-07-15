import { openAiCompatibleCapabilities } from "../capabilities";
import {
  normalizeProviderToolCall,
  type ProviderToolCallRequest,
} from "../tool-calls";
import type {
  BaseModel,
  ChatMessage,
  ModelProviderAdapter,
  StreamChatChunk,
  StreamChatInput,
} from "../types";
import { usageFromOpenAiPayload } from "../usage";
import { devEchoStream } from "./dev-echo";
import { readSseJson } from "./sse-json";

export const openAiCompatibleAdapter: ModelProviderAdapter = {
  kind: "openai-compatible",
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
        id: `model_${provider.id}_default`,
        providerId: provider.id,
        name: "gpt-compatible",
        displayName: "OpenAI-compatible default",
        enabled: true,
        capabilities: openAiCompatibleCapabilities,
        contextWindow: 128000,
      },
    ];
  },
  streamChat(input) {
    if (input.apiKey === undefined) {
      if (input.provider.credentialRef !== undefined) {
        return providerCredentialUnavailableStream();
      }
      return devEchoStream(input, "Romeo OpenAI-compatible response:");
    }
    return streamOpenAiCompatibleChat(input);
  },
};

async function* providerCredentialUnavailableStream(): AsyncIterable<StreamChatChunk> {
  throw { errorCode: "provider_credential_unavailable" };
}

async function* streamOpenAiCompatibleChat(
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
      messages: input.messages.map(toOpenAiMessage),
      stream: true,
      stream_options: { include_usage: true },
      ...(input.tools === undefined || input.tools.length === 0
        ? {}
        : {
            tool_choice: "auto",
            tools: input.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }),
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  const response = await (input.fetchImpl ?? fetch)(
    chatCompletionsUrl(input),
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

  const toolCalls = new ToolCallAccumulator();
  for await (const payload of readSseJson(response.body)) {
    const usage = usageFromOpenAiPayload(payload);
    if (usage !== undefined) yield { type: "usage", usage };

    for (const token of textDeltas(payload)) yield token;
    toolCalls.merge(payload);
    if (hasToolCallFinish(payload)) {
      const flushed = toolCalls.flush();
      if (flushed.length === 1)
        yield { type: "tool_call", toolCall: flushed[0]! };
      if (flushed.length > 1)
        yield {
          type: "tool_call",
          toolCall: flushed[0]!,
          toolCalls: flushed,
        };
    }
  }
}

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map(toOpenAiToolCall),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      ...(message.name === undefined ? {} : { name: message.name }),
      ...(message.toolCallId === undefined
        ? {}
        : { tool_call_id: message.toolCallId }),
    };
  }

  return { role: message.role, content: message.content };
}

function toOpenAiToolCall(
  toolCall: ProviderToolCallRequest,
): Record<string, unknown> {
  return {
    id: toolCall.providerCallId,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function chatCompletionsUrl(input: StreamChatInput): string {
  return new URL(
    "chat/completions",
    input.provider.baseUrl.endsWith("/")
      ? input.provider.baseUrl
      : `${input.provider.baseUrl}/`,
  ).toString();
}

function textDeltas(payload: unknown): string[] {
  return choices(payload).flatMap((choice) => {
    const delta = asRecord(choice.delta);
    const content = delta?.content;
    return typeof content === "string" && content.length > 0 ? [content] : [];
  });
}

function hasToolCallFinish(payload: unknown): boolean {
  return choices(payload).some(
    (choice) => choice.finish_reason === "tool_calls",
  );
}

function choices(payload: unknown): Array<Record<string, unknown>> {
  const record = asRecord(payload);
  return Array.isArray(record?.choices)
    ? record.choices.flatMap((choice) => {
        const value = asRecord(choice);
        return value === undefined ? [] : [value];
      })
    : [];
}

class ToolCallAccumulator {
  private readonly calls = new Map<
    number,
    { arguments: string; id?: string; name?: string }
  >();

  merge(payload: unknown): void {
    for (const choice of choices(payload)) {
      const delta = asRecord(choice.delta);
      const toolCalls = Array.isArray(delta?.tool_calls)
        ? delta.tool_calls
        : [];
      for (const rawCall of toolCalls) {
        const call = asRecord(rawCall);
        if (call === undefined) continue;
        const index = typeof call.index === "number" ? call.index : 0;
        const existing = this.calls.get(index) ?? { arguments: "" };
        if (typeof call.id === "string") existing.id = call.id;
        const fn = asRecord(call.function);
        if (typeof fn?.name === "string") existing.name = fn.name;
        if (typeof fn?.arguments === "string") {
          existing.arguments += fn.arguments;
        }
        this.calls.set(index, existing);
      }
    }
  }

  flush(): ProviderToolCallRequest[] {
    const normalized = [...this.calls.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, call]) => {
        const toolCall = normalizeProviderToolCall({
          id: call.id,
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        });
        return toolCall === undefined ? [] : [toolCall];
      });
    this.calls.clear();
    return normalized;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
