import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";
import type { BaseModel, ProviderInstance } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
  createProviderRoutePlan,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import type { SecretResolver } from "./secret-resolver";

export interface ResolvedChatModelTarget {
  apiKey?: string;
  model: BaseModel;
  provider: ProviderInstance;
}

export class OpenAiChatTargetResolver {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly routingPolicy: ProviderRoutingPolicy,
    private readonly secretResolver?: SecretResolver,
  ) {}

  async resolveTarget(
    subject: AuthSubject,
    requestedModel: string,
  ): Promise<ResolvedChatModelTarget> {
    assertScope(subject, "models:use");
    const model = await this.resolveModel(subject.orgId, requestedModel);
    const provider = await this.repository.getProvider(model.providerId);
    if (provider === undefined) throw notFound("Provider");
    if (!canAccessOrg(subject, provider.orgId))
      throw new AuthorizationError(
        "The model provider is outside the caller organization.",
      );
    assertModelAvailable(model, provider);
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "model", model.id, "use"))
      throw new AuthorizationError(
        `Missing use permission for model:${model.id}`,
      );
    if (!hasGrant(subject, grants, "provider", provider.id, "use"))
      throw new AuthorizationError(
        `Missing use permission for provider:${provider.id}`,
      );
    const apiKey = this.routingPolicy.disabledProviderIds.has(provider.id)
      ? undefined
      : await this.resolveProviderApiKey(provider);
    return { model, provider, ...(apiKey === undefined ? {} : { apiKey }) };
  }

  async resolveFallbackTarget(
    subject: AuthSubject,
    primary: ResolvedChatModelTarget,
  ): Promise<ResolvedChatModelTarget | undefined> {
    const fallback = (
      await createProviderRoutePlan(
        this.repository,
        this.routingPolicy,
        primary,
      )
    ).fallback;
    if (
      fallback === undefined ||
      !fallback.model.capabilities.modalities.includes("text")
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
    if (matches.length > 1)
      throw new ApiError(
        "model_ambiguous",
        "Multiple models match the requested OpenAI-compatible model name.",
        409,
        { model: trimmed, modelIds: matches.map((model) => model.id).sort() },
      );
    return matches[0]!;
  }

  private async resolveProviderApiKey(
    provider: ProviderInstance,
  ): Promise<string | undefined> {
    if (provider.credentialRef === undefined) return undefined;
    const resolution = await this.secretResolver?.resolveValue?.(
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

function assertModelAvailable(
  model: BaseModel,
  provider: ProviderInstance,
): void {
  if (!model.enabled || model.available === false)
    throw new ApiError(
      model.available === false ? "model_unavailable" : "model_disabled",
      model.available === false
        ? "The requested model is no longer available from its provider."
        : "The requested model is disabled.",
      409,
      { modelId: model.id },
    );
  if (!provider.enabled)
    throw new ApiError(
      "provider_disabled",
      "The requested model provider is disabled.",
      409,
      { providerId: provider.id },
    );
  if (!model.capabilities.modalities.includes("text"))
    throw new ApiError(
      "model_modality_unsupported",
      "The requested model does not support text chat completions.",
      400,
      { modelId: model.id },
    );
}
