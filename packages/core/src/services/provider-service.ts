import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import {
  defaultProviderCapabilities,
  type BaseModel,
  type ModelPricing,
  type ProviderInstance,
  type ProviderKind,
} from "@romeo/providers";

import type { ModelCatalogQuery, RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import { canUseProvider, canUseProviderModel } from "./access-visibility";
import {
  ProviderCatalogSyncCoordinator,
  providerCatalogStaleState,
  type ProviderCatalogSyncOptions,
} from "./provider-catalog-sync";
import type { SecretResolver } from "./secret-resolver";
import { decorateCatalogModels } from "./catalog-model-decorator";
import { requireAcceptedProviderConnection } from "./provider-connection-config";
import {
  readProviderConnectionExtras,
  saveProviderConnectionExtras,
} from "./provider-connection-extras";
import {
  toProviderResponse,
  toProviderResponses,
} from "./provider-http-mapping";
import { ProviderCatalogSyncJobStore } from "./provider-catalog-sync-job-store";
import {
  deleteProviderRuntimeModel,
  pullProviderRuntimeModel,
  verifyProviderConnection,
} from "./provider-runtime-operations";

export interface CreateProviderInput {
  subject: AuthSubject;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  auth?: string;
  credentialRef?: string;
  deployment?: string;
  modelIds?: string[];
  project?: string;
  region?: string;
  target?: string;
}

export class ProviderService {
  private readonly catalogSync: ProviderCatalogSyncCoordinator;
  readonly catalogSyncJobs: ProviderCatalogSyncJobStore;

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
    this.catalogSyncJobs = new ProviderCatalogSyncJobStore(
      repository,
      (subject, providerId) => this.syncModels(subject, providerId),
    );
  }

  async list(subject: AuthSubject): Promise<ProviderInstance[]> {
    assertScope(subject, "providers:read");
    const providers = await this.repository.listProviders(subject.orgId);
    return this.visibleProviders(subject, providers);
  }

  presentConnections(subject: AuthSubject) {
    return this.list(subject).then((providers) =>
      toProviderResponses(this.repository, subject.orgId, providers),
    );
  }

  async presentConnection(provider: ProviderInstance) {
    return toProviderResponse(
      provider,
      await readProviderConnectionExtras(
        this.repository,
        provider.orgId,
        provider.id,
      ),
    );
  }

  async presentModels(subject: AuthSubject) {
    return decorateCatalogModels(
      this.repository,
      subject.orgId,
      await this.models(subject),
    );
  }

  async presentModelsPage(subject: AuthSubject, input: ModelCatalogQuery) {
    const page = await this.modelsPage(subject, input);
    return {
      ...page,
      items: await decorateCatalogModels(
        this.repository,
        subject.orgId,
        page.items,
      ),
    };
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

  drainCatalogSyncWorker(): Promise<void> {
    return this.catalogSync.drain();
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
    const accepted = requireAcceptedProviderConnection(input);
    return this.repository.transaction(async (repository) => {
      const provider = await repository.createProvider({
        id: createId("provider"),
        orgId: input.subject.orgId,
        type: input.type,
        name: accepted.name,
        baseUrl: accepted.baseUrl,
        ...(accepted.credentialRef === undefined
          ? {}
          : { credentialRef: accepted.credentialRef }),
        ...(accepted.modelIds === undefined ? {} : { modelIds: accepted.modelIds }),
        enabled: true,
        capabilities: defaultProviderCapabilities(input.type),
        catalogSync: { status: "never", modelCount: 0 },
      });
      await saveProviderConnectionExtras(repository, {
        extras: accepted,
        orgId: input.subject.orgId,
        providerId: provider.id,
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
    auth?: string;
    name?: string;
    baseUrl?: string;
    credentialRef?: string;
    deployment?: string;
    modelIds?: string[];
    enabled?: boolean;
    project?: string;
    region?: string;
    target?: string;
  }): Promise<ProviderInstance> {
    assertScope(input.subject, "providers:write");
    const current = await this.repository.getProvider(input.providerId);
    if (!current || !canAccessOrg(input.subject, current.orgId))
      throw notFound("Provider");
    const accepted = requireAcceptedProviderConnection({
      auth: input.auth,
      baseUrl: input.baseUrl ?? current.baseUrl,
      credentialAlreadyConfigured: current.credentialRef !== undefined,
      credentialRef: input.credentialRef,
      deployment: input.deployment,
      kind: current.type,
      modelIds: input.modelIds ?? current.modelIds,
      name: input.name ?? current.name,
      project: input.project,
      region: input.region,
      target: input.target,
    });
    const catalogConfigurationChanged =
      (input.baseUrl !== undefined && input.baseUrl !== current.baseUrl) ||
      (input.credentialRef !== undefined &&
        input.credentialRef !== current.credentialRef) ||
      (input.modelIds !== undefined &&
        JSON.stringify(input.modelIds) !== JSON.stringify(current.modelIds));
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateProvider({
        ...current,
        name: accepted.name,
        baseUrl: accepted.baseUrl,
        ...(input.credentialRef === undefined
          ? {}
          : { credentialRef: accepted.credentialRef }),
        ...(input.modelIds === undefined ? {} : { modelIds: accepted.modelIds }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(catalogConfigurationChanged
          ? {
              catalogSync: providerCatalogStaleState(current.catalogSync),
            }
          : {}),
      });
      const previousExtras = await readProviderConnectionExtras(
        repository,
        input.subject.orgId,
        updated.id,
      );
      await saveProviderConnectionExtras(repository, {
        extras: { ...previousExtras, ...accepted },
        orgId: input.subject.orgId,
        providerId: updated.id,
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

  async verify(subject: AuthSubject, providerId: string) {
    return verifyProviderConnection({
      providerId,
      repository: this.repository,
      subject,
      ...(this.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.options.fetchImpl }),
      ...(this.options.secretResolver === undefined
        ? {}
        : { secretResolver: this.options.secretResolver }),
    });
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
    return pullProviderRuntimeModel({
      model,
      providerId,
      repository: this.repository,
      subject,
      ...(this.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.options.fetchImpl }),
      ...(this.options.secretResolver === undefined
        ? {}
        : { secretResolver: this.options.secretResolver }),
    });
  }

  async deleteModel(subject: AuthSubject, providerId: string, model: string) {
    const result = await deleteProviderRuntimeModel({
      model,
      providerId,
      repository: this.repository,
      subject,
      ...(this.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.options.fetchImpl }),
      ...(this.options.secretResolver === undefined
        ? {}
        : { secretResolver: this.options.secretResolver }),
    });
    await this.syncModels(subject, providerId);
    return result;
  }

  private async audit<A extends AuditAction>(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: A,
    resourceType: string,
    resourceId: string,
    metadata: AuditMetadata<A>,
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
