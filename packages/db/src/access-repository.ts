import { and, asc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  agentModels,
  baseModels,
  chats,
  dataConnectors,
  knowledgeBases,
  objectRecords,
  promptTemplates,
  providerInstances,
  resourceGrants,
  runs,
  toolConnectors,
  toolOperations,
  voiceProfiles,
  workspaceFolders,
  workspaces,
} from "./schema";

export type ResourceTypeRecord =
  | "agent"
  | "chat"
  | "data_connector"
  | "file"
  | "folder"
  | "knowledge_base"
  | "model"
  | "organization"
  | "prompt_template"
  | "provider"
  | "run"
  | "tool"
  | "voice_profile"
  | "workspace";
export type PrincipalTypeRecord = "group" | "service_account" | "user";
export type ResourcePermissionRecord = "read" | "run" | "use" | "write";

export interface ResourceGrantRecord {
  id: string;
  resourceType: ResourceTypeRecord;
  resourceId: string;
  principalType: PrincipalTypeRecord;
  principalId: string;
  permission: ResourcePermissionRecord;
}

export class PgAccessRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listResourceGrants(orgId: string): Promise<ResourceGrantRecord[]> {
    const rows = await this.db
      .select()
      .from(resourceGrants)
      .where(eq(resourceGrants.orgId, orgId))
      .orderBy(
        asc(resourceGrants.resourceType),
        asc(resourceGrants.resourceId),
        asc(resourceGrants.principalType),
        asc(resourceGrants.principalId),
        asc(resourceGrants.permission),
      );
    return rows.map(toResourceGrantRecord);
  }

  async createResourceGrant(
    grant: ResourceGrantRecord,
  ): Promise<ResourceGrantRecord> {
    const orgId = await this.orgIdForGrant(grant);
    const [row] = await this.db
      .insert(resourceGrants)
      .values(toResourceGrantInsert(grant, orgId))
      .onConflictDoNothing({
        target: [
          resourceGrants.orgId,
          resourceGrants.resourceType,
          resourceGrants.resourceId,
          resourceGrants.principalType,
          resourceGrants.principalId,
          resourceGrants.permission,
        ],
      })
      .returning();
    if (row !== undefined) return toResourceGrantRecord(row);

    const [existing] = await this.db
      .select()
      .from(resourceGrants)
      .where(
        and(
          eq(resourceGrants.orgId, orgId),
          eq(resourceGrants.resourceType, grant.resourceType),
          eq(resourceGrants.resourceId, grant.resourceId),
          eq(resourceGrants.principalType, grant.principalType),
          eq(resourceGrants.principalId, grant.principalId),
          eq(resourceGrants.permission, grant.permission),
        ),
      )
      .limit(1);
    return existing === undefined ? grant : toResourceGrantRecord(existing);
  }

  async deleteResourceGrantsForPrincipal(
    orgId: string,
    principalType: PrincipalTypeRecord,
    principalId: string,
  ): Promise<ResourceGrantRecord[]> {
    const filters = and(
      eq(resourceGrants.orgId, orgId),
      eq(resourceGrants.principalType, principalType),
      eq(resourceGrants.principalId, principalId),
    );
    const existing = await this.db
      .select()
      .from(resourceGrants)
      .where(filters)
      .orderBy(
        asc(resourceGrants.resourceType),
        asc(resourceGrants.resourceId),
        asc(resourceGrants.permission),
      );
    if (existing.length === 0) return [];
    await this.db.delete(resourceGrants).where(filters);
    return existing.map(toResourceGrantRecord);
  }

  private async orgIdForGrant(grant: ResourceGrantRecord): Promise<string> {
    if (grant.resourceType === "organization") return grant.resourceId;
    if (grant.resourceType === "workspace")
      return this.requiredOrgId(this.workspaceOrgId(grant.resourceId), grant);
    if (grant.resourceType === "provider")
      return this.requiredOrgId(this.providerOrgId(grant.resourceId), grant);
    if (grant.resourceType === "model")
      return this.requiredOrgId(this.modelOrgId(grant.resourceId), grant);
    if (grant.resourceType === "agent")
      return this.requiredOrgId(this.agentOrgId(grant.resourceId), grant);
    if (grant.resourceType === "chat")
      return this.requiredOrgId(this.chatOrgId(grant.resourceId), grant);
    if (grant.resourceType === "run")
      return this.requiredOrgId(this.runOrgId(grant.resourceId), grant);
    if (grant.resourceType === "data_connector")
      return this.requiredOrgId(
        this.dataConnectorOrgId(grant.resourceId),
        grant,
      );
    if (grant.resourceType === "file")
      return this.requiredOrgId(this.fileObjectOrgId(grant.resourceId), grant);
    if (grant.resourceType === "knowledge_base")
      return this.requiredOrgId(
        this.knowledgeBaseOrgId(grant.resourceId),
        grant,
      );
    if (grant.resourceType === "prompt_template")
      return this.requiredOrgId(
        this.promptTemplateOrgId(grant.resourceId),
        grant,
      );
    if (grant.resourceType === "folder")
      return this.requiredOrgId(
        this.workspaceFolderOrgId(grant.resourceId),
        grant,
      );
    if (grant.resourceType === "voice_profile")
      return this.requiredOrgId(
        this.voiceProfileOrgId(grant.resourceId),
        grant,
      );
    return this.requiredToolOrgId(grant);
  }

  private async requiredToolOrgId(grant: ResourceGrantRecord): Promise<string> {
    const operationOrgId = await this.toolOperationOrgId(grant.resourceId);
    if (operationOrgId !== undefined) return operationOrgId;
    const connectorOrgId = await this.toolConnectorOrgId(grant.resourceId);
    if (connectorOrgId !== undefined) return connectorOrgId;
    throw new Error(
      `Cannot persist grant for unknown tool resource: ${grant.resourceId}`,
    );
  }

  private async requiredOrgId(
    lookup: Promise<string | undefined>,
    grant: ResourceGrantRecord,
  ): Promise<string> {
    const orgId = await lookup;
    if (orgId !== undefined) return orgId;
    throw new Error(
      `Cannot persist grant for unknown ${grant.resourceType} resource: ${grant.resourceId}`,
    );
  }

  private async workspaceOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: workspaces.orgId })
      .from(workspaces)
      .where(eq(workspaces.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async providerOrgId(resourceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: providerInstances.orgId })
      .from(providerInstances)
      .where(eq(providerInstances.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async modelOrgId(resourceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: baseModels.orgId })
      .from(baseModels)
      .where(eq(baseModels.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async agentOrgId(resourceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: agentModels.orgId })
      .from(agentModels)
      .where(eq(agentModels.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async chatOrgId(resourceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: chats.orgId })
      .from(chats)
      .where(eq(chats.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async fileObjectOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: objectRecords.orgId })
      .from(objectRecords)
      .where(eq(objectRecords.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async runOrgId(resourceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: runs.orgId })
      .from(runs)
      .where(eq(runs.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async dataConnectorOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: dataConnectors.orgId })
      .from(dataConnectors)
      .where(eq(dataConnectors.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async knowledgeBaseOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: knowledgeBases.orgId })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async promptTemplateOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: promptTemplates.orgId })
      .from(promptTemplates)
      .where(eq(promptTemplates.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async workspaceFolderOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: workspaceFolders.orgId })
      .from(workspaceFolders)
      .where(eq(workspaceFolders.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async voiceProfileOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: voiceProfiles.orgId })
      .from(voiceProfiles)
      .where(eq(voiceProfiles.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async toolOperationOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: toolOperations.orgId })
      .from(toolOperations)
      .where(eq(toolOperations.id, resourceId))
      .limit(1);
    return row?.orgId;
  }

  private async toolConnectorOrgId(
    resourceId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ orgId: toolConnectors.orgId })
      .from(toolConnectors)
      .where(eq(toolConnectors.id, resourceId))
      .limit(1);
    return row?.orgId;
  }
}

export function toResourceGrantRecord(
  row: typeof resourceGrants.$inferSelect,
): ResourceGrantRecord {
  return {
    id: row.id,
    resourceType: asResourceType(row.resourceType),
    resourceId: row.resourceId,
    principalType: row.principalType,
    principalId: row.principalId,
    permission: row.permission,
  };
}

function toResourceGrantInsert(
  record: ResourceGrantRecord,
  orgId: string,
): typeof resourceGrants.$inferInsert {
  return {
    id: record.id,
    orgId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    principalType: record.principalType,
    principalId: record.principalId,
    permission: record.permission,
  };
}

function asResourceType(value: string): ResourceTypeRecord {
  if (
    value === "agent" ||
    value === "chat" ||
    value === "data_connector" ||
    value === "folder" ||
    value === "knowledge_base" ||
    value === "model" ||
    value === "organization" ||
    value === "prompt_template" ||
    value === "provider" ||
    value === "run" ||
    value === "tool" ||
    value === "voice_profile" ||
    value === "workspace"
  ) {
    return value;
  }
  return "organization";
}
