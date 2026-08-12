import type { Message, Ollama, Tool } from "ollama";

import { ollamaCapabilities } from "../capabilities";
import { MAX_DISCOVERED_MODELS } from "../model-catalog";
import {
  normalizeProviderToolCalls,
  type ProviderToolCallRequest,
} from "../tool-calls";
import type {
  BaseModel,
  ChatMessage,
  ModelProviderAdapter,
  ProviderInstance,
  StreamChatChunk,
  StreamChatInput,
} from "../types";
import { usageFromOllamaPayload } from "../usage";
import { devEchoStream } from "./dev-echo";
import { createOllamaClient, normalizeProviderSdkError } from "./provider-sdk";

export const ollamaAdapter: ModelProviderAdapter = {
  kind: "ollama",
  async health(provider, options) {
    try {
      await createOllamaClient(provider, {
        ...options,
        timeoutMs: 2_500,
      }).list();
      return { ok: true, message: "Connected to Ollama." };
    } catch (caught) {
      const status = sdkStatus(caught);
      return status === undefined
        ? { ok: false, message: "Could not reach the Ollama endpoint." }
        : { ok: false, message: `Ollama returned HTTP ${status}.` };
    }
  },
  async listModels(provider, options): Promise<BaseModel[]> {
    const client = createOllamaClient(provider, {
      ...options,
      timeoutMs: options?.timeoutMs ?? 1_500,
    });
    const allowedNames = new Set(
      (provider.modelIds ?? []).map((name) => name.trim()).filter(Boolean),
    );
    const discovered = (await client.list()).models
      .map((model) => (model.model || model.name).trim())
      .filter(
        (name) =>
          name.length > 0 &&
          (allowedNames.size === 0 || allowedNames.has(name)),
      )
      .sort((left, right) => left.localeCompare(right));
    const enriched = await mapConcurrent(
      [...new Set(discovered)].slice(0, MAX_DISCOVERED_MODELS),
      6,
      async (name) =>
        discoverOllamaModel(client, name).catch(() => discoveredModel(name)),
    );
    return enriched.map((model) => ({
      id: `model_${provider.id}_${modelIdPart(model.name)}`,
      providerId: provider.id,
      name: model.name,
      displayName: `Ollama ${model.name}`,
      enabled: false,
      capabilities: model.embeddingOnly
        ? {
            ...model.capabilities,
            streaming: false,
            toolCalling: false,
            modalities: ["embeddings"],
          }
        : model.capabilities,
      contextWindow: model.contextWindow,
    }));
  },
  streamChat(input) {
    if (
      input.provider.credentialRef !== undefined &&
      input.apiKey === undefined
    ) {
      return providerCredentialUnavailableStream();
    }
    if (usesVitestHermeticRuntime(input)) {
      return devEchoStream(input, "Romeo Ollama response:");
    }
    return streamOllamaChat(input);
  },
};

export interface OllamaPullResult {
  completed: number;
  digest?: string;
  model: string;
  status: string;
  total: number;
}

export interface OllamaDeleteResult {
  model: string;
  status: string;
}

export async function deleteOllamaModel(
  provider: ProviderInstance,
  model: string,
  options?: { apiKey?: string; fetchImpl?: typeof fetch },
): Promise<OllamaDeleteResult> {
  const result = await createOllamaClient(provider, options).delete({ model });
  return { model, status: result.status };
}

export async function pullOllamaModel(
  provider: ProviderInstance,
  model: string,
  options?: { apiKey?: string; fetchImpl?: typeof fetch },
): Promise<OllamaPullResult> {
  const stream = await createOllamaClient(provider, options).pull({
    model,
    stream: true,
  });
  let completed = 0;
  let total = 0;
  let digest: string | undefined;
  let status = "starting";
  for await (const event of stream) {
    status = event.status;
    completed = event.completed ?? completed;
    total = event.total ?? total;
    digest = event.digest || digest;
  }
  return {
    completed,
    ...(digest === undefined ? {} : { digest }),
    model,
    status,
    total,
  };
}

async function* providerCredentialUnavailableStream(): AsyncIterable<StreamChatChunk> {
  throw { errorCode: "provider_credential_unavailable" };
}

interface DiscoveredOllamaModel {
  name: string;
  capabilities: typeof ollamaCapabilities;
  contextWindow: number;
  embeddingOnly: boolean;
}

function discoveredModel(name: string): DiscoveredOllamaModel {
  return {
    name,
    capabilities: ollamaCapabilities,
    contextWindow: 8192,
    embeddingOnly: false,
  };
}

async function discoverOllamaModel(
  client: Ollama,
  name: string,
): Promise<DiscoveredOllamaModel> {
  const payload = await client.show({ model: name });
  const capabilities = payload.capabilities ?? [];
  const vision = capabilities.includes("vision");
  const info = recordFromMap(payload.model_info);
  const contextWindow = Object.entries(info).find(
    ([key, value]) =>
      key.endsWith(".context_length") &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0,
  )?.[1];
  return {
    name,
    capabilities: {
      ...ollamaCapabilities,
      toolCalling: capabilities.includes("tools"),
      vision,
      modalities: vision ? ["text", "vision"] : ["text"],
    },
    contextWindow: typeof contextWindow === "number" ? contextWindow : 8192,
    embeddingOnly:
      capabilities.includes("embedding") &&
      !capabilities.includes("completion"),
  };
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

function usesVitestHermeticRuntime(input: StreamChatInput): boolean {
  if (input.fetchImpl !== undefined || input.apiKey !== undefined) return false;
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.NODE_ENV === "test";
}

async function* streamOllamaChat(
  input: StreamChatInput,
): AsyncIterable<StreamChatChunk> {
  const client = createOllamaClient(input.provider, {
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });
  try {
    const stream = await client.chat({
      model: input.model.name,
      messages: input.messages.map(toOllamaMessage),
      stream: true,
      // Ollama carries sampling under `options`, and names the output cap num_predict.
      ...(input.sampling === undefined
        ? {}
        : {
            options: {
              ...(input.sampling.temperature === undefined
                ? {}
                : { temperature: input.sampling.temperature }),
              ...(input.sampling.topP === undefined
                ? {}
                : { top_p: input.sampling.topP }),
              ...(input.sampling.maxTokens === undefined
                ? {}
                : { num_predict: input.sampling.maxTokens }),
            },
          }),
      ...(input.tools?.length ? { tools: input.tools.map(toOllamaTool) } : {}),
    });
    const abort = () => stream.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      for await (const event of stream) {
        const usage = usageFromOllamaPayload(event);
        if (usage !== undefined) yield { type: "usage", usage };
        const message = event.message;
        if (message?.content && message.content.length > 0)
          yield message.content;
        const toolCalls = normalizeProviderToolCalls(message?.tool_calls);
        if (toolCalls.length === 1)
          yield { type: "tool_call", toolCall: toolCalls[0]! };
        if (toolCalls.length > 1)
          yield {
            type: "tool_call",
            toolCall: toolCalls[0]!,
            toolCalls,
          };
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new DOMException("The provider stream was aborted.", "AbortError");
    }
  } catch (caught) {
    throw normalizeProviderSdkError(caught, "ollama");
  }
}

function toOllamaMessage(message: ChatMessage): Message {
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map(toOllamaToolCall),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      ...(message.name === undefined ? {} : { tool_name: message.name }),
    };
  }
  return {
    role: message.role,
    content: message.content,
    ...(message.role === "user" && message.images?.length
      ? {
          images: message.images.map((image) => stripDataUrl(image.dataBase64)),
        }
      : {}),
  };
}

function toOllamaTool(
  tool: NonNullable<StreamChatInput["tools"]>[number],
): Tool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOllamaToolCall(toolCall: ProviderToolCallRequest) {
  return {
    function: { name: toolCall.name, arguments: toolCall.arguments },
  };
}

function recordFromMap(value: unknown): Record<string, unknown> {
  if (value instanceof Map) return Object.fromEntries(value);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sdkStatus(caught: unknown): number | undefined {
  if (
    typeof caught === "object" &&
    caught !== null &&
    "status_code" in caught &&
    typeof caught.status_code === "number"
  )
    return caught.status_code;
  if (
    typeof caught === "object" &&
    caught !== null &&
    "status" in caught &&
    typeof caught.status === "number"
  )
    return caught.status;
  return undefined;
}

function modelIdPart(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized.length > 0 ? normalized.slice(0, 80) : "model";
}

function stripDataUrl(value: string): string {
  return value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
}
