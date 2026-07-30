import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type { Agent } from "../domain/entities";
import { getAuthorizedAgent } from "./agent-access";
import {
  buildAgentReadinessReport,
  type AgentReadinessReport,
} from "./agent-readiness";
import { AgentCustomizationService } from "./agent-customization-service";

export class AgentReadService extends AgentCustomizationService {
  async readiness(input: {
    agentId: string;
    subject: AuthSubject;
    principalType?: "group" | "service_account" | "user";
    principalId?: string;
  }): Promise<AgentReadinessReport> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:read",
    });
    return buildAgentReadinessReport(this.repository, {
      agent,
      caller: input.subject,
      ...(input.principalType === undefined
        ? {}
        : { principalType: input.principalType }),
      ...(input.principalId === undefined
        ? {}
        : { principalId: input.principalId }),
    });
  }

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
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const visibleAgents =
      subject.isAdmin === true
        ? agents
        : agents.filter((agent) =>
            hasGrant(subject, grants, "agent", agent.id, "read"),
          );
    return visibleAgents.map((agent) => ({
      ...agent,
      grantCount: grants.filter(
        (grant) =>
          grant.resourceType === "agent" && grant.resourceId === agent.id,
      ).length,
    }));
  }

  async get(agentId: string, subject: AuthSubject): Promise<Agent> {
    return getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
  }
}
