import {
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
  type Scope,
} from "@romeo/auth";
import { listBuiltInTools } from "@romeo/tools";

import type { Agent, AgentVersion } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { AgentReadinessCheck, AgentReadinessKey } from "./agent-readiness";

export async function buildAgentDependencyReadinessChecks(
  repository: RomeoRepository,
  subject: AuthSubject,
  grants: ResourceGrant[],
  agent: Agent,
  version: AgentVersion | undefined,
): Promise<AgentReadinessCheck[]> {
  if (version === undefined) {
    return [
      blocked(
        "base_model",
        "model_not_evaluated",
        "Base model readiness cannot be evaluated without a published version.",
        ["Publish the assistant first."],
      ),
      blocked(
        "provider",
        "provider_not_evaluated",
        "Provider readiness cannot be evaluated without a published version.",
        ["Publish the assistant first."],
      ),
      warning(
        "knowledge",
        "knowledge_not_evaluated",
        "Knowledge access has not been evaluated.",
        ["Publish the assistant to snapshot knowledge bindings."],
      ),
      warning(
        "tools",
        "tools_not_evaluated",
        "Tool access has not been evaluated.",
        ["Publish the assistant to snapshot tool bindings."],
      ),
      warning(
        "voice",
        "voice_not_evaluated",
        "Voice access has not been evaluated.",
        ["Publish the assistant to snapshot its voice."],
      ),
    ];
  }

  const model = await repository.getModel(version.baseModelId);
  const provider =
    model === undefined
      ? undefined
      : await repository.getProvider(model.providerId);
  const modelIssues = missingScopes(subject, ["models:use"]);
  if (model === undefined)
    modelIssues.push("The published base model is missing.");
  else {
    if (!model.enabled)
      modelIssues.push("The published base model is disabled.");
    if (model.available === false)
      modelIssues.push("The published base model is unavailable.");
    if (!hasGrant(subject, grants, "model", model.id, "use"))
      modelIssues.push("Missing use permission for the published base model.");
  }
  const providerIssues: string[] = [];
  if (provider === undefined)
    providerIssues.push("The model provider is missing.");
  else {
    if (provider.orgId !== agent.orgId)
      providerIssues.push(
        "The model provider belongs to another organization.",
      );
    if (!provider.enabled)
      providerIssues.push("The model provider is disabled.");
    if (!hasGrant(subject, grants, "provider", provider.id, "use"))
      providerIssues.push("Missing use permission for the model provider.");
  }

  return [
    modelIssues.length === 0
      ? ready(
          "base_model",
          "base_model_ready",
          `Base model ${model!.displayName} is available.`,
          "model",
          model!.id,
        )
      : blocked(
          "base_model",
          "base_model_blocked",
          "The published base model is not runnable.",
          modelIssues,
          "model",
          version.baseModelId,
        ),
    providerIssues.length === 0
      ? ready(
          "provider",
          "provider_ready",
          `Provider ${provider!.name} is enabled and accessible.`,
          "provider",
          provider!.id,
        )
      : blocked(
          "provider",
          "provider_blocked",
          "The published model provider is not runnable.",
          providerIssues,
          "provider",
          provider?.id ?? model?.providerId,
        ),
    await knowledgeCheck(repository, subject, grants, version),
    await toolsCheck(repository, subject, grants, version),
    await voiceCheck(repository, subject, grants, version),
  ];
}

async function knowledgeCheck(
  repository: RomeoRepository,
  subject: AuthSubject,
  grants: ResourceGrant[],
  version: AgentVersion,
): Promise<AgentReadinessCheck> {
  const ids = (version.knowledgeBaseBindings ?? [])
    .filter((binding) => binding.enabled)
    .map((binding) => binding.knowledgeBaseId);
  if (ids.length === 0)
    return ready(
      "knowledge",
      "knowledge_not_required",
      "No knowledge bases are enabled in the published version.",
    );
  const issues = missingScopes(subject, ["knowledge:query"]);
  for (const id of ids) {
    const knowledgeBase = await repository.getKnowledgeBase(id);
    if (knowledgeBase === undefined) {
      issues.push(`Knowledge base ${id} is missing.`);
      continue;
    }
    if (knowledgeBase.orgId !== subject.orgId)
      issues.push(
        `Knowledge base ${knowledgeBase.name} is outside the organization.`,
      );
    if (!hasWorkspaceAccess(subject, knowledgeBase.workspaceId))
      issues.push(
        `Knowledge base ${knowledgeBase.name} is outside workspace access.`,
      );
    if (!hasGrant(subject, grants, "knowledge_base", id, "use"))
      issues.push(
        `Missing use permission for knowledge base ${knowledgeBase.name}.`,
      );
  }
  return issues.length === 0
    ? ready(
        "knowledge",
        "knowledge_ready",
        `${ids.length} published knowledge ${ids.length === 1 ? "base is" : "bases are"} accessible.`,
      )
    : blocked(
        "knowledge",
        "knowledge_blocked",
        "Published knowledge access is incomplete.",
        issues,
        "knowledge_base",
      );
}

async function toolsCheck(
  repository: RomeoRepository,
  subject: AuthSubject,
  grants: ResourceGrant[],
  version: AgentVersion,
): Promise<AgentReadinessCheck> {
  const ids = (version.toolBindings ?? [])
    .filter((binding) => binding.enabled)
    .map((binding) => binding.toolId);
  if (ids.length === 0)
    return ready(
      "tools",
      "tools_not_required",
      "No tools are enabled in the published version.",
    );

  const issues = missingScopes(subject, ["tools:use"]);
  const builtInIds = new Set(listBuiltInTools().map((tool) => tool.id));
  const connectors = await repository.listToolConnectors(subject.orgId);
  const operations = new Map<
    string,
    { connectorEnabled: boolean; operationEnabled: boolean }
  >();
  for (const connector of connectors) {
    for (const operation of await repository.listToolOperations(connector.id)) {
      operations.set(operation.id, {
        connectorEnabled: connector.enabled,
        operationEnabled: operation.enabled,
      });
    }
  }
  for (const id of ids) {
    if (builtInIds.has(id)) {
      if (!hasGrant(subject, grants, "tool", id, "use"))
        issues.push(`Missing use permission for tool ${id}.`);
      continue;
    }
    const operation = operations.get(id);
    if (operation === undefined) {
      issues.push(`Tool ${id} is missing.`);
      continue;
    }
    if (!operation.connectorEnabled)
      issues.push(`The connector for tool ${id} is disabled.`);
    if (!operation.operationEnabled) issues.push(`Tool ${id} is disabled.`);
  }
  return issues.length === 0
    ? ready(
        "tools",
        "tools_ready",
        `${ids.length} published ${ids.length === 1 ? "tool is" : "tools are"} accessible.`,
      )
    : blocked(
        "tools",
        "tools_blocked",
        "Published tool access is incomplete.",
        issues,
        "tool",
      );
}

async function voiceCheck(
  repository: RomeoRepository,
  subject: AuthSubject,
  grants: ResourceGrant[],
  version: AgentVersion,
): Promise<AgentReadinessCheck> {
  if (version.voiceProfileId === undefined)
    return ready(
      "voice",
      "voice_not_required",
      "No default voice is configured in the published version.",
    );
  const voice = await repository.getVoiceProfile(version.voiceProfileId);
  const issues = missingScopes(subject, ["voices:use"]);
  if (voice === undefined)
    issues.push("The published voice profile is missing.");
  else {
    if (!voice.enabled) issues.push("The published voice profile is disabled.");
    if (voice.orgId !== subject.orgId)
      issues.push("The published voice profile is outside the organization.");
    if (!hasGrant(subject, grants, "voice_profile", voice.id, "use"))
      issues.push("Missing use permission for the published voice profile.");
  }
  return issues.length === 0
    ? ready(
        "voice",
        "voice_ready",
        `Voice ${voice!.name} is enabled and accessible.`,
        "voice_profile",
        voice!.id,
      )
    : blocked(
        "voice",
        "voice_blocked",
        "The published voice is not usable.",
        issues,
        "voice_profile",
        version.voiceProfileId,
      );
}

function missingScopes(subject: AuthSubject, scopes: Scope[]): string[] {
  return scopes
    .filter((scope) => !subject.scopes.includes(scope))
    .map((scope) => `Missing required scope ${scope}.`);
}

function ready(
  key: AgentReadinessKey,
  code: string,
  message: string,
  resourceType?: AgentReadinessCheck["resourceType"],
  resourceId?: string,
): AgentReadinessCheck {
  return {
    key,
    status: "ready",
    code,
    message,
    issues: [],
    ...(resourceType === undefined ? {} : { resourceType }),
    ...(resourceId === undefined ? {} : { resourceId }),
  };
}

function warning(
  key: AgentReadinessKey,
  code: string,
  message: string,
  issues: string[],
): AgentReadinessCheck {
  return { key, status: "warning", code, message, issues };
}

function blocked(
  key: AgentReadinessKey,
  code: string,
  message: string,
  issues: string[],
  resourceType?: AgentReadinessCheck["resourceType"],
  resourceId?: string,
): AgentReadinessCheck {
  return {
    key,
    status: "blocked",
    code,
    message,
    issues,
    ...(resourceType === undefined ? {} : { resourceType }),
    ...(resourceId === undefined ? {} : { resourceId }),
  };
}
