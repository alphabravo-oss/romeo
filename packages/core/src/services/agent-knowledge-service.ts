import { AuthorizationError, type AuthSubject } from "@romeo/auth";

import type { AgentKnowledgeBinding, KnowledgeBase } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";

export interface AgentKnowledgeBindingSummary extends AgentKnowledgeBinding {
  knowledgeBase: KnowledgeBase;
}

export class AgentKnowledgeService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(
    agentId: string,
    subject: AuthSubject,
  ): Promise<AgentKnowledgeBindingSummary[]> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const bindings = await this.repository.listAgentKnowledgeBindings(agent.id);
    const summaries = await Promise.all(
      bindings.map((binding) => this.toSummary(binding)),
    );
    return summaries.filter(
      (summary): summary is AgentKnowledgeBindingSummary =>
        summary !== undefined,
    );
  }

  async update(input: {
    agentId: string;
    enabled: boolean;
    knowledgeBaseId: string;
    subject: AuthSubject;
  }): Promise<AgentKnowledgeBindingSummary> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:read",
      permission: "use",
    });
    if (knowledgeBase.workspaceId !== agent.workspaceId) {
      throw new AuthorizationError(
        "The knowledge base is outside the agent workspace.",
      );
    }

    const binding = await this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const existing = (
        await repository.listAgentKnowledgeBindings(agent.id)
      ).find((item) => item.knowledgeBaseId === knowledgeBase.id);
      const saved = await repository.upsertAgentKnowledgeBinding({
        id: existing?.id ?? createId("agent_kb_binding"),
        orgId: agent.orgId,
        agentId: agent.id,
        knowledgeBaseId: knowledgeBase.id,
        enabled: input.enabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "agent.knowledge_binding.update",
        resourceType: "agent",
        resourceId: agent.id,
        metadata: {
          knowledgeBaseId: knowledgeBase.id,
          enabled: saved.enabled,
          created: existing === undefined,
        },
      });
      return saved;
    });
    return { ...binding, knowledgeBase };
  }

  private async toSummary(
    binding: AgentKnowledgeBinding,
  ): Promise<AgentKnowledgeBindingSummary | undefined> {
    const knowledgeBase = await this.repository.getKnowledgeBase(
      binding.knowledgeBaseId,
    );
    if (!knowledgeBase) return undefined;
    return { ...binding, knowledgeBase };
  }
}
