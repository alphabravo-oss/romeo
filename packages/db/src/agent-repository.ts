import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  agentKnowledgeBindings,
  agentModels,
  agentToolBindings,
  agentVersions,
} from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";

export interface AgentParametersRecord {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface AgentSafetySettingsRecord {
  maxUserInputLength?: number;
  blockedTerms?: string[];
  promptInjectionGuard?: AgentPromptInjectionGuardRecord;
}

export interface AgentPromptInjectionGuardRecord {
  mode: "block";
  scanUserInput: boolean;
  scanRetrievedContext: boolean;
}

export interface AgentMemoryPolicyRecord {
  mode: "disabled" | "recent_messages";
  maxMessages?: number;
}

export interface AgentRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParametersRecord;
  memoryPolicy: AgentMemoryPolicyRecord;
  safetySettings: AgentSafetySettingsRecord;
  voiceProfileId?: string;
  publishedVersionId?: string;
  updatedAt: string;
}

export interface AgentKnowledgeBindingRecord {
  id: string;
  orgId: string;
  agentId: string;
  knowledgeBaseId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolBindingRecord {
  id: string;
  orgId: string;
  agentId: string;
  toolId: string;
  enabled: boolean;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentVersionRecord {
  id: string;
  agentId: string;
  orgId: string;
  workspaceId: string;
  version: number;
  status: "published";
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParametersRecord;
  memoryPolicy: AgentMemoryPolicyRecord;
  safetySettings: AgentSafetySettingsRecord;
  voiceProfileId?: string;
  knowledgeBaseBindings?: Array<{ knowledgeBaseId: string; enabled: boolean }>;
  toolBindings?: Array<{
    toolId: string;
    enabled: boolean;
    approvalRequired: boolean;
  }>;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
}

export class PgAgentRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listAgents(workspaceId: string): Promise<AgentRecord[]> {
    const rows = await this.db
      .select()
      .from(agentModels)
      .where(eq(agentModels.workspaceId, workspaceId))
      .orderBy(asc(agentModels.name));
    return rows.map(toAgentRecord);
  }

  async createAgent(agent: AgentRecord): Promise<AgentRecord> {
    const [row] = await this.db
      .insert(agentModels)
      .values(toAgentInsert(agent))
      .returning();
    return row === undefined ? agent : toAgentRecord(row);
  }

  async updateAgent(agent: AgentRecord): Promise<AgentRecord> {
    const [row] = await this.db
      .update(agentModels)
      .set({
        baseModelId: agent.baseModelId,
        memoryPolicy: agent.memoryPolicy,
        name: agent.name,
        parameters: agent.parameters,
        publishedVersionId: agent.publishedVersionId ?? null,
        safetySettings: agent.safetySettings,
        slug: stableAgentSlug(agent),
        systemPrompt: agent.systemPrompt,
        updatedAt: new Date(agent.updatedAt),
        voiceProfileId: agent.voiceProfileId ?? null,
      })
      .where(eq(agentModels.id, agent.id))
      .returning();
    return row === undefined ? agent : toAgentRecord(row);
  }

  async getAgent(agentId: string): Promise<AgentRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(agentModels)
      .where(eq(agentModels.id, agentId))
      .limit(1);
    return row === undefined ? undefined : toAgentRecord(row);
  }

  async listAgentKnowledgeBindings(
    agentId: string,
  ): Promise<AgentKnowledgeBindingRecord[]> {
    const rows = await this.db
      .select()
      .from(agentKnowledgeBindings)
      .where(eq(agentKnowledgeBindings.agentId, agentId))
      .orderBy(asc(agentKnowledgeBindings.knowledgeBaseId));
    return rows.map(toAgentKnowledgeBindingRecord);
  }

  async upsertAgentKnowledgeBinding(
    binding: AgentKnowledgeBindingRecord,
  ): Promise<AgentKnowledgeBindingRecord> {
    const [row] = await this.db
      .insert(agentKnowledgeBindings)
      .values(toAgentKnowledgeBindingInsert(binding))
      .onConflictDoUpdate({
        target: [
          agentKnowledgeBindings.agentId,
          agentKnowledgeBindings.knowledgeBaseId,
        ],
        set: {
          enabled: binding.enabled,
          id: binding.id,
          orgId: binding.orgId,
          updatedAt: new Date(binding.updatedAt),
        },
      })
      .returning();
    return row === undefined ? binding : toAgentKnowledgeBindingRecord(row);
  }

  async listAgentToolBindings(
    agentId: string,
  ): Promise<AgentToolBindingRecord[]> {
    const rows = await this.db
      .select()
      .from(agentToolBindings)
      .where(eq(agentToolBindings.agentId, agentId))
      .orderBy(asc(agentToolBindings.toolId));
    return rows.map(toAgentToolBindingRecord);
  }

  async upsertAgentToolBinding(
    binding: AgentToolBindingRecord,
  ): Promise<AgentToolBindingRecord> {
    const [row] = await this.db
      .insert(agentToolBindings)
      .values(toAgentToolBindingInsert(binding))
      .onConflictDoUpdate({
        target: [agentToolBindings.agentId, agentToolBindings.toolId],
        set: {
          approvalRequired: binding.approvalRequired,
          enabled: binding.enabled,
          id: binding.id,
          orgId: binding.orgId,
          updatedAt: new Date(binding.updatedAt),
        },
      })
      .returning();
    return row === undefined ? binding : toAgentToolBindingRecord(row);
  }

  async listAgentVersions(agentId: string): Promise<AgentVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.version));
    return rows.map(toAgentVersionRecord);
  }

  async getAgentVersion(
    versionId: string,
  ): Promise<AgentVersionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId))
      .limit(1);
    return row === undefined ? undefined : toAgentVersionRecord(row);
  }

  async createAgentVersion(
    version: AgentVersionRecord,
  ): Promise<AgentVersionRecord> {
    const [row] = await this.db
      .insert(agentVersions)
      .values(toAgentVersionInsert(version))
      .returning();
    return row === undefined ? version : toAgentVersionRecord(row);
  }
}

export function toAgentRecord(
  row: typeof agentModels.$inferSelect,
): AgentRecord {
  const agent: AgentRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    name: row.name,
    createdBy: row.createdBy,
    baseModelId: row.baseModelId,
    systemPrompt: row.systemPrompt,
    parameters: asAgentParameters(row.parameters),
    memoryPolicy: asAgentMemoryPolicy(row.memoryPolicy),
    safetySettings: asAgentSafetySettings(row.safetySettings),
    updatedAt: toIsoString(row.updatedAt),
  };
  const voiceProfileId = optionalIsoString(row.voiceProfileId);
  if (voiceProfileId !== undefined) agent.voiceProfileId = voiceProfileId;
  const publishedVersionId = optionalIsoString(row.publishedVersionId);
  if (publishedVersionId !== undefined)
    agent.publishedVersionId = publishedVersionId;
  return agent;
}

export function toAgentKnowledgeBindingRecord(
  row: typeof agentKnowledgeBindings.$inferSelect,
): AgentKnowledgeBindingRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    agentId: row.agentId,
    knowledgeBaseId: row.knowledgeBaseId,
    enabled: row.enabled,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toAgentToolBindingRecord(
  row: typeof agentToolBindings.$inferSelect,
): AgentToolBindingRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    agentId: row.agentId,
    toolId: row.toolId,
    enabled: row.enabled,
    approvalRequired: row.approvalRequired,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toAgentVersionRecord(
  row: typeof agentVersions.$inferSelect,
): AgentVersionRecord {
  const version: AgentVersionRecord = {
    id: row.id,
    agentId: row.agentId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    version: row.version,
    status: "published",
    baseModelId: row.baseModelId,
    systemPrompt: row.systemPrompt,
    parameters: asAgentParameters(row.parameters),
    memoryPolicy: asAgentMemoryPolicy(row.memoryPolicy),
    safetySettings: asAgentSafetySettings(row.safetySettings),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    publishedAt:
      optionalIsoString(row.publishedAt) ?? toIsoString(row.createdAt),
  };
  const voiceProfileId = optionalIsoString(row.voiceProfileId);
  if (voiceProfileId !== undefined) version.voiceProfileId = voiceProfileId;
  const knowledgeBaseBindings = asVersionKnowledgeBindings(
    row.knowledgeBaseBindings,
  );
  if (knowledgeBaseBindings.length > 0)
    version.knowledgeBaseBindings = knowledgeBaseBindings;
  const toolBindings = asVersionToolBindings(row.toolBindings);
  if (toolBindings.length > 0) version.toolBindings = toolBindings;
  return version;
}

function toAgentInsert(record: AgentRecord): typeof agentModels.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    name: record.name,
    slug: stableAgentSlug(record),
    baseModelId: record.baseModelId,
    systemPrompt: record.systemPrompt,
    parameters: record.parameters,
    memoryPolicy: record.memoryPolicy,
    safetySettings: record.safetySettings,
    voiceProfileId: record.voiceProfileId ?? null,
    publishedVersionId: record.publishedVersionId ?? null,
    createdBy: record.createdBy,
    updatedAt: new Date(record.updatedAt),
  };
}

function toAgentKnowledgeBindingInsert(
  record: AgentKnowledgeBindingRecord,
): typeof agentKnowledgeBindings.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    agentId: record.agentId,
    knowledgeBaseId: record.knowledgeBaseId,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toAgentToolBindingInsert(
  record: AgentToolBindingRecord,
): typeof agentToolBindings.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    agentId: record.agentId,
    toolId: record.toolId,
    enabled: record.enabled,
    approvalRequired: record.approvalRequired,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toAgentVersionInsert(
  record: AgentVersionRecord,
): typeof agentVersions.$inferInsert {
  return {
    id: record.id,
    agentId: record.agentId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    version: record.version,
    status: record.status,
    baseModelId: record.baseModelId,
    systemPrompt: record.systemPrompt,
    parameters: record.parameters,
    memoryPolicy: record.memoryPolicy,
    safetySettings: record.safetySettings,
    voiceProfileId: record.voiceProfileId ?? null,
    knowledgeBaseBindings: record.knowledgeBaseBindings ?? [],
    toolBindings: record.toolBindings ?? [],
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    publishedAt: new Date(record.publishedAt),
  };
}

function stableAgentSlug(record: Pick<AgentRecord, "id">): string {
  return record.id;
}

function asAgentParameters(value: unknown): AgentParametersRecord {
  return asJsonRecord(value);
}

function asAgentSafetySettings(value: unknown): AgentSafetySettingsRecord {
  const input = asJsonRecord(value);
  const settings: AgentSafetySettingsRecord = {};
  if (typeof input.maxUserInputLength === "number")
    settings.maxUserInputLength = input.maxUserInputLength;
  if (Array.isArray(input.blockedTerms)) {
    settings.blockedTerms = input.blockedTerms.filter(
      (item): item is string => typeof item === "string",
    );
  }
  if (input.promptInjectionGuard !== undefined) {
    const guard = asJsonRecord(input.promptInjectionGuard);
    if (guard.mode === "block") {
      settings.promptInjectionGuard = {
        mode: "block",
        scanUserInput:
          typeof guard.scanUserInput === "boolean"
            ? guard.scanUserInput
            : true,
        scanRetrievedContext:
          typeof guard.scanRetrievedContext === "boolean"
            ? guard.scanRetrievedContext
            : true,
      };
    }
  }
  return settings;
}

function asAgentMemoryPolicy(value: unknown): AgentMemoryPolicyRecord {
  const input = asJsonRecord(value);
  if (input.mode !== "recent_messages") return { mode: "disabled" };
  const policy: AgentMemoryPolicyRecord = { mode: "recent_messages" };
  if (typeof input.maxMessages === "number")
    policy.maxMessages = input.maxMessages;
  return policy;
}

function asVersionKnowledgeBindings(
  value: unknown,
): Array<{ knowledgeBaseId: string; enabled: boolean }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const input = asJsonRecord(item);
      if (typeof input.knowledgeBaseId !== "string") return undefined;
      return {
        knowledgeBaseId: input.knowledgeBaseId,
        enabled: input.enabled !== false,
      };
    })
    .filter(
      (item): item is { knowledgeBaseId: string; enabled: boolean } =>
        item !== undefined,
    );
}

function asVersionToolBindings(
  value: unknown,
): Array<{ toolId: string; enabled: boolean; approvalRequired: boolean }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const input = asJsonRecord(item);
      if (typeof input.toolId !== "string") return undefined;
      return {
        toolId: input.toolId,
        enabled: input.enabled !== false,
        approvalRequired: input.approvalRequired === true,
      };
    })
    .filter(
      (
        item,
      ): item is {
        toolId: string;
        enabled: boolean;
        approvalRequired: boolean;
      } => item !== undefined,
    );
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
