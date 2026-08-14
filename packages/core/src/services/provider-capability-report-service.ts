import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import type {
  ProviderCapabilityReport,
  ProviderModelCapabilityReport,
} from "@romeo/contracts";
import {
  defaultProviderCapabilities,
  getProviderDialectSummary,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { canUseProvider, canUseProviderModel } from "./access-visibility";

export class ProviderCapabilityReportService {
  constructor(private readonly repository: RomeoRepository) {}

  async provider(
    subject: AuthSubject,
    providerId: string,
  ): Promise<ProviderCapabilityReport> {
    assertScope(subject, "providers:read");
    assertScope(subject, "models:read");
    const provider = await this.repository.getProvider(providerId);
    if (!provider || !canAccessOrg(subject, provider.orgId))
      throw notFound("Provider");
    const grants =
      subject.isAdmin === true
        ? []
        : await this.repository.listResourceGrants(subject.orgId);
    if (!canUseProvider(subject, grants, provider.id))
      throw notFound("Provider");

    const models = (await this.repository.listModels(subject.orgId)).filter(
      (model) =>
        model.providerId === provider.id &&
        canUseProviderModel(subject, grants, model),
    );
    const dialect = getProviderDialectSummary(provider.type);
    const { kind: _kind, ...dialectSummary } = dialect;
    return {
      providerId: provider.id,
      kind: provider.type,
      enabled: provider.enabled,
      credentialConfigured: provider.credentialRef !== undefined,
      dialect: dialectSummary,
      advertisedDefaults: structuredClone(
        defaultProviderCapabilities(provider.type),
      ),
      configuredCapabilities: structuredClone(provider.capabilities),
      catalog: {
        status: provider.catalogSync?.status ?? "never",
        modelCount: provider.catalogSync?.modelCount ?? 0,
        ...(provider.catalogSync?.lastAttemptAt === undefined
          ? {}
          : { lastAttemptAt: provider.catalogSync.lastAttemptAt }),
        ...(provider.catalogSync?.lastSyncedAt === undefined
          ? {}
          : { lastSyncedAt: provider.catalogSync.lastSyncedAt }),
      },
      visibleModels: {
        total: models.length,
        enabled: models.filter((model) => model.enabled).length,
        available: models.filter((model) => model.available !== false).length,
      },
    };
  }

  async model(
    subject: AuthSubject,
    modelId: string,
  ): Promise<ProviderModelCapabilityReport> {
    assertScope(subject, "models:read");
    const model = await this.repository.getModel(modelId);
    if (model === undefined) throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (!provider || !canAccessOrg(subject, provider.orgId))
      throw notFound("Model");
    const grants =
      subject.isAdmin === true
        ? []
        : await this.repository.listResourceGrants(subject.orgId);
    if (!canUseProviderModel(subject, grants, model)) throw notFound("Model");

    const available = model.available !== false;
    const operationalReason = !provider.enabled
      ? "provider_disabled"
      : !model.enabled
        ? "model_disabled"
        : !available
          ? "model_unavailable"
          : "available";
    const dialect = getProviderDialectSummary(provider.type);
    const { kind: _kind, ...dialectSummary } = dialect;
    return {
      modelId: model.id,
      providerId: provider.id,
      kind: provider.type,
      name: model.name,
      displayName: model.displayName,
      enabled: model.enabled,
      available,
      capabilitySource: model.capabilitiesSource ?? "detected",
      capabilities: structuredClone(model.capabilities),
      limits: {
        contextWindow: model.contextWindow,
        ...(model.defaultParameters === undefined
          ? {}
          : { defaultParameters: structuredClone(model.defaultParameters) }),
      },
      provider: {
        enabled: provider.enabled,
        dialect: dialectSummary,
        catalogStatus: provider.catalogSync?.status ?? "never",
      },
      operationallyUsable: operationalReason === "available",
      operationalReason,
    };
  }
}
