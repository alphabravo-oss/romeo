import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type {
  ModelDefaultParameters,
  ProviderCatalogSyncState,
} from "@romeo/providers";

import type { RomeoDatabase } from "./client";
import {
  toBaseModelInsert,
  toBaseModelRecord,
  toProviderInsert,
  toProviderRecord,
} from "./provider-record-mapping";
import { baseModels, providerInstances } from "./schema";

export type ProviderKind =
  | "anthropic"
  | "ollama"
  | "openai-compatible"
  | "openai-responses-compatible";
export type ModelModality =
  | "audio-input"
  | "audio-output"
  | "embeddings"
  | "text"
  | "vision";
export type ProviderDeploymentMode = "hosted-api" | "local-runtime";
export type ProviderNetworkAccess = "external-http" | "local-http";

export interface ProviderDeploymentConstraints {
  mode: ProviderDeploymentMode;
  networkAccess: ProviderNetworkAccess;
  credentialRequired: boolean;
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  audioInput: boolean;
  structuredJson: boolean;
  reasoning: boolean;
  imageGeneration?: boolean;
  modalities: ModelModality[];
  deployment: ProviderDeploymentConstraints;
}

export interface ModelPricing {
  inputTokenUsd: number;
  outputTokenUsd: number;
  imageGenerationUsd?: {
    "1024x1024": number;
    "1024x1536": number;
    "1536x1024": number;
  };
}

export interface ProviderRecord {
  id: string;
  orgId: string;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
  modelIds?: string[];
  enabled: boolean;
  capabilities: ProviderCapabilities;
  catalogSync?: ProviderCatalogSyncState;
}

export interface BaseModelRecord {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  available?: boolean;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  pricing?: ModelPricing;
  defaultParameters?: ModelDefaultParameters;
  capabilitiesSource?: "detected" | "override";
}

export class PgProviderRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listProviders(orgId: string): Promise<ProviderRecord[]> {
    const rows = await this.db
      .select()
      .from(providerInstances)
      .where(eq(providerInstances.orgId, orgId))
      .orderBy(asc(providerInstances.name));
    return rows.map(toProviderRecord);
  }

  async getProvider(providerId: string): Promise<ProviderRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(providerInstances)
      .where(eq(providerInstances.id, providerId))
      .limit(1);
    return row === undefined ? undefined : toProviderRecord(row);
  }

  async createProvider(provider: ProviderRecord): Promise<ProviderRecord> {
    const [row] = await this.db
      .insert(providerInstances)
      .values(toProviderInsert(provider))
      .returning();
    return row === undefined ? provider : toProviderRecord(row);
  }

  async updateProvider(provider: ProviderRecord): Promise<ProviderRecord> {
    const [row] = await this.db
      .update(providerInstances)
      .set(toProviderInsert(provider))
      .where(eq(providerInstances.id, provider.id))
      .returning();
    return row === undefined ? provider : toProviderRecord(row);
  }

  async listModels(orgId: string): Promise<BaseModelRecord[]> {
    const rows = await this.db
      .select()
      .from(baseModels)
      .where(eq(baseModels.orgId, orgId))
      .orderBy(asc(baseModels.displayName));
    return rows.map(toBaseModelRecord);
  }

  async listModelsPage(
    orgId: string,
    input: {
      available?: boolean;
      direction?: "asc" | "desc";
      enabled?: boolean;
      limit: number;
      offset: number;
      providerId?: string;
      query?: string;
      sort?:
        | "availability"
        | "contextWindow"
        | "displayName"
        | "enabled"
        | "name";
    },
  ): Promise<{ items: BaseModelRecord[]; total: number }> {
    const query = input.query?.trim();
    const where = and(
      eq(baseModels.orgId, orgId),
      input.providerId === undefined
        ? undefined
        : eq(baseModels.providerId, input.providerId),
      input.enabled === undefined
        ? undefined
        : eq(baseModels.enabled, input.enabled),
      input.available === undefined
        ? undefined
        : eq(baseModels.available, input.available),
      query === undefined || query === ""
        ? undefined
        : or(
            ilike(baseModels.name, `%${query}%`),
            ilike(baseModels.displayName, `%${query}%`),
          ),
    );
    const sortColumn =
      input.sort === "name"
        ? baseModels.name
        : input.sort === "availability"
          ? baseModels.available
          : input.sort === "enabled"
            ? baseModels.enabled
            : input.sort === "contextWindow"
              ? baseModels.contextWindow
              : baseModels.displayName;
    const order = input.direction === "desc" ? desc : asc;
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(baseModels)
        .where(where)
        .orderBy(order(sortColumn), order(baseModels.id))
        .limit(input.limit)
        .offset(input.offset),
      this.db.select({ value: count() }).from(baseModels).where(where),
    ]);
    return {
      items: rows.map(toBaseModelRecord),
      total: totals[0]?.value ?? 0,
    };
  }

  async getModel(modelId: string): Promise<BaseModelRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(baseModels)
      .where(eq(baseModels.id, modelId))
      .limit(1);
    return row === undefined ? undefined : toBaseModelRecord(row);
  }

  async updateModel(model: BaseModelRecord): Promise<BaseModelRecord> {
    const orgId = await this.requiredOrgIdForProvider(model.providerId);
    const [row] = await this.db
      .update(baseModels)
      .set({
        capabilities: model.capabilities,
        contextWindow: model.contextWindow,
        displayName: model.displayName,
        enabled: model.enabled,
        available: model.available ?? true,
        name: model.name,
        orgId,
        pricing: model.pricing ?? null,
        defaultParameters: model.defaultParameters ?? null,
        capabilitiesSource: model.capabilitiesSource ?? "detected",
        providerId: model.providerId,
      })
      .where(eq(baseModels.id, model.id))
      .returning();
    return row === undefined ? model : toBaseModelRecord(row);
  }

  async upsertModels(models: BaseModelRecord[]): Promise<BaseModelRecord[]> {
    if (models.length === 0) return [];
    const orgByProvider = await this.orgByProviderId(
      models.map((model) => model.providerId),
    );
    const rows: BaseModelRecord[] = [];

    for (const model of models) {
      const orgId = orgByProvider.get(model.providerId);
      if (orgId === undefined)
        throw new Error(
          `Cannot upsert model for unknown provider: ${model.providerId}`,
        );
      const [row] = await this.db
        .insert(baseModels)
        .values(toBaseModelInsert(model, orgId))
        .onConflictDoUpdate({
          target: baseModels.id,
          set: {
            capabilities: model.capabilities,
            capabilitiesSource: model.capabilitiesSource ?? "detected",
            contextWindow: model.contextWindow,
            displayName: model.displayName,
            enabled: model.enabled,
            available: model.available ?? true,
            name: model.name,
            orgId,
            pricing: model.pricing ?? null,
            defaultParameters: model.defaultParameters ?? null,
            providerId: model.providerId,
          },
        })
        .returning();
      rows.push(row === undefined ? model : toBaseModelRecord(row));
    }

    return rows;
  }

  private async orgByProviderId(
    providerIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueProviderIds = [...new Set(providerIds)];
    const rows = await this.db
      .select({ id: providerInstances.id, orgId: providerInstances.orgId })
      .from(providerInstances)
      .where(inArray(providerInstances.id, uniqueProviderIds));
    return new Map(rows.map((row) => [row.id, row.orgId]));
  }

  private async requiredOrgIdForProvider(providerId: string): Promise<string> {
    const orgByProvider = await this.orgByProviderId([providerId]);
    const orgId = orgByProvider.get(providerId);
    if (orgId === undefined)
      throw new Error(
        `Cannot persist model for unknown provider: ${providerId}`,
      );
    return orgId;
  }
}

export { toBaseModelRecord, toProviderRecord } from "./provider-record-mapping";
