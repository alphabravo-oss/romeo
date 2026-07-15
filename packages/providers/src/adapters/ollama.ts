import { ollamaCapabilities } from "../capabilities";
import {
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
import { usageFromOllamaPayload } from "../usage";
import { devEchoStream } from "./dev-echo";

export const ollamaAdapter: ModelProviderAdapter = {
  kind: "ollama",
  async health(provider) {
    return {
      ok: provider.enabled,
      message: provider.enabled
        ? "Ollama endpoint is configured."
        : "Ollama is disabled.",
    };
  },
  async listModels(provider): Promise<BaseModel[]> {
    const discovered = await discoverOllamaModels(provider.baseUrl).catch(
      () => [],
    );
    const names = discovered.length > 0 ? discovered : ["llama3.2"];
    return names.slice(0, 100).map((name) => ({
      id:
        discovered.length > 0
          ? `model_${provider.id}_${modelIdPart(name)}`
          : `model_${provider.id}_default`,
      providerId: provider.id,
      name,
      displayName: `Ollama ${name}`,
      enabled: true,
      capabilities: ollamaCapabilities,
      contextWindow: 8192,
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

async function* providerCredentialUnavailableStream(): AsyncIterable<StreamChatChunk> {
  throw { errorCode: "provider_credential_unavailable" };
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
  const headers: Record<string, string> = {
    accept: "application/x-ndjson",
    "content-type": "application/json",
  };
  if (input.apiKey !== undefined)
    headers.authorization = `Bearer ${input.apiKey}`;

  const response = await (input.fetchImpl ?? fetch)(ollamaChatUrl(input), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model.name,
      messages: input.messages.map(toOllamaMessage),
      stream: true,
      ...(input.tools === undefined || input.tools.length === 0
        ? {}
        : {
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
  });

  if (!response.ok) {
    throw {
      errorCode: "provider_http_error",
      errorType: `http_${response.status}`,
    };
  }
  if (response.body === null) {
    throw { errorCode: "provider_stream_error", errorType: "empty_body" };
  }

  for await (const payload of readJsonLines(response.body)) {
    const usage = usageFromOllamaPayload(payload);
    if (usage !== undefined) yield { type: "usage", usage };

    const message = asRecord(asRecord(payload)?.message);
    const content = message?.content;
    if (typeof content === "string" && content.length > 0) yield content;

    const toolCalls = normalizeProviderToolCalls(message?.tool_calls);
    if (toolCalls.length === 1) {
      yield { type: "tool_call", toolCall: toolCalls[0]! };
    } else if (toolCalls.length > 1) {
      yield {
        type: "tool_call",
        toolCall: toolCalls[0]!,
        toolCalls,
      };
    }
  }
}

async function discoverOllamaModels(baseUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const url = new URL("/api/tags", normalizedBaseUrl(baseUrl));
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      models?: Array<{ name?: unknown }>;
    };
    return [
      ...new Set(
        (payload.models ?? [])
          .map((model) => model.name)
          .filter(
            (name): name is string =>
              typeof name === "string" && name.trim().length > 0,
          ),
      ),
    ]
      .map((name) => name.trim())
      .sort((left, right) => left.localeCompare(right));
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function ollamaChatUrl(input: StreamChatInput): string {
  return new URL(
    "/api/chat",
    normalizedBaseUrl(input.provider.baseUrl),
  ).toString();
}

function toOllamaMessage(message: ChatMessage): Record<string, unknown> {
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
      ...(message.toolCallId === undefined
        ? {}
        : { tool_call_id: message.toolCallId }),
    };
  }

  return { role: message.role, content: message.content };
}

function toOllamaToolCall(
  toolCall: ProviderToolCallRequest,
): Record<string, unknown> {
  return {
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments,
    },
  };
}

async function* readJsonLines(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const next = await reader.read();
    if (next.done === true) break;
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) yield JSON.parse(trimmed);
    }
  }

  const finalLine = buffer.trim();
  if (finalLine.length > 0) yield JSON.parse(finalLine);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modelIdPart(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized.length > 0 ? normalized.slice(0, 80) : "model";
}
