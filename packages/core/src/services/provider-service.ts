import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import {
  defaultProviderCapabilities,
  getProviderAdapter,
  deleteOllamaModel,
  pullOllamaModel,
  type BaseModel,
  type ModelPricing,
  type ProviderInstance,
  type ProviderKind,
} from "@romeo/providers";

import type { ModelCatalogQuery, RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { canUseProvider, canUseProviderModel } from "./access-visibility";
import {
  ProviderCatalogSyncCoordinator,
  providerCatalogStaleState,
  type ProviderCatalogSyncOptions,
} from "./provider-catalog-sync";
import { assertManagedSecretRef } from "./secret-refs";
import type { SecretResolver } from "./secret-resolver";
import { withTelemetryFetch } from "./telemetry-context";

export interface CreateProviderInput {
  subject: AuthSubject;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
  modelIds?: string[];
}

export class ProviderService {
  private readonly catalogSync: ProviderCatalogSyncCoordinator;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: {
      catalogSync?: Omit<
        ProviderCatalogSyncOptions,
        "fetchImpl" | "secretResolver"
      >;
      secretResolver?: SecretResolver;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.catalogSync = new ProviderCatalogSyncCoordinator(repository, {
      ...options.catalogSync,
      ...(options.secretResolver === undefined
        ? {}
        : { secretResolver: options.secretResolver }),
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    });
  }

  async list(subject: AuthSubject): Promise<ProviderInstance[]> {
    assertScope(subject, "providers:read");
    const providers = await this.repository.listProviders(subject.orgId);
    return this.visibleProviders(subject, providers);
  }

  async models(subject: AuthSubject) {
    assertScope(subject, "models:read");
    await this.catalogSync.ensureFreshForOrg(subject.orgId);
    const models = await this.repository.listModels(subject.orgId);
    return this.visibleModels(subject, models);
  }

  startCatalogSyncWorker(): void {
    this.catalogSync.start();
  }

  stopCatalogSyncWorker(): void {
    this.catalogSync.stop();
  }

  runCatalogSyncOnce(): Promise<number> {
    return this.catalogSync.runOnce();
  }

  async modelsPage(subject: AuthSubject, input: ModelCatalogQuery) {
    assertScope(subject, "models:read");
    if (subject.isAdmin === true) {
      const page = await this.repository.listModelsPage(subject.orgId, input);
      return { ...page, limit: input.limit, offset: input.offset };
    }
    const catalog = await this.repository.listModelsPage(subject.orgId, {
      ...input,
      limit: 2_000,
      offset: 0,
    });
    const visible = await this.visibleModels(subject, catalog.items);
    return {
      items: visible.slice(input.offset, input.offset + input.limit),
      total: visible.length,
      limit: input.limit,
      offset: input.offset,
    };
  }

  async updateModelPricing(input: {
    subject: AuthSubject;
    modelId: string;
    pricing: ModelPricing;
  }): Promise<BaseModel> {
    assertScope(input.subject, "admin:write");
    const model = await this.repository.getModel(input.modelId);
    if (!model) throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (!provider || !canAccessOrg(input.subject, provider.orgId))
      throw notFound("Model");
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateModel({
        ...model,
        pricing: input.pricing,
      });
      await this.audit(
        repository,
        input.subject,
        "model.pricing.update",
        "model",
        updated.id,
        {
          providerId: provider.id,
          priceFields: Object.keys(input.pricing).sort(),
        },
      );
      return updated;
    });
  }

  async updateModel(input: {
    subject: AuthSubject;
    modelId: string;
    enabled?: boolean;
    capabilities?: BaseModel["capabilities"];
    contextWindow?: number;
    defaultParameters?: BaseModel["defaultParameters"] | null;
  }): Promise<BaseModel> {
    assertScope(input.subject, "admin:write");
    const model = await this.repository.getModel(input.modelId);
    if (!model) throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (!provider || !canAccessOrg(input.subject, provider.orgId))
      throw notFound("Model");
    return this.repository.transaction(async (repository) => {
      const nextModel = {
        ...model,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.capabilities === undefined
          ? {}
          : {
              capabilities: input.capabilities,
              capabilitiesSource: "override" as const,
            }),
        ...(input.contextWindow === undefined
          ? {}
          : { contextWindow: input.contextWindow }),
        ...(input.defaultParameters === undefined ||
        input.defaultParameters === null
          ? {}
          : { defaultParameters: input.defaultParameters }),
      };
      if (input.defaultParameters === null) {
        delete nextModel.defaultParameters;
      }
      const updated = await repository.updateModel(nextModel);
      await this.audit(
        repository,
        input.subject,
        input.capabilities === undefined
          ? "model.enabled.update"
          : "model.capabilities.update",
        "model",
        updated.id,
        { providerId: provider.id },
      );
      return updated;
    });
  }

  async create(input: CreateProviderInput): Promise<ProviderInstance> {
    assertScope(input.subject, "providers:write");
    if (input.credentialRef !== undefined)
      assertManagedSecretRef(input.credentialRef);
    return this.repository.transaction(async (repository) => {
      const provider = await repository.createProvider({
        id: createId("provider"),
        orgId: input.subject.orgId,
        type: input.type,
        name: input.name,
        baseUrl: input.baseUrl,
        ...(input.credentialRef === undefined
          ? {}
          : { credentialRef: input.credentialRef }),
        ...(input.modelIds === undefined ? {} : { modelIds: input.modelIds }),
        enabled: true,
        capabilities: defaultProviderCapabilities(input.type),
        catalogSync: { status: "never", modelCount: 0 },
      });
      await this.audit(
        repository,
        input.subject,
        "provider.create",
        "provider",
        provider.id,
        {
          providerType: provider.type,
          enabled: provider.enabled,
          credentialConfigured: provider.credentialRef !== undefined,
        },
      );
      return provider;
    });
  }

  async update(input: {
    subject: AuthSubject;
    providerId: string;
    name?: string;
    baseUrl?: string;
    credentialRef?: string;
    modelIds?: string[];
    enabled?: boolean;
  }): Promise<ProviderInstance> {
    assertScope(input.subject, "providers:write");
    if (input.credentialRef !== undefined)
      assertManagedSecretRef(input.credentialRef);
    const current = await this.repository.getProvider(input.providerId);
    if (!current || !canAccessOrg(input.subject, current.orgId))
      throw notFound("Provider");
    const catalogConfigurationChanged =
      (input.baseUrl !== undefined && input.baseUrl !== current.baseUrl) ||
      (input.credentialRef !== undefined &&
        input.credentialRef !== current.credentialRef) ||
      (input.modelIds !== undefined &&
        JSON.stringify(input.modelIds) !== JSON.stringify(current.modelIds));
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateProvider({
        ...current,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
        ...(input.credentialRef === undefined
          ? {}
          : { credentialRef: input.credentialRef }),
        ...(input.modelIds === undefined ? {} : { modelIds: input.modelIds }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(catalogConfigurationChanged
          ? {
              catalogSync: providerCatalogStaleState(current.catalogSync),
            }
          : {}),
      });
      await this.audit(
        repository,
        input.subject,
        "provider.update",
        "provider",
        updated.id,
        {
          enabled: updated.enabled,
          credentialConfigured: updated.credentialRef !== undefined,
          modelIdCount: updated.modelIds?.length ?? 0,
        },
      );
      return updated;
    });
  }

  async verify(
    subject: AuthSubject,
    providerId: string,
  ): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number;
    checks: Array<{
      label: string;
      status: "fail" | "pass" | "warning";
      detail: string;
    }>;
  }> {
    assertScope(subject, "providers:write");
    const provider = await this.repository.getProvider(providerId);
    if (!provider || !canAccessOrg(subject, provider.orgId))
      throw notFound("Provider");
    const resolution = await this.resolveCredential(provider);
    const startedAt = Date.now();
    const result = await getProviderAdapter(provider.type).health(provider, {
      ...(resolution?.value === undefined ? {} : { apiKey: resolution.value }),
      fetchImpl: withTelemetryFetch(this.options.fetchImpl ?? fetch),
    });
    const credentialRequired =
      provider.capabilities.deployment.credentialRequired;
    return {
      ...result,
      latencyMs: Date.now() - startedAt,
      checks: [
        {
          label: "Base URL",
          status: "pass",
          detail: provider.baseUrl,
        },
        {
          label: "Credential",
          status:
            credentialRequired && resolution?.value === undefined
              ? "fail"
              : resolution?.value === undefined
                ? "warning"
                : "pass",
          detail:
            resolution?.value !== undefined
              ? "Managed credential resolved."
              : credentialRequired
                ? "A managed API credential is required."
                : "No credential required by this provider type.",
        },
        {
          label: "Model discovery",
          status: result.ok ? "pass" : "fail",
          detail: result.ok
            ? "The endpoint returned usable models."
            : provider.modelIds?.length
              ? "The configured model allowlist could not be verified."
              : "Check network reachability and Models API access, or configure allowed model IDs.",
        },
      ],
    };
  }

  private async visibleModels(
    subject: AuthSubject,
    models: BaseModel[],
  ): Promise<BaseModel[]> {
    if (subject.isAdmin === true) return models;
    const grants = await this.repository.listResourceGrants(subject.orgId);
    return models.filter((model) =>
      canUseProviderModel(subject, grants, model),
    );
  }

  private async visibleProviders(
    subject: AuthSubject,
    providers: ProviderInstance[],
  ): Promise<ProviderInstance[]> {
    if (subject.isAdmin === true) return providers;
    const grants = await this.repository.listResourceGrants(subject.orgId);
    return providers.filter((provider) =>
      canUseProvider(subject, grants, provider.id),
    );
  }

  async syncModels(
    subject: AuthSubject,
    providerId: string,
  ): Promise<BaseModel[]> {
    assertScope(subject, "providers:write");

    const provider = await this.repository.getProvider(providerId);
    if (!provider) throw notFound("Provider");

    if (!canAccessOrg(subject, provider.orgId)) {
      throw notFound("Provider");
    }

    return this.catalogSync.syncProvider(subject, provider);
  }

  async pullModel(subject: AuthSubject, providerId: string, model: string) {
    assertScope(subject, "providers:write");
    const provider = await this.repository.getProvider(providerId);
    if (!provider || !canAccessOrg(subject, provider.orgId))
      throw notFound("Provider");
    if (provider.type !== "ollama") {
      throw new ApiError(
        "provider_operation_not_supported",
        "Pulling models is only supported for Ollama connections.",
        400,
      );
    }
    const resolution = await this.resolveCredential(provider);
    let result;
    try {
      result = await pullOllamaModel(provider, model, {
        ...(resolution?.value === undefined
          ? {}
          : { apiKey: resolution.value }),
        fetchImpl: withTelemetryFetch(this.options.fetchImpl ?? fetch),
      });
    } catch (caught) {
      throw new ApiError(
        "ollama_model_pull_failed",
        caught instanceof Error
          ? caught.message
          : "Ollama could not pull the requested model.",
        502,
      );
    }
    await this.audit(
      this.repository,
      subject,
      "provider.model.pull",
      "provider",
      provider.id,
      { model, status: result.status },
    );
    return result;
  }

  async deleteModel(subject: AuthSubject, providerId: string, model: string) {
    assertScope(subject, "providers:write");
    const provider = await this.repository.getProvider(providerId);
    if (!provider || !canAccessOrg(subject, provider.orgId))
      throw notFound("Provider");
    if (provider.type !== "ollama") {
      throw new ApiError(
        "provider_operation_not_supported",
        "Deleting runtime models is only supported for Ollama connections.",
        400,
      );
    }
    const resolution = await this.resolveCredential(provider);
    let result;
    try {
      result = await deleteOllamaModel(provider, model, {
        ...(resolution?.value === undefined
          ? {}
          : { apiKey: resolution.value }),
        fetchImpl: withTelemetryFetch(this.options.fetchImpl ?? fetch),
      });
    } catch (caught) {
      throw new ApiError(
        "ollama_model_delete_failed",
        caught instanceof Error
          ? caught.message
          : "Ollama could not delete the requested model.",
        502,
      );
    }
    await this.audit(
      this.repository,
      subject,
      "provider.model.delete",
      "provider",
      provider.id,
      { model, status: result.status },
    );
    await this.syncModels(subject, providerId);
    return result;
  }

  private resolveCredential(provider: ProviderInstance) {
    return provider.credentialRef === undefined ||
      this.options.secretResolver?.resolveValue === undefined
      ? Promise.resolve(undefined)
      : this.options.secretResolver.resolveValue(provider.credentialRef);
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }
}
