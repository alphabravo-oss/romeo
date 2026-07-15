import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import {
  defaultProviderCapabilities,
  getProviderAdapter,
  type BaseModel,
  type ModelPricing,
  type ProviderInstance,
  type ProviderKind,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { assertManagedSecretRef } from "./secret-refs";

export interface CreateProviderInput {
  subject: AuthSubject;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
}

export class ProviderService {
  constructor(private readonly repository: RomeoRepository) {}

  list(subject: AuthSubject): Promise<ProviderInstance[]> {
    assertScope(subject, "providers:read");
    return this.repository.listProviders(subject.orgId);
  }

  models(subject: AuthSubject) {
    assertScope(subject, "models:read");
    return this.repository.listModels(subject.orgId);
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
        enabled: true,
        capabilities: defaultProviderCapabilities(input.type),
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

    const adapter = getProviderAdapter(provider.type);
    const models = await adapter.listModels(provider);
    return this.repository.transaction(async (repository) => {
      const currentProvider = await repository.getProvider(provider.id);
      if (!currentProvider || !canAccessOrg(subject, currentProvider.orgId)) {
        throw notFound("Provider");
      }
      const synced = await repository.upsertModels(models);
      await this.audit(
        repository,
        subject,
        "provider.models.sync",
        "provider",
        currentProvider.id,
        {
          providerType: currentProvider.type,
          modelCount: synced.length,
          modelIds: synced.map((model) => model.id).sort(),
        },
      );
      return synced;
    });
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
