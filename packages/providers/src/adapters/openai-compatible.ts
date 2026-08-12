import type {
  ChatCompletionContentPart,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import { openAiCompatibleCapabilities } from "../capabilities";
import { profileDiscoveredModel } from "../model-discovery";
import { MAX_DISCOVERED_MODELS } from "../model-catalog";
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
import { createOpenAiClient, normalizeProviderSdkError } from "./provider-sdk";

export const openAiCompatibleAdapter: ModelProviderAdapter = {
  kind: "openai-compatible",
  async health(provider, options) {
    const models = await discoverCompatibleModels(
      { ...provider, modelIds: [] },
      openAiCompatibleCapabilities,
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
      openAiCompatibleCapabilities,
      options,
    );
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

export async function discoverCompatibleModels(
  provider: Parameters<ModelProviderAdapter["listModels"]>[0],
  capabilities: typeof openAiCompatibleCapabilities,
  options?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<BaseModel[]> {
  let ids = provider.modelIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  const metadataById = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) {
    try {
      const client = createOpenAiClient(
        provider,
        options?.apiKey,
        options?.fetchImpl,
        options?.timeoutMs,
      );
      ids = [];
      for await (const model of client.models.list()) {
        const id = model.id.trim();
        if (!id) continue;
        ids.push(id);
        metadataById.set(id, asRecord(model) ?? {});
        if (ids.length >= MAX_DISCOVERED_MODELS) break;
      }
    } catch {
      return [];
    }
  }
  return [...new Set(ids)]
    .slice(0, MAX_DISCOVERED_MODELS)
    .sort()
    .map((name) => {
      const profile = profileDiscoveredModel({
        base: capabilities,
        fallbackContextWindow: 128000,
        name,
        ...(metadataById.has(name)
          ? { metadata: metadataById.get(name)! }
          : {}),
      });
      return {
        id: `model_${provider.id}_${modelIdPart(name)}`,
        providerId: provider.id,
        name,
        displayName: name,
        enabled: false,
        capabilities: profile.capabilities,
        contextWindow: profile.contextWindow,
        ...(profile.defaultParameters === undefined
          ? {}
          : { defaultParameters: profile.defaultParameters }),
        ...(profile.pricing === undefined ? {} : { pricing: profile.pricing }),
      };
    });
}

function modelIdPart(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized.length > 0 ? normalized.slice(0, 80) : "model";
}

async function* providerCredentialUnavailableStream(): AsyncIterable<StreamChatChunk> {
  throw { errorCode: "provider_credential_unavailable" };
}

async function* streamOpenAiCompatibleChat(
  input: StreamChatInput,
): AsyncIterable<StreamChatChunk> {
  const client = createOpenAiClient(
    input.provider,
    input.apiKey,
    input.fetchImpl,
  );
  try {
    const stream = await client.chat.completions.create(
      {
        model: input.model.name,
        messages: input.messages.map(toOpenAiMessage),
        stream: true,
        stream_options: { include_usage: true },
        ...(input.sampling?.temperature === undefined
          ? {}
          : { temperature: input.sampling.temperature }),
        ...(input.sampling?.topP === undefined
          ? {}
          : { top_p: input.sampling.topP }),
        ...(input.sampling?.maxTokens === undefined
          ? {}
          : { max_tokens: input.sampling.maxTokens }),
        ...(input.tools === undefined || input.tools.length === 0
          ? {}
          : {
              tool_choice: "auto",
              tools: input.tools.map(
                (tool): ChatCompletionTool => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                }),
              ),
            }),
      },
      input.signal === undefined ? undefined : { signal: input.signal },
    );

    const toolCalls = new ToolCallAccumulator();
    for await (const chunk of stream) {
      const usage = usageFromOpenAiPayload(chunk);
      if (usage !== undefined) yield { type: "usage", usage };

      for (const text of reasoningDeltas(chunk))
        yield { type: "reasoning", text };
      for (const token of textDeltas(chunk)) yield token;
      toolCalls.merge(chunk);
      if (hasToolCallFinish(chunk)) {
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
  } catch (caught) {
    throw normalizeProviderSdkError(caught, "openai-compatible");
  }
}

function toOpenAiMessage(message: ChatMessage): ChatCompletionMessageParam {
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
      tool_call_id: message.toolCallId ?? "",
    };
  }

  if (message.role === "user" && message.images?.length) {
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: message.content },
      ...message.images.map((image) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:${image.mimeType};base64,${stripDataUrl(image.dataBase64)}`,
        },
      })),
    ];
    return {
      role: "user",
      content,
    };
  }
  return { role: message.role, content: message.content };
}

function stripDataUrl(value: string): string {
  return value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
}

function toOpenAiToolCall(
  toolCall: ProviderToolCallRequest,
): ChatCompletionMessageFunctionToolCall {
  return {
    id: toolCall.providerCallId,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function textDeltas(payload: unknown): string[] {
  return choices(payload).flatMap((choice) =>
    stringFields(asRecord(choice.delta) ?? asRecord(choice.message), [
      "content",
    ]),
  );
}

// DeepSeek and many OpenAI-compatible gateways stream thinking as
// `reasoning_content` (or `reasoning` / `thinking`) on the same chat-completion
// delta as the eventual answer. Those tokens must not be treated as content.
function reasoningDeltas(payload: unknown): string[] {
  return choices(payload).flatMap((choice) =>
    stringFields(asRecord(choice.delta) ?? asRecord(choice.message), [
      "reasoning_content",
      "reasoning",
      "thinking",
    ]),
  );
}

function stringFields(
  record: Record<string, unknown> | undefined,
  keys: string[],
): string[] {
  if (record === undefined) return [];
  return keys.flatMap((key) => {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? [value] : [];
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
