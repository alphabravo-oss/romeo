import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  type AuthSubject,
} from "@romeo/auth";

import type {
  Agent,
  AgentParameters,
  AgentSafetySettings,
  AgentVersion,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import type { AgentExportDocument } from "./agent-portability";
import { buildVersionEvalSummary } from "./agent-version-eval";

export async function assertUsableAgentModel(
  repository: RomeoRepository,
  subject: AuthSubject,
  modelId: string,
): Promise<void> {
  assertScope(subject, "models:use");
  const model = await repository.getModel(modelId);
  if (!model) throw notFound("Model");

  const provider = await repository.getProvider(model.providerId);
  if (!provider) throw notFound("Provider");
  if (!canAccessOrg(subject, provider.orgId)) {
    throw new AuthorizationError(
      "The model provider is outside the caller organization.",
    );
  }

  const grants = await repository.listResourceGrants(subject.orgId);
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

export async function assertAgentEvalGate(
  repository: RomeoRepository,
  agentId: string,
): Promise<void> {
  const suites = await repository.listEvalSuites(agentId);
  if (suites.length === 0) return;

  const runs = await repository.listEvalRuns(agentId);
  const failingSuites = suites.filter(
    (suite) =>
      runs.find((run) => run.suiteId === suite.id)?.status !== "passed",
  );
  if (failingSuites.length > 0) {
    throw new ApiError(
      "eval_gate_failed",
      "Agent cannot be published until eval suites pass.",
      409,
      { suiteIds: failingSuites.map((suite) => suite.id) },
    );
  }
}

export async function getAgentVersionForAgent(
  repository: RomeoRepository,
  agentId: string,
  versionId: string,
): Promise<AgentVersion> {
  const version = await repository.getAgentVersion(versionId);
  if (!version || version.agentId !== agentId) {
    throw notFound("Agent version");
  }
  return version;
}

export async function attachAgentEvalSummaries(
  repository: RomeoRepository,
  agentId: string,
  versions: AgentVersion[],
): Promise<AgentVersion[]> {
  if (versions.length === 0) return [];
  const [suites, runs] = await Promise.all([
    repository.listEvalSuites(agentId),
    repository.listEvalRuns(agentId),
  ]);
  return versions.map((version) => ({
    ...version,
    evalSummary: buildVersionEvalSummary(version.publishedAt, suites, runs),
  }));
}

export function changedAgentFields(previous: Agent, next: Agent): string[] {
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

export function parameterKeys(parameters: AgentParameters): string[] {
  return Object.keys(parameters).sort();
}

export function bindingCounts(
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

export function hasSafetySettings(settings: AgentSafetySettings): boolean {
  return (
    settings.maxUserInputLength !== undefined ||
    (settings.blockedTerms?.length ?? 0) > 0 ||
    settings.promptInjectionGuard !== undefined
  );
}
