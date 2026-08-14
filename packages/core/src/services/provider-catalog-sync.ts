import type { AuthSubject } from "@romeo/auth";
import {
  getProviderAdapter,
  type BaseModel,
  type ProviderCatalogSyncState,
  type ProviderInstance,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import { providerApiError } from "./provider-api-error";
import type { SecretResolver } from "./secret-resolver";
import { withTelemetryFetch } from "./telemetry-context";
import { WorkerSupervisor } from "./worker-supervisor";

export interface ProviderCatalogSyncOptions {
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  secretResolver?: SecretResolver;
  timeoutMs?: number;
  ttlMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const WORKER_CONCURRENCY = 3;

export class ProviderCatalogSyncCoordinator {
  private readonly inFlight = new Map<string, Promise<BaseModel[]>>();
  private readonly supervisor = new WorkerSupervisor("provider_catalog_sync");

  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: ProviderCatalogSyncOptions = {},
  ) {}

  start(): void {
    if (this.options.enabled === false) return;
    const intervalMs = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.supervisor.start((signal) => this.runOnce(signal), {
      intervalMs,
      maxBackoffMs: intervalMs * 16,
      jitterRatio: 0.2,
    });
  }

  stop(): void {
    this.supervisor.stop();
  }

  drain(): Promise<void> {
    return this.supervisor.drain();
  }

  async ensureFreshForOrg(orgId: string): Promise<void> {
    if (this.options.enabled === false) return;
    const providers = (await this.repository.listProviders(orgId)).filter(
      (provider) => this.shouldSync(provider),
    );
    await this.syncProviders(providers);
  }

  async runOnce(signal?: AbortSignal): Promise<number> {
    if (this.options.enabled === false) return 0;
    const organizations = await this.repository.listAllOrganizations();
    if (signal?.aborted === true) return 0;
    const providerGroups = await Promise.all(
      organizations.map((organization) =>
        this.repository.listProviders(organization.id),
      ),
    );
    const providers = providerGroups
      .flat()
      .filter((provider) => this.shouldSync(provider));
    await this.syncProviders(providers, signal);
    return providers.length;
  }

  syncProvider(
    subject: AuthSubject,
    provider: ProviderInstance,
  ): Promise<BaseModel[]> {
    const existing = this.inFlight.get(provider.id);
    if (existing !== undefined) return existing;
    const pending = this.performSync(subject, provider).finally(() => {
      this.inFlight.delete(provider.id);
    });
    this.inFlight.set(provider.id, pending);
    return pending;
  }

  private shouldSync(provider: ProviderInstance): boolean {
    if (!provider.enabled) return false;
    const state = provider.catalogSync;
    if (state === undefined || state.status === "never") return true;
    if (state.status === "stale") return true;
    const reference =
      state.status === "ready" ? state.lastSyncedAt : state.lastAttemptAt;
    if (reference === undefined) return true;
    const elapsed = Date.now() - new Date(reference).getTime();
    return (
      !Number.isFinite(elapsed) ||
      elapsed >= (this.options.ttlMs ?? DEFAULT_TTL_MS)
    );
  }

  private async syncProviders(
    providers: ProviderInstance[],
    signal?: AbortSignal,
  ): Promise<void> {
    for (let index = 0; index < providers.length; index += WORKER_CONCURRENCY) {
      if (signal?.aborted === true) return;
      const batch = providers.slice(index, index + WORKER_CONCURRENCY);
      await Promise.allSettled(
        batch.map((provider) =>
          this.syncProvider(workerSubject(provider.orgId), provider),
        ),
      );
    }
  }

  private async performSync(
    subject: AuthSubject,
    requestedProvider: ProviderInstance,
  ): Promise<BaseModel[]> {
    const attemptAt = new Date().toISOString();
    const provider = await this.markSyncing(requestedProvider.id, attemptAt);
    const adapter = getProviderAdapter(provider.type);
    const resolution = await this.resolveCredential(provider);
    let models: BaseModel[];
    try {
      models = await adapter.listModels(provider, {
        ...(resolution?.value === undefined
          ? {}
          : { apiKey: resolution.value }),
        fetchImpl: withTelemetryFetch(this.options.fetchImpl ?? fetch),
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (models.length === 0 && provider.type !== "ollama") {
        throw new Error(
          "The provider returned no discoverable models. Configure model IDs if this endpoint does not support its model-list API.",
        );
      }
    } catch (caught) {
      const message = "The provider model catalog could not be refreshed.";
      await this.markError(provider, attemptAt, message);
      await writeAuditLog(this.repository, {
        subject,
        action: "provider.models.sync",
        resourceType: "provider",
        resourceId: provider.id,
        outcome: "failure",
        metadata: { error: message.slice(0, 300) },
      });
      throw providerApiError(caught, {
        kind: provider.type,
        operation: "discovery",
      });
    }

    try {
      return await this.reconcile(subject, provider, models, attemptAt);
    } catch (caught) {
      await this.markError(
        provider,
        attemptAt,
        "Romeo could not persist the synchronized model catalog.",
      );
      await writeAuditLog(this.repository, {
        subject,
        action: "provider.models.sync",
        resourceType: "provider",
        resourceId: provider.id,
        outcome: "failure",
        metadata: {
          error: "Romeo could not persist the synchronized model catalog.",
        },
      });
      throw caught;
    }
  }

  private async markSyncing(
    providerId: string,
    attemptAt: string,
  ): Promise<ProviderInstance> {
    const current = await this.repository.getProvider(providerId);
    if (current === undefined) throw notFound("Provider");
    return this.repository.updateProvider({
      ...current,
      catalogSync: {
        status: "syncing",
        modelCount: current.catalogSync?.modelCount ?? 0,
        lastAttemptAt: attemptAt,
        ...(current.catalogSync?.lastSyncedAt === undefined
          ? {}
          : { lastSyncedAt: current.catalogSync.lastSyncedAt }),
      },
    });
  }

  private async markError(
    requestedProvider: ProviderInstance,
    attemptAt: string,
    message: string,
  ): Promise<void> {
    const current = await this.repository.getProvider(requestedProvider.id);
    if (
      current === undefined ||
      !sameCatalogConfiguration(current, requestedProvider)
    ) {
      return;
    }
    await this.repository.updateProvider({
      ...current,
      catalogSync: {
        status: "error",
        modelCount: current.catalogSync?.modelCount ?? 0,
        lastAttemptAt: attemptAt,
        ...(current.catalogSync?.lastSyncedAt === undefined
          ? {}
          : { lastSyncedAt: current.catalogSync.lastSyncedAt }),
        error: message.slice(0, 1_000),
      },
    });
  }

  private async reconcile(
    subject: AuthSubject,
    requestedProvider: ProviderInstance,
    models: BaseModel[],
    attemptAt: string,
  ): Promise<BaseModel[]> {
    return this.repository.transaction(async (repository) => {
      const currentProvider = await repository.getProvider(
        requestedProvider.id,
      );
      if (currentProvider === undefined) throw notFound("Provider");
      if (!sameCatalogConfiguration(currentProvider, requestedProvider)) {
        await repository.updateProvider({
          ...currentProvider,
          catalogSync: providerCatalogStaleState(currentProvider.catalogSync),
        });
        throw new ApiError(
          "provider_configuration_changed",
          "The provider configuration changed during model discovery. Romeo will retry with the new settings.",
          409,
        );
      }

      const currentById = new Map(
        (await repository.listModels(currentProvider.orgId))
          .filter((model) => model.providerId === currentProvider.id)
          .map((model) => [model.id, model]),
      );
      const currentByName = new Map(
        [...currentById.values()].map((model) => [model.name, model]),
      );
      const discoveredModels = models.map((model) => {
        // Catalog adapters derive deterministic IDs, but older installations
        // may already reference a stable model ID created before that scheme.
        // Preserve the referenced record when provider + provider model name
        // match instead of duplicating the model and breaking agent bindings.
        const current =
          currentById.get(model.id) ?? currentByName.get(model.name);
        if (current === undefined) {
          return {
            ...model,
            available: true,
            capabilitiesSource: "detected" as const,
          };
        }
        return {
          ...model,
          id: current.id,
          available: true,
          enabled: current.enabled,
          ...(current.pricing === undefined
            ? {}
            : { pricing: current.pricing }),
          ...(current.defaultParameters === undefined
            ? {}
            : { defaultParameters: current.defaultParameters }),
          ...(current.capabilitiesSource === "override"
            ? {
                capabilities: current.capabilities,
                contextWindow: current.contextWindow,
                capabilitiesSource: "override" as const,
              }
            : { capabilitiesSource: "detected" as const }),
        };
      });
      const discoveredIds = new Set(discoveredModels.map((model) => model.id));
      const unavailableModels = [...currentById.values()]
        .filter(
          (model) => !discoveredIds.has(model.id) && model.available !== false,
        )
        .map((model) => ({ ...model, available: false }));
      const reconciled = await repository.upsertModels([
        ...discoveredModels,
        ...unavailableModels,
      ]);
      const synced = reconciled.filter((model) => discoveredIds.has(model.id));
      await repository.updateProvider({
        ...currentProvider,
        catalogSync: {
          status: "ready",
          modelCount: synced.length,
          lastAttemptAt: attemptAt,
          lastSyncedAt: new Date().toISOString(),
        },
      });
      await writeAuditLog(repository, {
        subject,
        action: "provider.models.sync",
        resourceType: "provider",
        resourceId: currentProvider.id,
        metadata: {
          providerType: currentProvider.type,
          modelCount: synced.length,
          unavailableModelCount: unavailableModels.length,
        },
      });
      return synced;
    });
  }

  private resolveCredential(provider: ProviderInstance) {
    return provider.credentialRef === undefined ||
      this.options.secretResolver?.resolveValue === undefined
      ? Promise.resolve(undefined)
      : this.options.secretResolver.resolveValue(provider.credentialRef);
  }
}

function workerSubject(orgId: string): AuthSubject {
  return {
    id: "system_provider_catalog_sync",
    type: "service_account",
    orgId,
    workspaceIds: [],
    groupIds: [],
    scopes: ["providers:read", "providers:write", "models:read"],
  };
}

function sameCatalogConfiguration(
  left: ProviderInstance,
  right: ProviderInstance,
): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.credentialRef === right.credentialRef &&
    JSON.stringify(left.modelIds ?? []) === JSON.stringify(right.modelIds ?? [])
  );
}

export function providerCatalogStaleState(
  state: ProviderCatalogSyncState | undefined,
): ProviderCatalogSyncState {
  return {
    status: state?.lastSyncedAt === undefined ? "never" : "stale",
    modelCount: state?.modelCount ?? 0,
    ...(state?.lastAttemptAt === undefined
      ? {}
      : { lastAttemptAt: state.lastAttemptAt }),
    ...(state?.lastSyncedAt === undefined
      ? {}
      : { lastSyncedAt: state.lastSyncedAt }),
  };
}
