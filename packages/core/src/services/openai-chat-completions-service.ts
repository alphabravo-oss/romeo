import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
import {
  getProviderAdapter,
  normalizeProviderToolCall,
  type BaseModel,
  type ChatMessage,
  type ProviderInstance,
  type ProviderTokenUsage,
  type ProviderToolCallRequest,
  type ProviderToolDefinition,
  type StreamChatChunk,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { WebhookEmitter } from "./webhook-service";

export interface OpenAiChatCompletionRequest {
  messages: OpenAiChatMessageInput[];
  model: string;
  stream?: boolean;
  streamOptions?: { includeUsage?: boolean };
  tools?: OpenAiChatToolInput[];
}

export type OpenAiChatMessageInput =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: unknown[];
    }
  | {
      role: "tool";
      content: string;
      name?: string;
      toolCallId?: string;
    };

export interface OpenAiChatToolInput {
  type: "function";
  function: {
    description?: string | undefined;
    name: string;
    parameters?: Record<string, unknown> | undefined;
  };
}

export interface OpenAiChatCompletionResponse {
  choices: OpenAiChatCompletionChoice[];
  created: number;
  id: string;
  model: string;
  object: "chat.completion";
  usage: OpenAiCompletionUsage | null;
}

export interface OpenAiChatCompletionChoice {
  finish_reason: "stop" | "tool_calls";
  index: number;
  message: {
    content: string | null;
    role: "assistant";
    tool_calls?: OpenAiToolCall[];
  };
}

export interface OpenAiCompletionUsage {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export interface OpenAiToolCall {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  type: "function";
}

export class OpenAiChatCompletionsService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      fetchImpl?: typeof fetch;
      quotaCoordinator?: QuotaCoordinator;
      secretResolver?: SecretResolver;
      webhooks?: WebhookEmitter;
    } = {},
  ) {}

  async complete(input: {
    request: OpenAiChatCompletionRequest;
    subject: AuthSubject;
  }): Promise<OpenAiChatCompletionResponse> {
    const target = await this.resolveTarget(input.subject, input.request.model);
    const result = await this.collectProviderOutput(target, input.request);
    return chatCompletionResponse(input.request.model, result);
  }

  async stream(input: {
    request: OpenAiChatCompletionRequest;
    subject: AuthSubject;
  }): Promise<ReadableStream<Uint8Array>> {
    const target = await this.resolveTarget(input.subject, input.request.model);
    return openAiChatCompletionStream(target, input.request, this.options);
  }

  private async assertModelRequestAllowed(
    subject: AuthSubject,
    provider: ProviderInstance,
  ): Promise<void> {
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "model.request",
      providerId: provider.id,
    });
    await consumeQuota(
      this.repository,
      subject,
      {
        metric: "run.started",
        providerId: provider.id,
        quantity: 1,
      },
      {
        quotaCoordinator: this.options.quotaCoordinator,
        webhooks: this.options.webhooks,
      },
    );
  }

  private async collectProviderOutput(
    target: ResolvedModelTarget,
    request: OpenAiChatCompletionRequest,
  ): Promise<ProviderOutput> {
    const output: ProviderOutput = { content: "", toolCalls: [] };
    try {
      for await (const chunk of this.providerChunks(target, request)) {
        collectChunk(output, chunk);
      }
    } catch (error) {
      throw providerApiError(error);
    }
    return output;
  }

  private providerChunks(
    target: ResolvedModelTarget,
    request: OpenAiChatCompletionRequest,
  ): AsyncIterable<StreamChatChunk> {
    const adapter = getProviderAdapter(target.provider.type);
    try {
      return adapter.streamChat({
        provider: target.provider,
        model: target.model,
        messages: request.messages.map(toProviderMessage),
        ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
        ...(this.options.fetchImpl === undefined
          ? {}
          : { fetchImpl: this.options.fetchImpl }),
        ...(request.tools === undefined || request.tools.length === 0
          ? {}
          : { tools: request.tools.map(toProviderTool) }),
      });
    } catch (error) {
      throw providerApiError(error);
    }
  }

  private async resolveTarget(
    subject: AuthSubject,
    requestedModel: string,
  ): Promise<ResolvedModelTarget> {
    assertScope(subject, "models:use");

    const model = await this.resolveModel(subject.orgId, requestedModel);
    const provider = await this.repository.getProvider(model.providerId);
    if (provider === undefined) throw notFound("Provider");
    if (!canAccessOrg(subject, provider.orgId)) {
      throw new AuthorizationError(
        "The model provider is outside the caller organization.",
      );
    }
    if (!model.enabled) {
      throw new ApiError(
        "model_disabled",
        "The requested model is disabled.",
        409,
        { modelId: model.id },
      );
    }
    if (!provider.enabled) {
      throw new ApiError(
        "provider_disabled",
        "The requested model provider is disabled.",
        409,
        { providerId: provider.id },
      );
    }
    if (!model.capabilities.modalities.includes("text")) {
      throw new ApiError(
        "model_modality_unsupported",
        "The requested model does not support text chat completions.",
        400,
        { modelId: model.id },
      );
    }

    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "model", model.id, "use")) {
      throw new AuthorizationError(
        `Missing use permission for model:${model.id}`,
      );
    }
    if (!hasGrant(subject, grants, "provider", provider.id, "use")) {
      throw new AuthorizationError(
        `Missing use permission for provider:${provider.id}`,
      );
    }

    await this.assertModelRequestAllowed(subject, provider);
    const apiKey = await this.resolveProviderApiKey(provider);
    return {
      model,
      provider,
      ...(apiKey === undefined ? {} : { apiKey }),
    };
  }

  private async resolveModel(
    orgId: string,
    requestedModel: string,
  ): Promise<BaseModel> {
    const trimmed = requestedModel.trim();
    if (trimmed.length === 0) throw notFound("Model");

    const byId = await this.repository.getModel(trimmed);
    if (byId !== undefined) return byId;

    const matches = (await this.repository.listModels(orgId)).filter(
      (model) => model.name === trimmed,
    );
    if (matches.length === 0) throw notFound("Model");
    if (matches.length > 1) {
      throw new ApiError(
        "model_ambiguous",
        "Multiple models match the requested OpenAI-compatible model name.",
        409,
        { model: trimmed, modelIds: matches.map((model) => model.id).sort() },
      );
    }
    return matches[0]!;
  }

  private async resolveProviderApiKey(
    provider: ProviderInstance,
  ): Promise<string | undefined> {
    if (provider.credentialRef === undefined) return undefined;
    const resolution = await this.options.secretResolver?.resolveValue?.(
      provider.credentialRef,
    );
    if (resolution?.available === true) return resolution.value;
    throw new ApiError(
      "provider_credential_unavailable",
      "The requested model provider credential is unavailable.",
      503,
      {
        providerId: provider.id,
        credentialRefScheme: resolution?.scheme ?? "unknown",
        failureCode: resolution?.failureCode ?? "secret_resolver_unavailable",
      },
    );
  }
}

interface ResolvedModelTarget {
  apiKey?: string;
  model: BaseModel;
  provider: ProviderInstance;
}

interface ProviderOutput {
  content: string;
  toolCalls: ProviderToolCallRequest[];
  usage?: ProviderTokenUsage;
}

function openAiChatCompletionStream(
  target: ResolvedModelTarget,
  request: OpenAiChatCompletionRequest,
  options: { fetchImpl?: typeof fetch },
): ReadableStream<Uint8Array> {
  const adapter = getProviderAdapter(target.provider.type);
  const encoder = new TextEncoder();
  const id = createId("chatcmpl");
  const created = createdSeconds();
  const includeUsage = request.streamOptions?.includeUsage === true;

  return new ReadableStream({
    async start(controller) {
      const enqueue = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      try {
        enqueue(
          chatCompletionChunk(id, created, request.model, {
            role: "assistant",
          }),
        );

        let usage: ProviderTokenUsage | undefined;
        let emittedToolCall = false;
        const chunks = adapter.streamChat({
          provider: target.provider,
          model: target.model,
          messages: request.messages.map(toProviderMessage),
          ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
          ...(options.fetchImpl === undefined
            ? {}
            : { fetchImpl: options.fetchImpl }),
          ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : { tools: request.tools.map(toProviderTool) }),
        });

        for await (const chunk of chunks) {
          if (typeof chunk === "string") {
            enqueue(
              chatCompletionChunk(id, created, request.model, {
                content: chunk,
              }),
            );
            continue;
          }
          if (isUsageChunk(chunk)) {
            usage = chunk.usage;
            continue;
          }
          if (isToolCallChunk(chunk)) {
            emittedToolCall = true;
            for (const [index, toolCall] of toolCallsFromChunk(
              chunk,
            ).entries()) {
              enqueue(
                chatCompletionChunk(id, created, request.model, {
                  tool_calls: [toOpenAiToolCallDelta(toolCall, index)],
                }),
              );
            }
          }
        }

        enqueue(
          chatCompletionChunk(
            id,
            created,
            request.model,
            {},
            emittedToolCall ? "tool_calls" : "stop",
          ),
        );
        if (includeUsage && usage !== undefined) {
          enqueue({
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: [],
            usage: toOpenAiUsage(usage),
          });
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(providerApiError(error));
      }
    },
  });
}

function collectChunk(output: ProviderOutput, chunk: StreamChatChunk): void {
  if (typeof chunk === "string") {
    output.content += chunk;
    return;
  }
  if (isUsageChunk(chunk)) {
    output.usage = chunk.usage;
    return;
  }
  if (isToolCallChunk(chunk)) {
    output.toolCalls.push(...toolCallsFromChunk(chunk));
  }
}

function chatCompletionResponse(
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

function toProviderMessage(message: OpenAiChatMessageInput): ChatMessage {
  if (message.role === "assistant") {
    const toolCalls = (message.toolCalls ?? [])
      .map(normalizeProviderToolCall)
      .filter(
        (toolCall): toolCall is ProviderToolCallRequest =>
          toolCall !== undefined,
      );
    return {
      role: "assistant",
      content: message.content,
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      ...(message.name === undefined ? {} : { name: message.name }),
      ...(message.toolCallId === undefined
        ? {}
        : { toolCallId: message.toolCallId }),
    };
  }
  return message;
}

function toProviderTool(tool: OpenAiChatToolInput): ProviderToolDefinition {
  return {
    name: tool.function.name,
    description: tool.function.description ?? "",
    parameters: tool.function.parameters ?? { type: "object" },
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
  };
}

function chatCompletionChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: "stop" | "tool_calls" | null = null,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function toolCallsFromChunk(
  chunk: Extract<StreamChatChunk, { type: "tool_call" }>,
): ProviderToolCallRequest[] {
  return chunk.toolCalls ?? [chunk.toolCall];
}

function dedupeToolCalls(
  toolCalls: ProviderToolCallRequest[],
): ProviderToolCallRequest[] {
  return [
    ...new Map(
      toolCalls.map((toolCall) => [toolCall.providerCallId, toolCall]),
    ).values(),
  ];
}

function isUsageChunk(
  chunk: Exclude<StreamChatChunk, string>,
): chunk is { type: "usage"; usage: ProviderTokenUsage } {
  return chunk.type === "usage";
}

function isToolCallChunk(
  chunk: Exclude<StreamChatChunk, string>,
): chunk is Extract<StreamChatChunk, { type: "tool_call" }> {
  return chunk.type === "tool_call";
}

function createdSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function providerApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const record = asRecord(error);
  const errorCode =
    typeof record?.errorCode === "string"
      ? record.errorCode
      : "provider_generation_failed";
  const errorType =
    typeof record?.errorType === "string" ? record.errorType : undefined;
  return new ApiError(
    errorCode,
    "The model provider failed to complete the chat request.",
    errorCode === "provider_credential_unavailable" ? 503 : 502,
    errorType === undefined ? {} : { errorType },
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
