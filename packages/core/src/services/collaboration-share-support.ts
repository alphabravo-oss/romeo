import {
  AuthorizationError,
  assertScope,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { FileObject } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import { getAuthorizedAgent } from "./agent-access";
import {
  groupLabel,
  principalOrder,
  type ShareInput,
  type ShareTarget,
  targetMatches,
  validateSharePrincipal,
} from "./collaboration-share-model";
import { filterVisibleServiceAccounts } from "./service-account-access";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";

export async function findShareTargets(
  repository: RomeoRepository,
  subject: AuthSubject,
  query: string,
  limit: number,
): Promise<ShareTarget[]> {
  assertScope(subject, "me:read");
  const normalizedQuery = query.trim().toLowerCase();
  const boundedLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
  const [users, grants, serviceAccounts, groups] = await Promise.all([
    repository.listUsers(subject.orgId),
    repository.listResourceGrants(subject.orgId),
    repository.listServiceAccounts(subject.orgId),
    repository.listGroups(subject.orgId),
  ]);
  const groupIds = new Set<string>(subject.groupIds);
  for (const grant of grants) {
    if (grant.principalType === "group") groupIds.add(grant.principalId);
  }
  const durableGroupIds = new Set(groups.map((group) => group.id));
  const targets: ShareTarget[] = [
    ...users.map((user) => ({
      principalType: "user" as const,
      principalId: user.id,
      label: user.name,
      detail: user.email,
    })),
    ...groups.map((group) => ({
      principalType: "group" as const,
      principalId: group.id,
      label: group.name,
    })),
    ...[...groupIds]
      .filter((groupId) => !durableGroupIds.has(groupId))
      .sort()
      .map((groupId) => ({
        principalType: "group" as const,
        principalId: groupId,
        label: groupLabel(groupId),
      })),
    ...filterVisibleServiceAccounts(subject, serviceAccounts).map(
      (account) => ({
        principalType: "service_account" as const,
        principalId: account.id,
        label: account.name,
        ...(account.disabledAt === undefined ? {} : { detail: "disabled" }),
      }),
    ),
  ];

  return targets
    .filter((target) => targetMatches(target, normalizedQuery))
    .sort(
      (left, right) =>
        principalOrder(left.principalType) -
          principalOrder(right.principalType) ||
        left.label.localeCompare(right.label) ||
        left.principalId.localeCompare(right.principalId),
    )
    .slice(0, boundedLimit);
}

export async function createResourceShares(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  resourceType: ResourceGrant["resourceType"];
  resourceId: string;
  allowedPermissions: ResourceGrant["permission"][];
  share: ShareInput;
}): Promise<ResourceGrant[]> {
  validateSharePrincipal(input.share);
  const invalid = input.share.permissions.filter(
    (permission) => !input.allowedPermissions.includes(permission),
  );
  if (invalid.length > 0) {
    throw new ApiError(
      "invalid_share_permission",
      "Share includes an unsupported permission.",
      400,
      { permissions: invalid },
    );
  }
  const existing = await sharesForResource(
    input.repository,
    input.resourceType,
    input.resourceId,
    input.subject.orgId,
  );
  const created: ResourceGrant[] = [];
  for (const permission of new Set(input.share.permissions)) {
    const grant = existing.find(
      (item) =>
        item.principalType === input.share.principalType &&
        item.principalId === input.share.principalId &&
        item.permission === permission,
    );
    if (grant) {
      created.push(grant);
      continue;
    }
    created.push(
      await input.repository.createResourceGrant({
        id: createId("grant"),
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        principalType: input.share.principalType,
        principalId: input.share.principalId,
        permission,
      }),
    );
  }
  return created;
}

export async function sharesForResource(
  repository: RomeoRepository,
  resourceType: ResourceGrant["resourceType"],
  resourceId: string,
  orgId: string,
): Promise<ResourceGrant[]> {
  return (await repository.listResourceGrants(orgId)).filter(
    (grant) =>
      grant.resourceType === resourceType && grant.resourceId === resourceId,
  );
}

export async function deleteResourceShare(input: {
  repository: RomeoRepository;
  orgId: string;
  resourceType: ResourceGrant["resourceType"];
  resourceId: string;
  grantId: string;
  missingLabel: string;
}): Promise<ResourceGrant> {
  const grant = (
    await sharesForResource(
      input.repository,
      input.resourceType,
      input.resourceId,
      input.orgId,
    )
  ).find((item) => item.id === input.grantId);
  if (grant === undefined) throw notFound(input.missingLabel);
  const deleted = await input.repository.deleteResourceGrant(grant.id);
  if (deleted === undefined) throw notFound(input.missingLabel);
  return deleted;
}

export async function revokeKnowledgeBaseShare(
  repository: RomeoRepository,
  input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    grantId: string;
  },
): Promise<ResourceGrant> {
  const knowledgeBase = await getAuthorizedKnowledgeBase(repository, {
    knowledgeBaseId: input.knowledgeBaseId,
    subject: input.subject,
    scope: "knowledge:write",
    permission: "write",
  });
  const deleted = await deleteResourceShare({
    repository,
    orgId: input.subject.orgId,
    resourceType: "knowledge_base",
    resourceId: knowledgeBase.id,
    grantId: input.grantId,
    missingLabel: "Knowledge grant",
  });
  await auditShare(
    repository,
    input.subject,
    "knowledge_base.share.revoke",
    "knowledge_base",
    knowledgeBase.id,
    {
      principalType: deleted.principalType,
      principalId: deleted.principalId,
      permission: deleted.permission,
    },
  );
  return deleted;
}

export async function revokeAgentShare(
  repository: RomeoRepository,
  input: { subject: AuthSubject; agentId: string; grantId: string },
): Promise<ResourceGrant> {
  const agent = await getAuthorizedAgent(repository, {
    agentId: input.agentId,
    subject: input.subject,
    scope: "agents:write",
  });
  const deleted = await deleteResourceShare({
    repository,
    orgId: input.subject.orgId,
    resourceType: "agent",
    resourceId: agent.id,
    grantId: input.grantId,
    missingLabel: "Managed-model grant",
  });
  await auditShare(
    repository,
    input.subject,
    "agent.share.revoke",
    "agent",
    agent.id,
    {
      principalType: deleted.principalType,
      principalId: deleted.principalId,
      permission: deleted.permission,
    },
  );
  return deleted;
}

export async function requireOrgModel(
  repository: RomeoRepository,
  subject: AuthSubject,
  modelId: string,
  scope: "admin:read" | "admin:write",
) {
  assertScope(subject, scope);
  const model = await repository.getModel(modelId);
  if (model === undefined) throw notFound("Model");
  const provider = await repository.getProvider(model.providerId);
  if (provider === undefined || provider.orgId !== subject.orgId)
    throw notFound("Model");
  return model;
}

export async function requireOrgWorkspace(
  repository: RomeoRepository,
  subject: AuthSubject,
  workspaceId: string,
  scope: "admin:read" | "admin:write",
) {
  assertScope(subject, scope);
  const workspace = await repository.getWorkspace(workspaceId);
  if (workspace === undefined || workspace.orgId !== subject.orgId)
    throw notFound("Workspace");
  return workspace;
}

export async function getAuthorizedSharedFile(
  repository: RomeoRepository,
  subject: AuthSubject,
  fileId: string,
  permission: "read" | "write",
): Promise<FileObject> {
  assertScope(subject, permission === "read" ? "files:read" : "files:write");
  const file = await repository.getFileObject(fileId);
  if (
    file === undefined ||
    file.orgId !== subject.orgId ||
    file.status === "deleted"
  )
    throw notFound("File");
  if (!hasWorkspaceAccess(subject, file.workspaceId)) {
    throw new AuthorizationError(
      "The file workspace is outside the caller access.",
    );
  }
  const grants = await repository.listResourceGrants(subject.orgId);
  if (
    subject.isAdmin !== true &&
    !(file.ownerType === subject.type && file.ownerId === subject.id) &&
    !hasGrant(subject, grants, "file", file.id, permission)
  ) {
    throw new AuthorizationError(
      `Missing ${permission} permission for file:${file.id}`,
    );
  }
  return file;
}

export async function auditShare<A extends AuditAction>(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: A,
  resourceType: string,
  resourceId: string,
  metadata: AuditMetadata<A>,
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action,
    resourceType,
    resourceId,
    metadata,
  });
}
