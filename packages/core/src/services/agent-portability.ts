import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";
import { listBuiltInTools } from "@romeo/tools";

import type {
  Agent,
  AgentMemoryPolicy,
  AgentParameters,
  AgentSafetySettings,
  VoiceProfile,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { normalizeAgentMemoryPolicy } from "./agent-memory";
import { normalizeAgentSafetySettings } from "./agent-safety";
import { filterVisibleServiceAccounts } from "./service-account-access";

export interface PortableAgentKnowledgeBinding {
  knowledgeBaseId: string;
  enabled: boolean;
}

export interface PortableAgentToolBinding {
  toolId: string;
  enabled: boolean;
  approvalRequired: boolean;
}

export interface PortableAgentAccessGrant {
  principalType: ResourceGrant["principalType"];
  principalId: string;
  permissions: Array<
    Extract<ResourceGrant["permission"], "read" | "run" | "write">
  >;
}

export interface AgentExportDocument {
  schemaVersion: 1;
  exportedAt: string;
  agent: {
    name: string;
    baseModelId: string;
    systemPrompt: string;
    parameters: AgentParameters;
    memoryPolicy: AgentMemoryPolicy;
    safetySettings: AgentSafetySettings;
    voiceProfileId?: string;
    accessGrants?: PortableAgentAccessGrant[];
    knowledgeBaseBindings?: PortableAgentKnowledgeBinding[];
    toolBindings?: PortableAgentToolBinding[];
  };
}

export interface ResolvedAgentImportBindings {
  voiceProfileId?: string;
  accessGrants: PortableAgentAccessGrant[];
  knowledgeBaseBindings: PortableAgentKnowledgeBinding[];
  toolBindings: PortableAgentToolBinding[];
}

export interface AgentBindingSnapshot {
  knowledgeBaseBindings: PortableAgentKnowledgeBinding[];
  toolBindings: PortableAgentToolBinding[];
}

const builtInToolIds = new Set(listBuiltInTools().map((tool) => tool.id));

export async function buildAgentExportDocument(
  repository: RomeoRepository,
  agent: Agent,
): Promise<AgentExportDocument> {
  const snapshot = await snapshotAgentBindings(repository, agent.id);
  const accessGrants = await snapshotAgentAccessGrants(repository, agent);
  const exportedAgent: AgentExportDocument["agent"] = {
    name: agent.name,
    baseModelId: agent.baseModelId,
    systemPrompt: agent.systemPrompt,
    parameters: agent.parameters,
    memoryPolicy: normalizeAgentMemoryPolicy(agent.memoryPolicy),
    safetySettings: normalizeAgentSafetySettings(agent.safetySettings),
    accessGrants,
    knowledgeBaseBindings: snapshot.knowledgeBaseBindings,
    toolBindings: snapshot.toolBindings,
  };
  if (agent.voiceProfileId !== undefined)
    exportedAgent.voiceProfileId = agent.voiceProfileId;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    agent: exportedAgent,
  };
}

export async function snapshotAgentBindings(
  repository: RomeoRepository,
  agentId: string,
): Promise<AgentBindingSnapshot> {
  const [knowledgeBaseBindings, toolBindings] = await Promise.all([
    repository.listAgentKnowledgeBindings(agentId),
    repository.listAgentToolBindings(agentId),
  ]);
  return {
    knowledgeBaseBindings: knowledgeBaseBindings
      .map((binding) => ({
        knowledgeBaseId: binding.knowledgeBaseId,
        enabled: binding.enabled,
      }))
      .sort((left, right) =>
        left.knowledgeBaseId.localeCompare(right.knowledgeBaseId),
      ),
    toolBindings: toolBindings
      .map((binding) => ({
        toolId: binding.toolId,
        enabled: binding.enabled,
        approvalRequired: binding.approvalRequired,
      }))
      .sort((left, right) => left.toolId.localeCompare(right.toolId)),
  };
}

export async function applyAgentBindingSnapshot(
  repository: RomeoRepository,
  agent: Agent,
  snapshot: AgentBindingSnapshot,
): Promise<void> {
  const now = new Date().toISOString();
  const [existingKnowledgeBaseBindings, existingToolBindings] =
    await Promise.all([
      repository.listAgentKnowledgeBindings(agent.id),
      repository.listAgentToolBindings(agent.id),
    ]);
  const knowledgeBaseBindingIds = new Set(
    snapshot.knowledgeBaseBindings.map((binding) => binding.knowledgeBaseId),
  );
  const toolBindingIds = new Set(
    snapshot.toolBindings.map((binding) => binding.toolId),
  );
  const existingKnowledgeById = new Map(
    existingKnowledgeBaseBindings.map((binding) => [
      binding.knowledgeBaseId,
      binding,
    ]),
  );
  const existingToolById = new Map(
    existingToolBindings.map((binding) => [binding.toolId, binding]),
  );

  await Promise.all([
    ...snapshot.knowledgeBaseBindings.map((binding) => {
      const existing = existingKnowledgeById.get(binding.knowledgeBaseId);
      return repository.upsertAgentKnowledgeBinding({
        id: existing?.id ?? createId("agent_kb_binding"),
        orgId: agent.orgId,
        agentId: agent.id,
        knowledgeBaseId: binding.knowledgeBaseId,
        enabled: binding.enabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }),
    ...existingKnowledgeBaseBindings
      .filter(
        (binding) =>
          !knowledgeBaseBindingIds.has(binding.knowledgeBaseId) &&
          binding.enabled,
      )
      .map((binding) =>
        repository.upsertAgentKnowledgeBinding({
          ...binding,
          enabled: false,
          updatedAt: now,
        }),
      ),
    ...snapshot.toolBindings.map((binding) => {
      const existing = existingToolById.get(binding.toolId);
      return repository.upsertAgentToolBinding({
        id: existing?.id ?? createId("agent_tool_binding"),
        orgId: agent.orgId,
        agentId: agent.id,
        toolId: binding.toolId,
        enabled: binding.enabled,
        approvalRequired: binding.approvalRequired,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }),
    ...existingToolBindings
      .filter(
        (binding) => !toolBindingIds.has(binding.toolId) && binding.enabled,
      )
      .map((binding) =>
        repository.upsertAgentToolBinding({
          ...binding,
          enabled: false,
          updatedAt: now,
        }),
      ),
  ]);
}

export async function resolveAgentImportBindings(
  repository: RomeoRepository,
  input: {
    agent: AgentExportDocument["agent"];
    subject: AuthSubject;
    workspaceId: string;
  },
): Promise<ResolvedAgentImportBindings> {
  const knowledgeBaseBindings = normalizedKnowledgeBindings(
    input.agent.knowledgeBaseBindings,
  );
  const toolBindings = normalizedToolBindings(input.agent.toolBindings);
  const accessGrants = normalizedAccessGrants(input.agent.accessGrants);
  normalizeAgentMemoryPolicy(input.agent.memoryPolicy);
  normalizeAgentSafetySettings(input.agent.safetySettings);

  let voiceProfileId: string | undefined;
  if (input.agent.voiceProfileId !== undefined) {
    const voiceProfile = await getAuthorizedVoiceProfile(
      repository,
      input.subject,
      input.agent.voiceProfileId,
    );
    voiceProfileId = voiceProfile.id;
  }

  await Promise.all(
    knowledgeBaseBindings.map(async (binding) => {
      const knowledgeBase = await getAuthorizedKnowledgeBase(repository, {
        knowledgeBaseId: binding.knowledgeBaseId,
        subject: input.subject,
        scope: "knowledge:read",
        permission: "use",
      });
      if (knowledgeBase.workspaceId !== input.workspaceId)
        throw new AuthorizationError(
          "The knowledge base is outside the import workspace.",
        );
      return knowledgeBase;
    }),
  );

  if (toolBindings.length > 0) {
    assertScope(input.subject, "tools:manage");
    const grants = await repository.listResourceGrants(input.subject.orgId);
    for (const binding of toolBindings) {
      if (!builtInToolIds.has(binding.toolId)) throw notFound("Tool");
      if (!hasGrant(input.subject, grants, "tool", binding.toolId, "use")) {
        throw new AuthorizationError(
          `Missing use permission for tool:${binding.toolId}`,
        );
      }
    }
  }

  if (accessGrants.length > 0)
    await assertPortableAccessPrincipals(
      repository,
      input.subject,
      accessGrants,
    );

  return {
    accessGrants,
    knowledgeBaseBindings,
    toolBindings,
    ...(voiceProfileId === undefined ? {} : { voiceProfileId }),
  };
}

export async function applyAgentImportBindings(
  repository: RomeoRepository,
  agent: Agent,
  bindings: ResolvedAgentImportBindings,
): Promise<Agent> {
  const now = new Date().toISOString();
  const imported =
    bindings.voiceProfileId === undefined
      ? agent
      : await repository.updateAgent({
          ...agent,
          voiceProfileId: bindings.voiceProfileId,
          updatedAt: now,
        });

  await Promise.all([
    ...bindings.knowledgeBaseBindings.map((binding) =>
      repository.upsertAgentKnowledgeBinding({
        id: createId("agent_kb_binding"),
        orgId: imported.orgId,
        agentId: imported.id,
        knowledgeBaseId: binding.knowledgeBaseId,
        enabled: binding.enabled,
        createdAt: now,
        updatedAt: now,
      }),
    ),
    ...bindings.toolBindings.map((binding) =>
      repository.upsertAgentToolBinding({
        id: createId("agent_tool_binding"),
        orgId: imported.orgId,
        agentId: imported.id,
        toolId: binding.toolId,
        enabled: binding.enabled,
        approvalRequired: binding.approvalRequired,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  ]);

  await applyAgentAccessGrants(repository, imported, bindings.accessGrants);

  return imported;
}

export async function snapshotAgentAccessGrants(
  repository: RomeoRepository,
  agent: Agent,
): Promise<PortableAgentAccessGrant[]> {
  const grants = (await repository.listResourceGrants(agent.orgId)).filter(
    (grant) => grant.resourceType === "agent" && grant.resourceId === agent.id,
  );
  return groupPortableAccessGrants(grants);
}

export async function applyAgentAccessGrants(
  repository: RomeoRepository,
  agent: Agent,
  accessGrants: PortableAgentAccessGrant[],
): Promise<void> {
  const existing = (await repository.listResourceGrants(agent.orgId)).filter(
    (grant) => grant.resourceType === "agent" && grant.resourceId === agent.id,
  );
  const writes: Array<Promise<ResourceGrant>> = [];
  for (const accessGrant of accessGrants) {
    for (const permission of accessGrant.permissions) {
      const alreadyGranted = existing.some(
        (grant) =>
          grant.principalType === accessGrant.principalType &&
          grant.principalId === accessGrant.principalId &&
          grant.permission === permission,
      );
      if (alreadyGranted) continue;
      writes.push(
        repository.createResourceGrant({
          id: createId("grant"),
          resourceType: "agent",
          resourceId: agent.id,
          principalType: accessGrant.principalType,
          principalId: accessGrant.principalId,
          permission,
        }),
      );
    }
  }
  await Promise.all(writes);
}

function normalizedKnowledgeBindings(
  bindings: PortableAgentKnowledgeBinding[] = [],
): PortableAgentKnowledgeBinding[] {
  if (bindings.length > 50)
    throw new ApiError(
      "invalid_agent_import",
      "Agent import supports at most 50 knowledge bindings.",
      400,
    );
  assertUniqueIds(
    bindings.map((binding) => binding.knowledgeBaseId),
    "knowledgeBaseId",
  );
  return bindings.map((binding) => ({
    knowledgeBaseId: binding.knowledgeBaseId,
    enabled: binding.enabled,
  }));
}

function normalizedToolBindings(
  bindings: PortableAgentToolBinding[] = [],
): PortableAgentToolBinding[] {
  if (bindings.length > 100)
    throw new ApiError(
      "invalid_agent_import",
      "Agent import supports at most 100 tool bindings.",
      400,
    );
  assertUniqueIds(
    bindings.map((binding) => binding.toolId),
    "toolId",
  );
  return bindings.map((binding) => ({
    toolId: binding.toolId,
    enabled: binding.enabled,
    approvalRequired: binding.approvalRequired,
  }));
}

function normalizedAccessGrants(
  accessGrants: PortableAgentAccessGrant[] = [],
): PortableAgentAccessGrant[] {
  if (accessGrants.length > 50)
    throw new ApiError(
      "invalid_agent_import",
      "Agent import supports at most 50 access grant entries.",
      400,
    );
  const seen = new Set<string>();
  return accessGrants.map((accessGrant) => {
    const key = `${accessGrant.principalType}:${accessGrant.principalId}`;
    if (seen.has(key))
      throw new ApiError(
        "invalid_agent_import",
        "Agent import contains duplicate access grant principals.",
        400,
      );
    seen.add(key);
    const permissions = [...new Set(accessGrant.permissions)]
      .filter(isPortableAgentPermission)
      .sort();
    if (permissions.length === 0)
      throw new ApiError(
        "invalid_agent_import",
        "Agent import access grants require at least one supported permission.",
        400,
      );
    return {
      principalType: accessGrant.principalType,
      principalId: accessGrant.principalId,
      permissions,
    };
  });
}

function assertUniqueIds(
  ids: string[],
  field: "knowledgeBaseId" | "toolId",
): void {
  if (new Set(ids).size !== ids.length)
    throw new ApiError(
      "invalid_agent_import",
      `Agent import contains duplicate ${field} values.`,
      400,
    );
}

async function getAuthorizedVoiceProfile(
  repository: RomeoRepository,
  subject: AuthSubject,
  voiceProfileId: string,
): Promise<VoiceProfile> {
  assertScope(subject, "voices:use");
  const voiceProfile = await repository.getVoiceProfile(voiceProfileId);
  if (!voiceProfile) throw notFound("Voice profile");
  if (!canAccessOrg(subject, voiceProfile.orgId)) {
    throw new AuthorizationError(
      "The voice profile is outside the caller organization.",
    );
  }
  const grants = await repository.listResourceGrants(subject.orgId);
  if (!hasGrant(subject, grants, "voice_profile", voiceProfile.id, "use")) {
    throw new AuthorizationError(
      `Missing use permission for voice_profile:${voiceProfile.id}`,
    );
  }
  return voiceProfile;
}

async function assertPortableAccessPrincipals(
  repository: RomeoRepository,
  subject: AuthSubject,
  accessGrants: PortableAgentAccessGrant[],
): Promise<void> {
  const [users, groups, serviceAccounts] = await Promise.all([
    repository.listUsers(subject.orgId),
    repository.listGroups(subject.orgId),
    repository.listServiceAccounts(subject.orgId),
  ]);
  const userIds = new Set(users.map((user) => user.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const serviceAccountIds = new Set(
    filterVisibleServiceAccounts(subject, serviceAccounts)
      .filter((account) => account.disabledAt === undefined)
      .map((account) => account.id),
  );

  for (const accessGrant of accessGrants) {
    if (
      accessGrant.principalType === "user" &&
      !userIds.has(accessGrant.principalId)
    )
      throw notFound("Access grant principal");
    if (
      accessGrant.principalType === "group" &&
      !groupIds.has(accessGrant.principalId)
    )
      throw notFound("Access grant principal");
    if (
      accessGrant.principalType === "service_account" &&
      !serviceAccountIds.has(accessGrant.principalId)
    )
      throw notFound("Access grant principal");
  }
}

function groupPortableAccessGrants(
  grants: ResourceGrant[],
): PortableAgentAccessGrant[] {
  const grouped = new Map<string, PortableAgentAccessGrant>();
  for (const grant of grants) {
    if (!isPortableAgentPermission(grant.permission)) continue;
    const key = `${grant.principalType}:${grant.principalId}`;
    const current = grouped.get(key) ?? {
      principalType: grant.principalType,
      principalId: grant.principalId,
      permissions: [],
    };
    current.permissions.push(grant.permission);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((grant) => ({
      ...grant,
      permissions: [...new Set(grant.permissions)].sort(),
    }))
    .sort(
      (left, right) =>
        left.principalType.localeCompare(right.principalType) ||
        left.principalId.localeCompare(right.principalId),
    );
}

function isPortableAgentPermission(
  permission: ResourceGrant["permission"],
): permission is Extract<
  ResourceGrant["permission"],
  "read" | "run" | "write"
> {
  return (
    permission === "read" || permission === "run" || permission === "write"
  );
}
