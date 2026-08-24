import type { AuthSubject } from "@romeo/auth";
import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import type {
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
  OpenAiChatMessageInput,
} from "@romeo/contracts";
import {
  getProviderAdapter,
  normalizeProviderToolCall,
  type ChatMessage,
  type ProviderInstance,
  type ProviderToolCallRequest,
  type StreamChatChunk,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  authorizeGenericCapability,
  singletonWorkspaceContext,
} from "./capability-consumer-enforcement";
import { CapabilityService } from "./capability-resolver";
import { consumeQuota } from "./consume-quota";
import { enforceContentPolicyValue } from "./content-policy-service";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { WebhookEmitter } from "./webhook-service";
import { providerChatApiError } from "./provider-api-error";
import {
  assertOpenAiChatProviderParameters,
  providerParameterFields,
  providerToolFields,
} from "./openai-chat-chunk-helpers";
import {
  chatCompletionResponse,
  collectChatProviderChunk,
  openAiChatCompletionStream,
  type ProviderOutput,
} from "./openai-chat-completion-output";
import { startCompatibilityInferenceUsage } from "./compatibility-inference-usage";
import { compatibilityProviderFetch } from "./compatibility-provider-egress";
import { executeCompatibilityProviderRequest } from "./compatibility-provider-execution";
import {
  createProviderRoutingPolicy,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import { estimateTokens } from "./token-estimate";
import {
  OpenAiChatTargetResolver,
  type ResolvedChatModelTarget,
} from "./openai-chat-target-resolver";

export type {
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
} from "@romeo/contracts";

export class OpenAiChatCompletionsService {
  private readonly capabilities: CapabilityService;
  private readonly circuitBreaker: ProviderCircuitBreaker;
  private readonly routingPolicy: ProviderRoutingPolicy;
  private readonly targets: OpenAiChatTargetResolver;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      fetchImpl?: typeof fetch;
      quotaCoordinator?: QuotaCoordinator;
      secretResolver?: SecretResolver;
      webhooks?: WebhookEmitter;
      capabilities?: CapabilityService;
      circuitBreaker?: ProviderCircuitBreaker;
      providerDisabledIds?: string;
      providerFallbackModelId?: string;
      providerRetryAttempts?: number;
      providerRetryBackoffMs?: number;
      providerTimeoutMs?: number;
    } = {},
  ) {
    this.capabilities =
      options.capabilities ?? new CapabilityService(repository);
    this.circuitBreaker =
      options.circuitBreaker ?? new ProviderCircuitBreaker();
    this.routingPolicy = createProviderRoutingPolicy({
      disabledProviderIds: options.providerDisabledIds,
      fallbackModelId: options.providerFallbackModelId,
    });
    this.targets = new OpenAiChatTargetResolver(
      repository,
      this.routingPolicy,
      options.secretResolver,
    );
  }

  async complete(input: {
    request: OpenAiChatCompletionRequest;
    signal?: AbortSignal;
    subject: AuthSubject;
  }): Promise<OpenAiChatCompletionResponse> {
    const request = await this.governRequest(input.subject, input.request);
    const target = await this.targets.resolveTarget(
      input.subject,
      request.model,
    );
    assertOpenAiChatProviderParameters(request, target);
    await this.assertRequestCapabilities(input.subject, request, target);
    await this.assertModelRequestAllowed(input.subject, target.provider);
    const fallback = await this.targets.resolveFallbackTarget(
      input.subject,
      target,
    );
    const meter = await this.startUsage(input.subject, request, target);
    let execution: Awaited<ReturnType<typeof this.executeProvider>>;
    try {
      execution = await this.executeProvider(
        target,
        fallback,
        request,
        input.signal,
      );
    } catch (error) {
      await meter.fail().catch(() => undefined);
      throw providerChatApiError(error, target.provider.type);
    }
    try {
      const governed = await this.governProviderOutput(
        input.subject,
        execution.value,
      );
      await meter.succeed({
        estimatedOutputTokens: estimateTokens(governed.content),
        model: execution.target.model,
        providerId: execution.target.provider.id,
        ...(governed.usage === undefined ? {} : { usage: governed.usage }),
      });
      return chatCompletionResponse(input.request.model, governed);
    } catch (error) {
      await meter.fail().catch(() => undefined);
      throw error;
    }
  }

  async stream(input: {
    request: OpenAiChatCompletionRequest;
    signal?: AbortSignal;
    subject: AuthSubject;
  }): Promise<ReadableStream<Uint8Array>> {
    const request = await this.governRequest(input.subject, input.request);
    const target = await this.targets.resolveTarget(
      input.subject,
      request.model,
    );
    assertOpenAiChatProviderParameters(request, target);
    await this.assertRequestCapabilities(input.subject, request, target);
    await this.assertModelRequestAllowed(input.subject, target.provider);
    const fallback = await this.targets.resolveFallbackTarget(
      input.subject,
      target,
    );
    // A compatibility stream is withheld until the entire provider response has
    // passed the same output policy as a buffered completion. This prevents a
    // detector match split across provider chunks from leaking before policy can
    // make an authoritative decision, and keeps repository work inside the
    // request lifetime instead of an escaped ReadableStream callback.
    const meter = await this.startUsage(input.subject, request, target);
    let execution: Awaited<ReturnType<typeof this.executeProvider>>;
    try {
      execution = await this.executeProvider(
        target,
        fallback,
        request,
        input.signal,
      );
    } catch (error) {
      await meter.fail().catch(() => undefined);
      throw providerChatApiError(error, target.provider.type);
    }
    try {
      const governed = await this.governProviderOutput(
        input.subject,
        execution.value,
      );
      await meter.succeed({
        estimatedOutputTokens: estimateTokens(governed.content),
        model: execution.target.model,
        providerId: execution.target.provider.id,
        ...(governed.usage === undefined ? {} : { usage: governed.usage }),
      });
      return openAiChatCompletionStream(request, governed);
    } catch (error) {
      await meter.fail().catch(() => undefined);
      throw error;
    }
  }

  private startUsage(
    subject: AuthSubject,
    request: OpenAiChatCompletionRequest,
    target: ResolvedChatModelTarget,
  ) {
    return startCompatibilityInferenceUsage({
      estimatedInputTokens: estimateTokens(JSON.stringify(request.messages)),
      model: target.model,
      operation: "chat_completions",
      providerId: target.provider.id,
      repository: this.repository,
      subject,
    });
  }

  private async governRequest(
    subject: AuthSubject,
    request: OpenAiChatCompletionRequest,
  ): Promise<OpenAiChatCompletionRequest> {
    return (await enforceContentPolicyValue(this.repository, subject, request))
      .value;
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

  private async assertRequestCapabilities(
    subject: AuthSubject,
    request: OpenAiChatCompletionRequest,
    target: ResolvedChatModelTarget,
  ): Promise<void> {
    if (request.reasoning === undefined) return;
    await authorizeGenericCapability(
      this.capabilities,
      subject,
      "reasoning_policy",
      {
        ...singletonWorkspaceContext(subject.workspaceIds),
        modelId: target.model.id,
      },
    );
  }

  private async collectProviderOutput(
    target: ResolvedChatModelTarget,
    request: OpenAiChatCompletionRequest,
    signal: AbortSignal,
    markOutput: () => void,
  ): Promise<ProviderOutput> {
    const output: ProviderOutput = { content: "", toolCalls: [] };
    try {
      for await (const chunk of this.providerChunks(target, request, signal)) {
        if (
          typeof chunk === "string" ||
          (typeof chunk === "object" && chunk.type === "tool_call")
        )
          markOutput();
        collectChatProviderChunk(output, chunk);
      }
    } catch (error) {
      throw providerChatApiError(error, target.provider.type);
    }
    return output;
  }

  private executeProvider(
    primary: ResolvedChatModelTarget,
    fallback: ResolvedChatModelTarget | undefined,
    request: OpenAiChatCompletionRequest,
    signal: AbortSignal | undefined,
  ) {
    return executeCompatibilityProviderRequest({
      candidates: [
        {
          disabled: this.routingPolicy.disabledProviderIds.has(
            primary.provider.id,
          ),
          kind: primary.provider.type,
          providerId: primary.provider.id,
          target: primary,
        },
        ...(fallback === undefined
          ? []
          : [
              {
                kind: fallback.provider.type,
                providerId: fallback.provider.id,
                target: fallback,
              },
            ]),
      ],
      circuitBreaker: this.circuitBreaker,
      execute: (target, attemptSignal, markOutput) => {
        assertOpenAiChatProviderParameters(request, target);
        return this.collectProviderOutput(
          target,
          request,
          attemptSignal,
          markOutput,
        );
      },
      operation: "chat",
      retryAttempts: this.options.providerRetryAttempts ?? 0,
      retryBackoffMs: this.options.providerRetryBackoffMs ?? 0,
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: this.options.providerTimeoutMs ?? 120_000,
    });
  }

  private providerChunks(
    target: ResolvedChatModelTarget,
    request: OpenAiChatCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamChatChunk> {
    const adapter = getProviderAdapter(target.provider.type);
    try {
      const providerFetch = compatibilityProviderFetch({
        credentialPresent: target.apiKey !== undefined,
        ...(this.options.fetchImpl === undefined
          ? {}
          : { fetchImpl: this.options.fetchImpl }),
        provider: target.provider,
        maxResponseBytes: 8 * 1024 * 1024,
        responseMode: "streaming",
        timeoutMs: this.options.providerTimeoutMs ?? 120_000,
      });
      return adapter.streamChat({
        provider: target.provider,
        model: target.model,
        messages: request.messages.map(toProviderMessage),
        ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
        ...(providerFetch === undefined ? {} : { fetchImpl: providerFetch }),
        ...(signal === undefined ? {} : { signal }),
        ...providerToolFields(request),
        ...providerParameterFields(request),
      });
    } catch (error) {
      throw providerChatApiError(error, target.provider.type);
    }
  }

  private async governProviderOutput(
    subject: AuthSubject,
    output: ProviderOutput,
  ): Promise<ProviderOutput> {
    const governed = await enforceContentPolicyValue(this.repository, subject, {
      content: output.content,
      toolCalls: output.toolCalls,
    });
    return {
      ...governed.value,
      ...(output.usage === undefined ? {} : { usage: output.usage }),
    };
  }
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
