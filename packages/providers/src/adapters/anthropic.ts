import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { anthropicCapabilities } from "../capabilities";
import { MAX_DISCOVERED_MODELS } from "../model-catalog";
import { normalizeProviderToolCall } from "../tool-calls";
import type {
  BaseModel,
  ChatMessage,
  ModelProviderAdapter,
  ProviderInstance,
  ProviderTokenUsage,
  StreamChatChunk,
  StreamChatInput,
} from "../types";
import { normalizeProviderSdkError } from "./provider-sdk";

export const anthropicAdapter: ModelProviderAdapter = {
  kind: "anthropic",
  async health(provider, options) {
    const models = await discoverAnthropicModels(
      { ...provider, modelIds: [] },
      options,
    );
    return models.length > 0
      ? {
          ok: true,
          message: `Anthropic connection available (${models.length} model${models.length === 1 ? "" : "s"}).`,
        }
      : {
          ok: false,
          message:
            "Anthropic returned no models. Check the API key, /v1 base URL, and Models API access.",
        };
  },
  listModels: discoverAnthropicModels,
  streamChat(input) {
    if (input.apiKey === undefined) return credentialUnavailableStream();
    return streamAnthropicChat(input);
  },
};

async function discoverAnthropicModels(
  provider: Parameters<ModelProviderAdapter["listModels"]>[0],
  options?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<BaseModel[]> {
  let ids = provider.modelIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  if (ids.length === 0) {
    if (options?.apiKey === undefined) return [];
    try {
      const client = createAnthropicClient(
        provider,
        options.apiKey,
        options.fetchImpl,
        options.timeoutMs,
      );
      ids = [];
      for await (const model of client.models.list({ limit: 100 })) {
        if (model.id.trim()) ids.push(model.id.trim());
        if (ids.length >= MAX_DISCOVERED_MODELS) break;
      }
    } catch {
      return [];
    }
  }
  return [...new Set(ids)]
    .slice(0, MAX_DISCOVERED_MODELS)
    .sort()
    .map((name) => ({
      id: `model_${provider.id}_${modelIdPart(name)}`,
      providerId: provider.id,
      name,
      displayName: name,
      enabled: true,
      capabilities: anthropicCapabilities,
      contextWindow: 200_000,
    }));
}

async function* credentialUnavailableStream(): AsyncIterable<StreamChatChunk> {
  throw { errorCode: "provider_credential_unavailable" };
}

async function* streamAnthropicChat(
  input: StreamChatInput,
): AsyncIterable<StreamChatChunk> {
  const client = createAnthropicClient(
    input.provider,
    input.apiKey!,
    input.fetchImpl,
  );
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  const request: MessageCreateParamsStreaming = {
    model: input.model.name,
    max_tokens: outputTokenLimit(input.model.contextWindow),
    stream: true,
    ...(system ? { system } : {}),
    messages: input.messages
      .filter((message) => message.role !== "system")
      .map(toAnthropicMessage),
    ...(input.tools?.length ? { tools: input.tools.map(toAnthropicTool) } : {}),
  };

  const tools = new AnthropicToolAccumulator();
  let inputTokens: number | undefined;
  try {
    const stream = await client.messages.create(request, {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    for await (const event of stream) {
      const usage = usageFromAnthropicEvent(event, inputTokens);
      if (event.type === "message_start")
        inputTokens = event.message.usage.input_tokens;
      if (usage !== undefined) yield { type: "usage", usage };

      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text.length > 0
      ) {
        yield event.delta.text;
      }
      const calls = tools.merge(event);
      if (calls.length === 1) yield { type: "tool_call", toolCall: calls[0]! };
      if (calls.length > 1)
        yield { type: "tool_call", toolCall: calls[0]!, toolCalls: calls };
    }
  } catch (caught) {
    throw normalizeProviderSdkError(caught, "anthropic");
  }
}

function createAnthropicClient(
  provider: Pick<ProviderInstance, "baseUrl">,
  apiKey: string,
  fetchImpl: typeof fetch | undefined,
  timeoutMs?: number,
): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: sdkBaseUrl(provider.baseUrl),
    maxRetries: 0,
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

function sdkBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/?$/u, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function toAnthropicTool(
  tool: NonNullable<StreamChatInput["tools"]>[number],
): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Tool.InputSchema,
  };
}

function toAnthropicMessage(message: ChatMessage): MessageParam {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? "",
          content: message.content,
        },
      ],
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: [
        ...(message.content
          ? ([{ type: "text", text: message.content }] as const)
          : []),
        ...message.toolCalls.map((call) => ({
          type: "tool_use" as const,
          id: call.providerCallId,
          name: call.name,
          input: call.arguments,
        })),
      ],
    };
  }
  if (message.role === "user" && message.images?.length) {
    return {
      role: "user",
      content: [
        ...message.images.map((image) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: image.mimeType,
            data: stripDataUrl(image.dataBase64),
          },
        })),
        { type: "text", text: message.content },
      ],
    };
  }
  return {
    role: message.role as "assistant" | "user",
    content: message.content,
  };
}

class AnthropicToolAccumulator {
  private readonly values = new Map<
    number,
    { id?: string; name?: string; json: string }
  >();

  merge(event: RawMessageStreamEvent) {
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "tool_use"
    ) {
      this.values.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        json: "",
      });
      return [];
    }
    const current = "index" in event ? this.values.get(event.index) : undefined;
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta" &&
      current
    ) {
      current.json += event.delta.partial_json;
      return [];
    }
    if (event.type !== "content_block_stop" || current === undefined) return [];
    this.values.delete(event.index);
    const normalized = normalizeProviderToolCall({
      id: current.id,
      name: current.name,
      arguments: current.json || "{}",
    });
    return normalized === undefined ? [] : [normalized];
  }
}

function usageFromAnthropicEvent(
  event: RawMessageStreamEvent,
  priorInputTokens: number | undefined,
): ProviderTokenUsage | undefined {
  const usage =
    event.type === "message_start"
      ? event.message.usage
      : event.type === "message_delta"
        ? event.usage
        : undefined;
  if (usage === undefined) return undefined;
  const inputTokens =
    "input_tokens" in usage && typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : priorInputTokens;
  const outputTokens = usage.output_tokens;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    outputTokens,
    ...(inputTokens === undefined
      ? {}
      : { totalTokens: inputTokens + outputTokens }),
    source: "anthropic",
  };
}

function outputTokenLimit(contextWindow: number): number {
  return Math.max(1, Math.min(8_192, Math.floor(contextWindow / 4) || 4_096));
}

function modelIdPart(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 80) || "model"
  );
}

function stripDataUrl(value: string): string {
  return value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
}
