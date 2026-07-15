import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type {
  Agent,
  AgentMemoryPolicy,
  AgentParameters,
  AgentSafetySettings,
  AgentVersion,
  AgentVersionEvalSummary,
  EvalRun,
  EvalSuite,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
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
import { diffAgentVersions, type AgentVersionDiff } from "./agent-version-diff";
import { writeAuditLog } from "./audit-log";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export class AgentService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(workspaceId: string, subject: AuthSubject): Promise<Agent[]> {
    assertScope(subject, "agents:read");
    if (!hasWorkspaceAccess(subject, workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }

    const agents = (await this.repository.listAgents(workspaceId)).filter(
      (agent) => canAccessOrg(subject, agent.orgId),
    );
    if (subject.isAdmin === true) return agents;
    const grants = await this.repository.listResourceGrants(subject.orgId);
    return agents.filter((agent) =>
      hasGrant(subject, grants, "agent", agent.id, "read"),
    );
  }

  async get(agentId: string, subject: AuthSubject): Promise<Agent> {
    return getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
  }

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    name: string;
    baseModelId: string;
    systemPrompt: string;
    parameters?: AgentParameters;
    memoryPolicy?: AgentMemoryPolicy;
    safetySettings?: AgentSafetySettings;
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
    await this.assertUsableModel(input.subject, input.baseModelId);

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
      createdBy,
      baseModelId: input.baseModelId,
      systemPrompt: input.systemPrompt,
      parameters: input.parameters ?? {},
      memoryPolicy: normalizeAgentMemoryPolicy(input.memoryPolicy),
      safetySettings: normalizeAgentSafetySettings(input.safetySettings),
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

  async update(input: {
    subject: AuthSubject;
    agentId: string;
    name?: string;
    baseModelId?: string;
    systemPrompt?: string;
    parameters?: AgentParameters;
    memoryPolicy?: AgentMemoryPolicy;
    safetySettings?: AgentSafetySettings;
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
    await this.assertUsableModel(input.subject, baseModelId);

    const updated = await this.repository.updateAgent({
      ...agent,
      name: input.name ?? agent.name,
      baseModelId,
      systemPrompt: input.systemPrompt ?? agent.systemPrompt,
      parameters: input.parameters ?? agent.parameters,
      memoryPolicy:
        input.memoryPolicy === undefined
          ? agent.memoryPolicy
          : normalizeAgentMemoryPolicy(input.memoryPolicy),
      safetySettings:
        input.safetySettings === undefined
          ? agent.safetySettings
          : normalizeAgentSafetySettings(input.safetySettings),
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
    name?: string;
    systemPrompt?: string;
  }): Promise<Agent> {
    assertScope(input.subject, "agents:create");
    assertScope(input.subject, "agents:read");

    const source = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:read",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: source.workspaceId,
    });
    await this.assertUsableModel(input.subject, source.baseModelId);
    const { publishedVersionId: _publishedVersionId, ...draft } = source;

    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_agent_owner",
        name: "Service Account Agent Owner",
      },
    );
    const cloned = await this.repository.createAgent({
      ...draft,
      id: createId("agent"),
      name: input.name ?? `${source.name} copy`,
      createdBy,
      systemPrompt: input.systemPrompt ?? source.systemPrompt,
      updatedAt: new Date().toISOString(),
    });
    await this.audit(input.subject, "agent.clone", "agent", cloned.id, {
      workspaceId: cloned.workspaceId,
      sourceAgentId: source.id,
      baseModelId: cloned.baseModelId,
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
      baseModelId: input.agent.baseModelId,
      systemPrompt: input.agent.systemPrompt,
      parameters: input.agent.parameters,
      memoryPolicy: input.agent.memoryPolicy,
      safetySettings: input.agent.safetySettings,
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
    return this.attachEvalSummaries(agentId, versions);
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
    await this.assertUsableModel(subject, agent.baseModelId);
    await this.assertEvalGate(agent.id);

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
        safetySettings: agent.safetySettings,
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
    const [versionWithSummary] = await this.attachEvalSummaries(agent.id, [
      published,
    ]);
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
    const version = await this.getVersionForAgent(
      input.agentId,
      input.versionId,
    );
    await this.assertUsableModel(input.subject, version.baseModelId);
    const { voiceProfileId: _voiceProfileId, ...agentDraft } = agent;

    const rolledBack = await this.repository.updateAgent({
      ...agentDraft,
      baseModelId: version.baseModelId,
      systemPrompt: version.systemPrompt,
      parameters: version.parameters,
      memoryPolicy: version.memoryPolicy,
      safetySettings: version.safetySettings,
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
      this.getVersionForAgent(input.agentId, input.leftVersionId),
      this.getVersionForAgent(input.agentId, input.rightVersionId),
    ]);

    return diffAgentVersions(left, right);
  }

  private async getVersionForAgent(
    agentId: string,
    versionId: string,
  ): Promise<AgentVersion> {
    const version = await this.repository.getAgentVersion(versionId);
    if (!version || version.agentId !== agentId)
      throw notFound("Agent version");
    return version;
  }

  private async assertUsableModel(
    subject: AuthSubject,
    modelId: string,
  ): Promise<void> {
    assertScope(subject, "models:use");
    const model = await this.repository.getModel(modelId);
    if (!model) throw notFound("Model");

    const provider = await this.repository.getProvider(model.providerId);
    if (!provider) throw notFound("Provider");

    if (!canAccessOrg(subject, provider.orgId)) {
      throw new AuthorizationError(
        "The model provider is outside the caller organization.",
      );
    }

    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "model", model.id, "use")) {
      throw new AuthorizationError(
        `Missing use permission for model:${model.id}`,
      );
    }
    if (!hasGrant(subject, grants, "provider", provider.id, "use")) {
      throw new AuthorizationError(
        `Missing use permission for provider:${provider.id}`,
      );
    }
  }

  private async assertEvalGate(agentId: string): Promise<void> {
    const suites = await this.repository.listEvalSuites(agentId);
    if (suites.length === 0) return;

    const runs = await this.repository.listEvalRuns(agentId);
    const failingSuites = suites.filter(
      (suite) =>
        runs.find((run) => run.suiteId === suite.id)?.status !== "passed",
    );
    if (failingSuites.length > 0) {
      throw new ApiError(
        "eval_gate_failed",
        "Agent cannot be published until eval suites pass.",
        409,
        {
          suiteIds: failingSuites.map((suite) => suite.id),
        },
      );
    }
  }

  private async attachEvalSummaries(
    agentId: string,
    versions: AgentVersion[],
  ): Promise<AgentVersion[]> {
    if (versions.length === 0) return [];
    const [suites, runs] = await Promise.all([
      this.repository.listEvalSuites(agentId),
      this.repository.listEvalRuns(agentId),
    ]);
    return versions.map((version) => ({
      ...version,
      evalSummary: buildVersionEvalSummary(version.publishedAt, suites, runs),
    }));
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

function changedAgentFields(previous: Agent, next: Agent): string[] {
  return (
    [
      "name",
      "baseModelId",
      "systemPrompt",
      "parameters",
      "memoryPolicy",
      "safetySettings",
    ] as const
  ).filter(
    (field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]),
  );
}

function parameterKeys(parameters: AgentParameters): string[] {
  return Object.keys(parameters).sort();
}

function bindingCounts(
  agent: AgentExportDocument["agent"],
): Record<string, number | boolean | string> {
  return {
    accessGrants: agent.accessGrants?.length ?? 0,
    knowledgeBaseBindings: agent.knowledgeBaseBindings?.length ?? 0,
    memoryMode: agent.memoryPolicy.mode,
    toolBindings: agent.toolBindings?.length ?? 0,
    safetyConfigured: hasSafetySettings(agent.safetySettings ?? {}),
    voiceBound: agent.voiceProfileId !== undefined,
  };
}

function hasSafetySettings(settings: AgentSafetySettings): boolean {
  return (
    settings.maxUserInputLength !== undefined ||
    (settings.blockedTerms?.length ?? 0) > 0 ||
    settings.promptInjectionGuard !== undefined
  );
}

function buildVersionEvalSummary(
  publishedAt: string,
  suites: EvalSuite[],
  runs: EvalRun[],
): AgentVersionEvalSummary {
  if (suites.length === 0) {
    return {
      status: "not_required",
      suiteCount: 0,
      passedSuiteCount: 0,
      failedSuiteCount: 0,
      missingSuiteCount: 0,
      averageScore: null,
      evaluatedAt: null,
      suites: [],
    };
  }

  const suiteSummaries: AgentVersionEvalSummary["suites"] = suites.map(
    (suite) => {
      const latestRun = latestRunForSuiteAtOrBefore(
        suite.id,
        runs,
        publishedAt,
      );
      return {
        suiteId: suite.id,
        runId: latestRun?.id ?? null,
        status: latestRun?.status ?? "missing",
        score: latestRun?.score ?? null,
        completedAt: latestRun?.completedAt ?? null,
      };
    },
  );
  const completedSummaries = suiteSummaries.filter(
    (suite) => suite.score !== null,
  );
  const passedSuiteCount = suiteSummaries.filter(
    (suite) => suite.status === "passed",
  ).length;
  const failedSuiteCount = suiteSummaries.filter(
    (suite) => suite.status === "failed",
  ).length;
  const missingSuiteCount = suiteSummaries.filter(
    (suite) => suite.status === "missing",
  ).length;
  const evaluatedAt = suiteSummaries
    .map((suite) => suite.completedAt)
    .filter((completedAt): completedAt is string => completedAt !== null)
    .sort()
    .at(-1);

  return {
    status:
      missingSuiteCount > 0
        ? "missing"
        : failedSuiteCount > 0
          ? "failed"
          : "passed",
    suiteCount: suites.length,
    passedSuiteCount,
    failedSuiteCount,
    missingSuiteCount,
    averageScore:
      completedSummaries.length === 0
        ? null
        : completedSummaries.reduce(
            (total, suite) => total + (suite.score ?? 0),
            0,
          ) / completedSummaries.length,
    evaluatedAt: evaluatedAt ?? null,
    suites: suiteSummaries,
  };
}

function latestRunForSuiteAtOrBefore(
  suiteId: string,
  runs: EvalRun[],
  publishedAt: string,
): EvalRun | undefined {
  return runs
    .filter((run) => run.suiteId === suiteId && run.completedAt <= publishedAt)
    .sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt),
    )[0];
}
