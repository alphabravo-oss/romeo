import { assertScope, type AuthSubject } from "@romeo/auth";

import type { Agent } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { createAgentOwnerGrants, getAuthorizedAgent } from "./agent-access";
import {
  applyAgentBindingSnapshot,
  snapshotAgentBindings,
} from "./agent-portability";
import { assertUsableAgentModel } from "./agent-service-support";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import {
  getManagedModelCustomizationPolicy,
  setManagedModelCustomizationPolicy,
} from "./managed-model-customization";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export async function cloneManagedModel(
  repository: RomeoRepository,
  input: {
    agentId: string;
    includeKnowledgeBindings?: boolean;
    name?: string;
    subject: AuthSubject;
    systemPrompt?: string;
  },
): Promise<{
  cloned: Agent;
  knowledgeBindingsCopied: number;
  sourceAgentId: string;
}> {
  assertScope(input.subject, "agents:create");
  assertScope(input.subject, "agents:read");

  const source = await getAuthorizedAgent(repository, {
    agentId: input.agentId,
    subject: input.subject,
    scope: "agents:read",
  });
  await assertWorkspaceActive(repository, {
    orgId: input.subject.orgId,
    workspaceId: source.workspaceId,
  });
  await assertUsableAgentModel(repository, input.subject, source.baseModelId);

  const knowledgeBaseBindings = input.includeKnowledgeBindings
    ? (await snapshotAgentBindings(repository, source.id)).knowledgeBaseBindings
    : [];
  await Promise.all(
    knowledgeBaseBindings.map((binding) =>
      getAuthorizedKnowledgeBase(repository, {
        knowledgeBaseId: binding.knowledgeBaseId,
        subject: input.subject,
        scope: "knowledge:read",
        permission: "use",
      }),
    ),
  );

  const { publishedVersionId: _publishedVersionId, ...draft } = source;
  const createdBy = await persistedSubjectActorId(repository, input.subject, {
    kind: "service_account_agent_owner",
    name: "Service Account Agent Owner",
  });
  const cloned = await repository.createAgent({
    ...draft,
    id: createId("agent"),
    name: input.name ?? `${source.name} copy`,
    createdBy,
    systemPrompt: input.systemPrompt ?? source.systemPrompt,
    updatedAt: new Date().toISOString(),
  });
  await createAgentOwnerGrants(repository, input.subject, cloned.id);

  const customizationPolicy = await getManagedModelCustomizationPolicy(
    repository,
    source.orgId,
    source.id,
  );
  await setManagedModelCustomizationPolicy(
    repository,
    cloned.orgId,
    cloned.id,
    customizationPolicy,
  );
  await applyAgentBindingSnapshot(repository, cloned, {
    knowledgeBaseBindings,
    toolBindings: [],
  });

  return {
    cloned,
    knowledgeBindingsCopied: knowledgeBaseBindings.length,
    sourceAgentId: source.id,
  };
}
