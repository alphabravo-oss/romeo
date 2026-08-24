import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import type {
  OpenAiEmbeddingRequest,
  OpenAiEmbeddingResponse,
} from "@romeo/contracts";
import {
  getEmbeddingAdapter,
  type BaseModel,
  type EmbedTextsResult,
  type ProviderInstance,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import { enforceContentPolicyStrings } from "./content-policy-service";
import { providerApiError } from "./provider-api-error";
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { WebhookEmitter } from "./webhook-service";
import { startCompatibilityInferenceUsage } from "./compatibility-inference-usage";
import { compatibilityProviderFetch } from "./compatibility-provider-egress";
import { executeCompatibilityProviderRequest } from "./compatibility-provider-execution";
import {
  createProviderRoutePlan,
  createProviderRoutingPolicy,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import { estimateTokens } from "./token-estimate";

export type {
  OpenAiEmbeddingRequest,
  OpenAiEmbeddingResponse,
} from "@romeo/contracts";

export class OpenAiEmbeddingsService {
  private readonly circuitBreaker: ProviderCircuitBreaker;
  private readonly routingPolicy: ProviderRoutingPolicy;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      fetchImpl?: typeof fetch;
      quotaCoordinator?: QuotaCoordinator;
      secretResolver?: SecretResolver;
      webhooks?: WebhookEmitter;
      circuitBreaker?: ProviderCircuitBreaker;
      providerDisabledIds?: string;
      providerFallbackModelId?: string;
      providerRetryAttempts?: number;
      providerRetryBackoffMs?: number;
      providerTimeoutMs?: number;
    } = {},
  ) {
    this.circuitBreaker =
      options.circuitBreaker ?? new ProviderCircuitBreaker();
    this.routingPolicy = createProviderRoutingPolicy({
      disabledProviderIds: options.providerDisabledIds,
      fallbackModelId: options.providerFallbackModelId,
    });
  }

  async create(input: {
    request: OpenAiEmbeddingRequest;
    signal?: AbortSignal;
    subject: AuthSubject;
  }): Promise<OpenAiEmbeddingResponse> {
    const governed = await enforceContentPolicyStrings(
      this.repository,
      input.subject,
      input.request.input,
    );
    const target = await this.resolveTarget(input.subject, input.request.model);
    const fallback = await this.resolveFallbackTarget(input.subject, target);
    const meter = await startCompatibilityInferenceUsage({
      estimatedInputTokens: governed.contents.reduce(
        (total, content) => total + estimateTokens(content),
        0,
      ),
      model: target.model,
      operation: "embeddings",
      providerId: target.provider.id,
      repository: this.repository,
      subject: input.subject,
    });
    let execution: Awaited<ReturnType<typeof this.executeProvider>>;
    try {
      execution = await this.executeProvider(
        target,
        fallback,
        governed.contents,
        input.signal,
      );
    } catch (error) {
      await meter.fail().catch(() => undefined);
      throw embeddingApiError(error, target.provider.type);
    }
    const result = execution.value;
    await meter.succeed(
      result.usage === undefined
        ? {
            model: execution.target.model,
            providerId: execution.target.provider.id,
          }
        : {
            model: execution.target.model,
            providerId: execution.target.provider.id,
            usage: result.usage,
          },
    );
    return embeddingResponse(result);
  }

  private executeProvider(
    primary: ResolvedEmbeddingTarget,
    fallback: ResolvedEmbeddingTarget | undefined,
    texts: string[],
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
      execute: (target, attemptSignal) => {
        const providerFetch = compatibilityProviderFetch({
          credentialPresent: target.apiKey !== undefined,
          ...(this.options.fetchImpl === undefined
            ? {}
            : { fetchImpl: this.options.fetchImpl }),
          provider: target.provider,
          maxResponseBytes: 32 * 1024 * 1024,
          timeoutMs: this.options.providerTimeoutMs ?? 30_000,
        });
        return getEmbeddingAdapter(target.provider.type).embedTexts({
          provider: target.provider,
          model: target.providerModel,
          texts,
          ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
          ...(providerFetch === undefined ? {} : { fetchImpl: providerFetch }),
          signal: attemptSignal,
        });
      },
      operation: "embeddings",
      retryAttempts: this.options.providerRetryAttempts ?? 0,
      retryBackoffMs: this.options.providerRetryBackoffMs ?? 0,
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: this.options.providerTimeoutMs ?? 30_000,
    });
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

  private async resolveTarget(
    subject: AuthSubject,
    requestedModel: string,
  ): Promise<ResolvedEmbeddingTarget> {
    assertScope(subject, "models:use");
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const catalogModel = await this.resolveCatalogModel(
      subject.orgId,
      requestedModel,
    );
    if (catalogModel === undefined) throw notFound("Model");
    return this.resolveCatalogTarget(subject, grants, catalogModel);
  }

  private async resolveCatalogModel(
    orgId: string,
    requestedModel: string,
  ): Promise<BaseModel | undefined> {
    const trimmed = requestedModel.trim();
    if (trimmed.length === 0) throw notFound("Model");
    const byId = await this.repository.getModel(trimmed);
    if (byId !== undefined) return byId;

    const matches = (await this.repository.listModels(orgId)).filter(
      (model) => model.name === trimmed,
    );
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      throw new ApiError(
        "model_ambiguous",
        "Multiple models match the requested OpenAI-compatible embedding model name.",
        409,
        { model: trimmed, modelIds: matches.map((model) => model.id).sort() },
      );
    }
    return matches[0]!;
  }

  private async resolveCatalogTarget(
    subject: AuthSubject,
    grants: Awaited<ReturnType<RomeoRepository["listResourceGrants"]>>,
    model: BaseModel,
  ): Promise<ResolvedEmbeddingTarget> {
    const provider = await this.repository.getProvider(model.providerId);
    if (provider === undefined) throw notFound("Provider");
    this.assertProviderAccess(subject, provider);
    this.assertEnabled(provider, model);
    if (!model.capabilities.modalities.includes("embeddings")) {
      throw new ApiError(
        "model_modality_unsupported",
        "The requested model does not support embeddings.",
        400,
        { modelId: model.id },
      );
    }
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
    const apiKey = this.routingPolicy.disabledProviderIds.has(provider.id)
      ? undefined
      : await this.resolveProviderApiKey(provider);
    return {
      model,
      provider,
      providerModel: model.name,
      ...(apiKey === undefined ? {} : { apiKey }),
    };
  }

  private async resolveFallbackTarget(
    subject: AuthSubject,
    primary: ResolvedEmbeddingTarget,
  ): Promise<ResolvedEmbeddingTarget | undefined> {
    const fallback = (
      await createProviderRoutePlan(
        this.repository,
        this.routingPolicy,
        primary,
      )
    ).fallback;
    if (
      fallback === undefined ||
      !fallback.model.capabilities.modalities.includes("embeddings")
    )
      return undefined;
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (
      !hasGrant(subject, grants, "model", fallback.model.id, "use") ||
      !hasGrant(subject, grants, "provider", fallback.provider.id, "use")
    )
      return undefined;
    try {
      const apiKey = await this.resolveProviderApiKey(fallback.provider);
      return {
        model: fallback.model,
        provider: fallback.provider,
        providerModel: fallback.model.name,
        ...(apiKey === undefined ? {} : { apiKey }),
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "provider_credential_unavailable"
      )
        return undefined;
      throw error;
    }
  }

  private assertProviderAccess(
    subject: AuthSubject,
    provider: ProviderInstance,
  ): void {
    if (!canAccessOrg(subject, provider.orgId)) {
      throw new AuthorizationError(
        "The model provider is outside the caller organization.",
      );
    }
  }

  private assertEnabled(provider: ProviderInstance, model: BaseModel): void {
    if (!model.enabled) {
      throw new ApiError(
        "model_disabled",
        "The requested model is disabled.",
        409,
        { modelId: model.id },
      );
    }
    if (model.available === false) {
      throw new ApiError(
        "model_unavailable",
        "The requested embedding model is no longer available from its provider.",
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
  }

  private async resolveProviderApiKey(
    provider: ProviderInstance,
  ): Promise<string | undefined> {
    if (provider.credentialRef === undefined) {
      if (provider.capabilities.deployment.credentialRequired) {
        throw new ApiError(
          "provider_credential_unavailable",
          "The requested model provider credential is unavailable.",
          503,
          {
            providerId: provider.id,
            credentialRefScheme: "none",
            failureCode: "credential_ref_missing",
          },
        );
      }
      return undefined;
    }
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

interface ResolvedEmbeddingTarget {
  apiKey?: string;
  model: BaseModel;
  provider: ProviderInstance;
  providerModel: string;
}

function embeddingResponse(result: EmbedTextsResult): OpenAiEmbeddingResponse {
  return {
    object: "list",
    model: result.model,
    data: result.embeddings.map((embedding, index) => ({
      object: "embedding",
      index,
      embedding,
    })),
    usage:
      result.usage === undefined
        ? null
        : {
            ...(result.usage.inputTokens === undefined
              ? {}
              : { prompt_tokens: result.usage.inputTokens }),
            ...(result.usage.totalTokens === undefined
              ? {}
              : { total_tokens: result.usage.totalTokens }),
          },
  };
}

function embeddingApiError(
  error: unknown,
  kind: ProviderInstance["type"],
): ApiError {
  return providerApiError(error, { kind, operation: "embeddings" });
}
