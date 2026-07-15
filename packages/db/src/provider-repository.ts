import { asc, eq, inArray } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { baseModels, providerInstances } from "./schema";

export type ProviderKind =
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
  modalities: ModelModality[];
  deployment: ProviderDeploymentConstraints;
}

export interface ModelPricing {
  inputTokenUsd: number;
  outputTokenUsd: number;
}

export interface ProviderRecord {
  id: string;
  orgId: string;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
}

export interface BaseModelRecord {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  pricing?: ModelPricing;
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

  async listModels(orgId: string): Promise<BaseModelRecord[]> {
    const rows = await this.db
      .select()
      .from(baseModels)
      .where(eq(baseModels.orgId, orgId))
      .orderBy(asc(baseModels.displayName));
    return rows.map(toBaseModelRecord);
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
        name: model.name,
        orgId,
        pricing: model.pricing ?? null,
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
            contextWindow: model.contextWindow,
            displayName: model.displayName,
            enabled: model.enabled,
            name: model.name,
            orgId,
            pricing: model.pricing ?? null,
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

export function toProviderRecord(
  row: typeof providerInstances.$inferSelect,
): ProviderRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    ...(row.credentialRef === null ? {} : { credentialRef: row.credentialRef }),
    enabled: row.enabled,
    capabilities: asProviderCapabilities(row.capabilities),
  };
}

export function toBaseModelRecord(
  row: typeof baseModels.$inferSelect,
): BaseModelRecord {
  const model: BaseModelRecord = {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    displayName: row.displayName,
    enabled: row.enabled,
    capabilities: asProviderCapabilities(row.capabilities),
    contextWindow: row.contextWindow,
  };
  const pricing = asModelPricing(row.pricing);
  if (pricing !== undefined) model.pricing = pricing;
  return model;
}

function toProviderInsert(
  record: ProviderRecord,
): typeof providerInstances.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    type: record.type,
    name: record.name,
    baseUrl: record.baseUrl,
    credentialRef: record.credentialRef ?? null,
    capabilities: record.capabilities,
    enabled: record.enabled,
  };
}

function toBaseModelInsert(
  record: BaseModelRecord,
  orgId: string,
): typeof baseModels.$inferInsert {
  return {
    id: record.id,
    orgId,
    providerId: record.providerId,
    name: record.name,
    displayName: record.displayName,
    capabilities: record.capabilities,
    contextWindow: record.contextWindow,
    pricing: record.pricing ?? null,
    enabled: record.enabled,
  };
}

function asProviderCapabilities(value: unknown): ProviderCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return conservativeCapabilities();
  const input = value as Record<string, unknown>;
  const deployment = input.deployment;
  return {
    streaming: input.streaming === true,
    toolCalling: input.toolCalling === true,
    vision: input.vision === true,
    audioInput: input.audioInput === true,
    structuredJson: input.structuredJson === true,
    reasoning: input.reasoning === true,
    modalities: asModalities(input.modalities),
    deployment: asDeploymentConstraints(deployment),
  };
}

function asDeploymentConstraints(
  value: unknown,
): ProviderDeploymentConstraints {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return conservativeCapabilities().deployment;
  }
  const input = value as Record<string, unknown>;
  return {
    mode: input.mode === "local-runtime" ? "local-runtime" : "hosted-api",
    networkAccess:
      input.networkAccess === "local-http" ? "local-http" : "external-http",
    credentialRequired: input.credentialRequired !== false,
  };
}

function asModalities(value: unknown): ModelModality[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ModelModality>([
    "audio-input",
    "audio-output",
    "embeddings",
    "text",
    "vision",
  ]);
  return [
    ...new Set(
      value.filter((item): item is ModelModality =>
        allowed.has(item as ModelModality),
      ),
    ),
  ];
}

function asModelPricing(value: unknown): ModelPricing | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.inputTokenUsd !== "number" ||
    typeof input.outputTokenUsd !== "number"
  )
    return undefined;
  if (
    !Number.isFinite(input.inputTokenUsd) ||
    !Number.isFinite(input.outputTokenUsd)
  )
    return undefined;
  return {
    inputTokenUsd: input.inputTokenUsd,
    outputTokenUsd: input.outputTokenUsd,
  };
}

function conservativeCapabilities(): ProviderCapabilities {
  return {
    streaming: false,
    toolCalling: false,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    modalities: [],
    deployment: {
      mode: "hosted-api",
      networkAccess: "external-http",
      credentialRequired: true,
    },
  };
}
