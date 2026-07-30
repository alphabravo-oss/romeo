import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type {
  Agent,
  AgentMemoryPolicy,
  AgentParameters,
  AgentPromptSuggestion,
  AgentSafetySettings,
  AgentVersion,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { createAgentOwnerGrants, getAuthorizedAgent } from "./agent-access";
import {
  applyAgentBindingSnapshot,
  applyAgentImportBindings,
  buildAgentExportDocument,
  resolveAgentImportBindings,
  snapshotAgentBindings,
  type AgentExportDocument,
} from "./agent-portability";
import { normalizeAgentMemoryPolicy } from "./agent-memory";
import { normalizeAgentSafetySettings } from "./agent-safety";
import { cloneManagedModel } from "./clone-managed-model";
import { managedModelPresentation } from "./managed-model-presentation";
import { AgentReadService } from "./agent-read-service";
import {
  assertAgentEvalGate,
  assertUsableAgentModel,
  attachAgentEvalSummaries,
  bindingCounts,
  changedAgentFields,
  getAgentVersionForAgent,
  hasSafetySettings,
  parameterKeys,
} from "./agent-service-support";
import { diffAgentVersions, type AgentVersionDiff } from "./agent-version-diff";
import { writeAuditLog } from "./audit-log";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export class AgentService extends AgentReadService {
  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    name: string;
    description?: string;
    icon?: string;
    avatarUrl?: string;
    baseModelId: string;
    systemPrompt: string;
    parameters?: AgentParameters;
    memoryPolicy?: AgentMemoryPolicy;
    promptSuggestions?: AgentPromptSuggestion[];
    safetySettings?: AgentSafetySettings;
    tags?: string[];
  }): Promise<Agent> {
    assertScope(input.subject, "agents:create");
    if (!hasWorkspaceAccess(input.subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    await assertUsableAgentModel(
      this.repository,
      input.subject,
      input.baseModelId,
    );

    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_agent_owner",
        name: "Service Account Agent Owner",
      },
    );
    const agent = await this.repository.createAgent({
      id: createId("agent"),
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      name: input.name,
      ...managedModelPresentation({
        avatarUrl: input.avatarUrl,
        description: input.description,
        icon: input.icon,
      }),
      createdBy,
      baseModelId: input.baseModelId,
      systemPrompt: input.systemPrompt,
      parameters: input.parameters ?? {},
      memoryPolicy: normalizeAgentMemoryPolicy(input.memoryPolicy),
      promptSuggestions: normalizePromptSuggestions(input.promptSuggestions),
      safetySettings: normalizeAgentSafetySettings(input.safetySettings),
      tags: normalizeAgentTags(input.tags),
      updatedAt: new Date().toISOString(),
    });
    await createAgentOwnerGrants(this.repository, input.subject, agent.id);
    await this.audit(input.subject, "agent.create", "agent", agent.id, {
      workspaceId: agent.workspaceId,
      baseModelId: agent.baseModelId,
      memoryMode: agent.memoryPolicy.mode,
      parameterKeys: parameterKeys(agent.parameters),
      safetyConfigured: hasSafetySettings(agent.safetySettings),
    });
    return agent;
  }

  async archive(agentId: string, subject: AuthSubject): Promise<Agent> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:write",
    });
    const archived = await this.repository.archiveAgent(
      agent.id,
      new Date().toISOString(),
    );
    if (!archived) throw notFound("Agent");
    await this.audit(subject, "agent.archive", "agent", agent.id, {
      workspaceId: agent.workspaceId,
    });
    return archived;
  }

  async update(input: {
    subject: AuthSubject;
    agentId: string;
    name?: string;
    description?: string;
    icon?: string;
    avatarUrl?: string;
    baseModelId?: string;
    systemPrompt?: string;
    parameters?: AgentParameters;
    memoryPolicy?: AgentMemoryPolicy;
    promptSuggestions?: AgentPromptSuggestion[];
    safetySettings?: AgentSafetySettings;
    tags?: string[];
  }): Promise<Agent> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: agent.workspaceId,
    });
    const baseModelId = input.baseModelId ?? agent.baseModelId;
    await assertUsableAgentModel(this.repository, input.subject, baseModelId);

    const updated = await this.repository.updateAgent({
      ...agent,
      name: input.name ?? agent.name,
      ...managedModelPresentation({
        description: input.description ?? agent.description,
        icon: input.icon ?? agent.icon,
        avatarUrl: input.avatarUrl ?? agent.avatarUrl,
      }),
      baseModelId,
      systemPrompt: input.systemPrompt ?? agent.systemPrompt,
      parameters: input.parameters ?? agent.parameters,
      memoryPolicy:
        input.memoryPolicy === undefined
          ? agent.memoryPolicy
          : normalizeAgentMemoryPolicy(input.memoryPolicy),
      promptSuggestions:
        input.promptSuggestions === undefined
          ? (agent.promptSuggestions ?? [])
          : normalizePromptSuggestions(input.promptSuggestions),
      safetySettings:
        input.safetySettings === undefined
          ? agent.safetySettings
          : normalizeAgentSafetySettings(input.safetySettings),
      tags:
        input.tags === undefined
          ? (agent.tags ?? [])
          : normalizeAgentTags(input.tags),
      updatedAt: new Date().toISOString(),
    });
    await this.audit(input.subject, "agent.update", "agent", updated.id, {
      workspaceId: updated.workspaceId,
      changedFields: changedAgentFields(agent, updated),
      memoryMode: updated.memoryPolicy.mode,
      parameterKeys: parameterKeys(updated.parameters),
      safetyConfigured: hasSafetySettings(updated.safetySettings),
    });
    return updated;
  }

  async clone(input: {
    subject: AuthSubject;
    agentId: string;
    includeKnowledgeBindings?: boolean;
    name?: string;
    systemPrompt?: string;
  }): Promise<Agent> {
    const result = await cloneManagedModel(this.repository, input);
    const { cloned } = result;
    await this.audit(input.subject, "agent.clone", "agent", cloned.id, {
      workspaceId: cloned.workspaceId,
      sourceAgentId: result.sourceAgentId,
      baseModelId: cloned.baseModelId,
      knowledgeBindingsCopied: result.knowledgeBindingsCopied,
    });
    return cloned;
  }

  async exportAgent(
    agentId: string,
    subject: AuthSubject,
  ): Promise<AgentExportDocument> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const document = await buildAgentExportDocument(this.repository, agent);
    await this.audit(subject, "agent.export", "agent", agent.id, {
      workspaceId: agent.workspaceId,
      baseModelId: agent.baseModelId,
      bindingCounts: bindingCounts(document.agent),
    });
    return document;
  }

  async importAgent(input: {
    subject: AuthSubject;
    workspaceId: string;
    agent: AgentExportDocument["agent"];
  }): Promise<Agent> {
    const bindings = await resolveAgentImportBindings(this.repository, input);
    const imported = await this.create({
      subject: input.subject,
      workspaceId: input.workspaceId,
      name: input.agent.name,
      ...managedModelPresentation({
        avatarUrl: input.agent.avatarUrl,
        description: input.agent.description,
        icon: input.agent.icon,
      }),
      baseModelId: input.agent.baseModelId,
      systemPrompt: input.agent.systemPrompt,
      parameters: input.agent.parameters,
      memoryPolicy: input.agent.memoryPolicy,
      promptSuggestions: input.agent.promptSuggestions,
      safetySettings: input.agent.safetySettings,
      tags: input.agent.tags,
    });
    const importedWithBindings = await applyAgentImportBindings(
      this.repository,
      imported,
      bindings,
    );
    await this.audit(
      input.subject,
      "agent.import",
      "agent",
      importedWithBindings.id,
      {
        workspaceId: importedWithBindings.workspaceId,
        baseModelId: importedWithBindings.baseModelId,
        bindingCounts: bindingCounts(input.agent),
        parameterKeys: parameterKeys(imported.parameters),
      },
    );
    return importedWithBindings;
  }

  async listVersions(
    agentId: string,
    subject: AuthSubject,
  ): Promise<AgentVersion[]> {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const versions = await this.repository.listAgentVersions(agentId);
    return attachAgentEvalSummaries(this.repository, agentId, versions);
  }

  async publish(agentId: string, subject: AuthSubject): Promise<AgentVersion> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:write",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId: agent.workspaceId,
    });
    await assertUsableAgentModel(this.repository, subject, agent.baseModelId);
    await assertAgentEvalGate(this.repository, agent.id);

    const publishedAt = new Date().toISOString();
    const published = await this.repository.transaction(async (repository) => {
      const versions = await repository.listAgentVersions(agent.id);
      const bindingSnapshot = await snapshotAgentBindings(repository, agent.id);
      const createdBy = await persistedSubjectActorId(repository, subject, {
        kind: "service_account_agent_version_owner",
        name: "Service Account Agent Version Owner",
      });
      const version: AgentVersion = {
        id: createId("agent_version"),
        agentId: agent.id,
        orgId: agent.orgId,
        workspaceId: agent.workspaceId,
        version: (versions[0]?.version ?? 0) + 1,
        status: "published",
        baseModelId: agent.baseModelId,
        systemPrompt: agent.systemPrompt,
        parameters: agent.parameters,
        memoryPolicy: agent.memoryPolicy,
        promptSuggestions: agent.promptSuggestions ?? [],
        safetySettings: agent.safetySettings,
        tags: agent.tags ?? [],
        knowledgeBaseBindings: bindingSnapshot.knowledgeBaseBindings,
        toolBindings: bindingSnapshot.toolBindings,
        createdBy,
        createdAt: publishedAt,
        publishedAt,
      };
      if (agent.voiceProfileId !== undefined)
        version.voiceProfileId = agent.voiceProfileId;

      const created = await repository.createAgentVersion(version);
      await repository.updateAgent({
        ...agent,
        publishedVersionId: created.id,
        updatedAt: publishedAt,
      });
      await this.audit(
        subject,
        "agent.version.publish",
        "agent_version",
        created.id,
        {
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          baseModelId: created.baseModelId,
          version: created.version,
        },
        repository,
      );
      return created;
    });
    const [versionWithSummary] = await attachAgentEvalSummaries(
      this.repository,
      agent.id,
      [published],
    );
    return versionWithSummary ?? published;
  }

  async rollback(input: {
    subject: AuthSubject;
    agentId: string;
    versionId: string;
  }): Promise<Agent> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: agent.workspaceId,
    });
    const version = await getAgentVersionForAgent(
      this.repository,
      input.agentId,
      input.versionId,
    );
    await assertUsableAgentModel(
      this.repository,
      input.subject,
      version.baseModelId,
    );
    const { voiceProfileId: _voiceProfileId, ...agentDraft } = agent;

    const rolledBack = await this.repository.updateAgent({
      ...agentDraft,
      baseModelId: version.baseModelId,
      systemPrompt: version.systemPrompt,
      parameters: version.parameters,
      memoryPolicy: version.memoryPolicy,
      promptSuggestions: version.promptSuggestions ?? [],
      safetySettings: version.safetySettings,
      tags: version.tags ?? [],
      ...(version.voiceProfileId !== undefined
        ? { voiceProfileId: version.voiceProfileId }
        : {}),
      publishedVersionId: version.id,
      updatedAt: new Date().toISOString(),
    });
    if (
      version.knowledgeBaseBindings !== undefined &&
      version.toolBindings !== undefined
    ) {
      await applyAgentBindingSnapshot(this.repository, rolledBack, {
        knowledgeBaseBindings: version.knowledgeBaseBindings,
        toolBindings: version.toolBindings,
      });
    }
    await this.audit(
      input.subject,
      "agent.version.rollback",
      "agent",
      rolledBack.id,
      {
        workspaceId: rolledBack.workspaceId,
        versionId: version.id,
        baseModelId: version.baseModelId,
      },
    );
    return rolledBack;
  }

  async diff(input: {
    subject: AuthSubject;
    agentId: string;
    leftVersionId: string;
    rightVersionId: string;
  }): Promise<AgentVersionDiff> {
    await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:read",
    });
    const [left, right] = await Promise.all([
      getAgentVersionForAgent(
        this.repository,
        input.agentId,
        input.leftVersionId,
      ),
      getAgentVersionForAgent(
        this.repository,
        input.agentId,
        input.rightVersionId,
      ),
    ]);

    return diffAgentVersions(left, right);
  }

  private audit(
    subject: AuthSubject,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    return writeAuditLog(repository, {
      subject,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }
}

function normalizeAgentTags(tags: string[] | undefined): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 60)),
    ),
  ].slice(0, 20);
}

function normalizePromptSuggestions(
  suggestions: AgentPromptSuggestion[] | undefined,
): AgentPromptSuggestion[] {
  return (suggestions ?? [])
    .map((suggestion) => ({
      title: suggestion.title.trim().slice(0, 120),
      prompt: suggestion.prompt.trim().slice(0, 2_000),
    }))
    .filter((suggestion) => suggestion.title && suggestion.prompt)
    .slice(0, 12);
}
