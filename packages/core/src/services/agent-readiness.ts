import {
  assertScope,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type PrincipalType,
  type ResourceGrant,
  type Scope,
} from "@romeo/auth";

import type { Agent } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { buildAgentDependencyReadinessChecks } from "./agent-readiness-dependencies";
import { createUserAuthSubject, localUserScopes } from "./auth-subject";

export type AgentReadinessKey =
  | "principal"
  | "workspace"
  | "assistant_access"
  | "published_version"
  | "base_model"
  | "provider"
  | "knowledge"
  | "tools"
  | "voice";

export interface AgentReadinessCheck {
  key: AgentReadinessKey;
  status: "ready" | "warning" | "blocked";
  code: string;
  message: string;
  issues: string[];
  resourceType?:
    | "agent"
    | "knowledge_base"
    | "model"
    | "provider"
    | "tool"
    | "voice_profile"
    | "workspace";
  resourceId?: string;
}

export interface AgentReadinessReport {
  agentId: string;
  status: "ready" | "blocked";
  generatedAt: string;
  principal: {
    principalType: PrincipalType;
    principalId: string;
    label: string;
    simulated: boolean;
  };
  checks: AgentReadinessCheck[];
  blockingCount: number;
}

interface ResolvedPrincipal {
  subject: AuthSubject;
  principalType: PrincipalType;
  label: string;
  active: boolean;
  simulated: boolean;
}

export async function buildAgentReadinessReport(
  repository: RomeoRepository,
  input: {
    agent: Agent;
    caller: AuthSubject;
    principalType?: PrincipalType;
    principalId?: string;
  },
): Promise<AgentReadinessReport> {
  const principal = await resolvePrincipal(repository, input);
  const { agent } = input;
  const grants = await repository.listResourceGrants(agent.orgId);
  const version =
    agent.publishedVersionId === undefined
      ? undefined
      : await repository.getAgentVersion(agent.publishedVersionId);
  const validVersion =
    version?.agentId === agent.id && version.orgId === agent.orgId
      ? version
      : undefined;

  const checks: AgentReadinessCheck[] = [
    principal.active
      ? ready("principal", "principal_active", `${principal.label} is active.`)
      : blocked(
          "principal",
          "principal_disabled",
          `${principal.label} is disabled.`,
          [
            "The selected principal must be enabled before it can run assistants.",
          ],
        ),
    hasWorkspaceAccess(principal.subject, agent.workspaceId)
      ? ready(
          "workspace",
          "workspace_access_ready",
          "The principal can access this workspace.",
          "workspace",
          agent.workspaceId,
        )
      : blocked(
          "workspace",
          "workspace_access_missing",
          "The principal cannot access this workspace.",
          ["Grant workspace access before sharing the assistant."],
          "workspace",
          agent.workspaceId,
        ),
    assistantAccessCheck(principal.subject, grants, agent),
    validVersion === undefined
      ? blocked(
          "published_version",
          agent.publishedVersionId === undefined
            ? "assistant_not_published"
            : "published_version_missing",
          "The assistant has no runnable published version.",
          [
            agent.publishedVersionId === undefined
              ? "Save and publish the assistant."
              : "Republish the assistant to replace its missing version snapshot.",
          ],
          "agent",
          agent.id,
        )
      : ready(
          "published_version",
          "published_version_ready",
          `Published version ${validVersion.version} is available.`,
          "agent",
          agent.id,
        ),
  ];

  checks.push(
    ...(await buildAgentDependencyReadinessChecks(
      repository,
      principal.subject,
      grants,
      agent,
      validVersion,
    )),
  );
  const blockingCount = checks.filter(
    (check) => check.status === "blocked",
  ).length;
  return {
    agentId: agent.id,
    status: blockingCount === 0 ? "ready" : "blocked",
    generatedAt: new Date().toISOString(),
    principal: {
      principalType: principal.principalType,
      principalId:
        input.principalId === undefined ? input.caller.id : input.principalId,
      label: principal.label,
      simulated: principal.simulated,
    },
    checks,
    blockingCount,
  };
}

async function resolvePrincipal(
  repository: RomeoRepository,
  input: {
    caller: AuthSubject;
    agent: Agent;
    principalType?: PrincipalType;
    principalId?: string;
  },
): Promise<ResolvedPrincipal> {
  if (input.principalType === undefined || input.principalId === undefined) {
    return {
      subject: input.caller,
      principalType: input.caller.type,
      label: input.caller.name ?? input.caller.email ?? input.caller.id,
      active: true,
      simulated: false,
    };
  }
  assertScope(input.caller, "admin:read");
  const principalId = input.principalId;
  if (input.principalType === "user") {
    const user = await repository.getCurrentUser(principalId);
    if (user === undefined || user.orgId !== input.caller.orgId)
      throw notFound("User");
    return {
      subject: await createUserAuthSubject(repository, user),
      principalType: "user",
      label: user.name,
      active: user.disabledAt === undefined,
      simulated: true,
    };
  }
  if (input.principalType === "service_account") {
    const account = await repository.getServiceAccount(principalId);
    if (account === undefined || account.orgId !== input.caller.orgId)
      throw notFound("Service account");
    const workspaces = await repository.listWorkspaces(account.orgId);
    return {
      subject: {
        id: account.id,
        type: "service_account",
        name: account.name,
        orgId: account.orgId,
        workspaceIds: workspaces.map((workspace) => workspace.id),
        groupIds: [],
        scopes: account.scopes,
        isAdmin: false,
      },
      principalType: "service_account",
      label: account.name,
      active: account.disabledAt === undefined,
      simulated: true,
    };
  }

  const [group, grants, workspaces] = await Promise.all([
    repository.getGroup(principalId),
    repository.listResourceGrants(input.caller.orgId),
    repository.listWorkspaces(input.caller.orgId),
  ]);
  const knownByGrant = grants.some(
    (grant) =>
      grant.principalType === "group" && grant.principalId === principalId,
  );
  if (
    (group === undefined || group.orgId !== input.caller.orgId) &&
    !knownByGrant
  )
    throw notFound("Group");
  return {
    subject: {
      id: `readiness_group_representative:${principalId}`,
      type: "user",
      name: group?.name ?? principalId,
      orgId: input.caller.orgId,
      workspaceIds: workspaces.map((workspace) => workspace.id),
      groupIds: [principalId],
      scopes: localUserScopes,
      isAdmin: false,
    },
    principalType: "group",
    label: group?.name ?? principalId,
    active: true,
    simulated: true,
  };
}

function assistantAccessCheck(
  subject: AuthSubject,
  grants: ResourceGrant[],
  agent: Agent,
): AgentReadinessCheck {
  const issues = missingScopes(subject, ["agents:run", "runs:create"]);
  if (!hasGrant(subject, grants, "agent", agent.id, "run"))
    issues.push("Missing run permission for this assistant.");
  return issues.length === 0
    ? ready(
        "assistant_access",
        "assistant_access_ready",
        "The principal can run this assistant.",
        "agent",
        agent.id,
      )
    : blocked(
        "assistant_access",
        "assistant_access_missing",
        "The principal cannot run this assistant.",
        issues,
        "agent",
        agent.id,
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
