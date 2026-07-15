import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { Agent } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";

export async function getAuthorizedAgent(
  repository: RomeoRepository,
  input: {
    agentId: string;
    subject: AuthSubject;
    scope: "agents:read" | "agents:write";
  },
): Promise<Agent> {
  assertScope(input.subject, input.scope);
  const agent = await repository.getAgent(input.agentId);
  if (!agent) throw notFound("Agent");

  if (!canAccessOrg(input.subject, agent.orgId)) {
    throw new AuthorizationError(
      "The agent is outside the caller organization.",
    );
  }

  if (!hasWorkspaceAccess(input.subject, agent.workspaceId)) {
    throw new AuthorizationError(
      "The agent is outside the caller workspace access.",
    );
  }

  const grants = await repository.listResourceGrants(input.subject.orgId);
  if (
    !hasGrant(
      input.subject,
      grants,
      "agent",
      agent.id,
      agentPermission(input.scope),
    )
  ) {
    throw new AuthorizationError(
      `Missing ${agentPermission(input.scope)} permission for agent:${agent.id}`,
    );
  }

  return agent;
}

export async function createAgentOwnerGrants(
  repository: RomeoRepository,
  subject: AuthSubject,
  agentId: string,
): Promise<void> {
  const permissions: ResourceGrant["permission"][] = ["read", "write", "run"];
  await Promise.all(
    permissions.map((permission) =>
      repository.createResourceGrant({
        id: createId("grant"),
        resourceType: "agent",
        resourceId: agentId,
        principalType: subject.type,
        principalId: subject.id,
        permission,
      }),
    ),
  );
}

function agentPermission(
  scope: "agents:read" | "agents:write",
): ResourceGrant["permission"] {
  return scope === "agents:write" ? "write" : "read";
}
