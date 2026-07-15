import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
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
import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { WebhookEmitter } from "./webhook-service";

export interface OpenAiEmbeddingRequest {
  input: string[];
  model: string;
}

export interface OpenAiEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: "embedding";
  }>;
  model: string;
  object: "list";
  usage: {
    prompt_tokens?: number;
    total_tokens?: number;
  } | null;
}

export class OpenAiEmbeddingsService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      fetchImpl?: typeof fetch;
      quotaCoordinator?: QuotaCoordinator;
      secretResolver?: SecretResolver;
      webhooks?: WebhookEmitter;
    } = {},
  ) {}

  async create(input: {
    request: OpenAiEmbeddingRequest;
    subject: AuthSubject;
  }): Promise<OpenAiEmbeddingResponse> {
    const target = await this.resolveTarget(input.subject, input.request.model);
    try {
      const result = await getEmbeddingAdapter(target.provider.type).embedTexts(
        {
          provider: target.provider,
          model: target.providerModel,
          texts: input.request.input,
          ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
          ...(this.options.fetchImpl === undefined
            ? {}
            : { fetchImpl: this.options.fetchImpl }),
        },
      );
      return embeddingResponse(result);
    } catch (error) {
      throw embeddingApiError(error);
    }
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
    if (catalogModel !== undefined) {
      return this.resolveCatalogTarget(subject, grants, catalogModel);
    }
    return this.resolveProviderFallbackTarget(subject, grants, requestedModel);
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
    const apiKey = await this.resolveProviderApiKey(provider);
    return {
      provider,
      providerModel: model.name,
      ...(apiKey === undefined ? {} : { apiKey }),
    };
  }

  private async resolveProviderFallbackTarget(
    subject: AuthSubject,
    grants: Awaited<ReturnType<RomeoRepository["listResourceGrants"]>>,
    providerModel: string,
  ): Promise<ResolvedEmbeddingTarget> {
    const providers = (await this.repository.listProviders(subject.orgId))
      .filter((provider) => provider.enabled)
      .filter((provider) =>
        hasGrant(subject, grants, "provider", provider.id, "use"),
      );
    const openAiLikeProviders = providers.filter(
      (provider) =>
        provider.type === "openai-compatible" ||
        provider.type === "openai-responses-compatible",
    );
    const candidates =
      openAiLikeProviders.length > 0 ? openAiLikeProviders : providers;
    if (candidates.length === 0) throw notFound("Provider");
    if (candidates.length > 1) {
      throw new ApiError(
        "embedding_provider_ambiguous",
        "Multiple granted providers could serve the requested embedding model.",
        409,
        {
          model: providerModel,
          providerIds: candidates.map((provider) => provider.id).sort(),
        },
      );
    }
    const provider = candidates[0]!;
    this.assertProviderAccess(subject, provider);
    await this.assertModelRequestAllowed(subject, provider);
    const apiKey = await this.resolveProviderApiKey(provider);
    return {
      provider,
      providerModel,
      ...(apiKey === undefined ? {} : { apiKey }),
    };
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

function embeddingApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(
    "provider_embedding_failed",
    "The model provider failed to create embeddings.",
    502,
  );
}
