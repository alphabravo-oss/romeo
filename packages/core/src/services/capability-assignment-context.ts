import { hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";

import type { CapabilityScopeRef } from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import type {
  ResolutionDetails,
  ResolveCapabilityInput,
} from "./capability-resolution-model";

export async function assignmentSubjectForAdminScope(
  repository: RomeoRepository,
  subject: AuthSubject,
  scope: CapabilityScopeRef,
): Promise<{ userId?: string; groupIds: string[] }> {
  if (scope.scopeType === "group") return { groupIds: [scope.scopeId] };
  if (scope.scopeType !== "user") return { groupIds: [] };
  const memberships = await repository.listGroupMemberships(
    subject.orgId,
    undefined,
    scope.scopeId,
  );
  return {
    userId: scope.scopeId,
    groupIds: memberships.map((membership) => membership.groupId).sort(),
  };
}

export async function resolveAgentCapabilityContext(
  repository: RomeoRepository,
  input: ResolveCapabilityInput,
  workspaceId?: string,
  at = new Date().toISOString(),
): Promise<{
  agentId?: string;
  capabilityDefault?: NonNullable<ResolutionDetails["agentVersionDefault"]>;
}> {
  let version =
    input.agentVersionId === undefined
      ? undefined
      : await repository.getAgentVersion(input.agentVersionId);
  if (input.agentVersionId !== undefined && version === undefined)
    throw notFound("Agent version");
  const agentId = input.agentId ?? version?.agentId;
  if (agentId === undefined) return {};
  const agent = await repository.getAgent(agentId);
  if (
    agent === undefined ||
    agent.orgId !== input.subject.orgId ||
    !hasWorkspaceAccess(input.subject, agent.workspaceId) ||
    (workspaceId !== undefined && agent.workspaceId !== workspaceId)
  )
    throw notFound("Agent");
  if (version === undefined && agent.publishedVersionId !== undefined)
    version = await repository.getAgentVersion(agent.publishedVersionId);
  if (
    version !== undefined &&
    (version.agentId !== agent.id ||
      version.orgId !== input.subject.orgId ||
      version.workspaceId !== agent.workspaceId)
  )
    throw notFound("Agent version");
  const capabilityDefault = version?.capabilityDefaults?.find(
    (item) =>
      item.capabilityId === input.capabilityId &&
      (item.expiresAt === undefined ||
        Date.parse(item.expiresAt) > Date.parse(at)),
  );
  return {
    agentId,
    ...(version === undefined || capabilityDefault === undefined
      ? {}
      : {
          capabilityDefault: {
            agentVersionId: version.id,
            state: capabilityDefault.state,
            configuration: structuredClone(capabilityDefault.configuration),
            assignmentVersion: capabilityDefault.assignmentVersion,
            ...(capabilityDefault.expiresAt === undefined
              ? {}
              : { expiresAt: capabilityDefault.expiresAt }),
          },
        }),
  };
}
