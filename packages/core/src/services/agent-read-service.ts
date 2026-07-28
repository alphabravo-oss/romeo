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
import { AgentCustomizationService } from "./agent-customization-service";

export class AgentReadService extends AgentCustomizationService {
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
}
