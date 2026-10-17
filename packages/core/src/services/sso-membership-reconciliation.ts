import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";

export type SsoProviderKind = "ldap" | "oauth2" | "oidc" | "saml";

/**
 * Identifies the identity-provider mapping that granted a membership. Rows
 * carrying this source are owned by that mapping: each login re-asserts them
 * and revokes the ones the provider no longer asserts. Rows without a source
 * (manual, SCIM, directory sync, or created before migration 0047) are never
 * touched by SSO reconciliation.
 */
export interface SsoMembershipSource {
  kind: SsoProviderKind;
  providerKey: string;
}

export function ssoMembershipSource(input: SsoMembershipSource): string {
  return `sso:${input.kind}:${input.providerKey}`;
}

interface SyncInput {
  orgId: string;
  /**
   * Revoke memberships previously granted by this source that are no longer
   * asserted. Interactive logins reconcile; bearer-token authentication only
   * adds, because access tokens may omit group claims.
   */
  revokeUnasserted?: boolean;
  source: SsoMembershipSource;
  userId: string;
}

export async function syncExternalGroupMemberships(
  repository: RomeoRepository,
  input: SyncInput & { groupIds: string[] },
): Promise<void> {
  const source = ssoMembershipSource(input.source);
  const asserted = new Set(input.groupIds);
  const [groups, memberships, sourced] = await Promise.all([
    asserted.size === 0 ? [] : repository.listGroups(input.orgId),
    asserted.size === 0
      ? []
      : repository.listGroupMemberships(input.orgId, undefined, input.userId),
    input.revokeUnasserted === false
      ? []
      : repository.listGroupMembershipsBySource(
          input.orgId,
          input.userId,
          source,
        ),
  ]);
  const existingGroupIds = new Set(groups.map((group) => group.id));
  const existingMemberships = new Set(
    memberships.map((membership) => membership.groupId),
  );
  const now = new Date().toISOString();
  for (const groupId of asserted) {
    if (!existingGroupIds.has(groupId) || existingMemberships.has(groupId)) {
      continue;
    }
    await repository.createGroupMembership(
      { groupId, userId: input.userId, orgId: input.orgId, createdAt: now },
      { source },
    );
  }
  for (const membership of sourced) {
    if (asserted.has(membership.groupId)) continue;
    const removed = await repository.deleteGroupMembership(
      membership.groupId,
      membership.userId,
    );
    if (removed === undefined) continue;
    await auditRevocation(repository, input, {
      membershipType: "group",
      resourceId: membership.groupId,
      resourceType: "group",
    });
  }
}

export async function syncMappedWorkspaceMemberships(
  repository: RomeoRepository,
  input: SyncInput & { workspaceIds: string[] },
): Promise<void> {
  const source = ssoMembershipSource(input.source);
  const asserted = new Set(input.workspaceIds);
  const [workspaces, grants, sourced] = await Promise.all([
    asserted.size === 0 ? [] : repository.listWorkspaces(input.orgId),
    asserted.size === 0 ? [] : repository.listResourceGrants(input.orgId),
    input.revokeUnasserted === false
      ? []
      : repository.listResourceGrantsBySource(
          input.orgId,
          input.userId,
          source,
        ),
  ]);
  const knownWorkspaceIds = new Set(
    workspaces.map((workspace) => workspace.id),
  );
  for (const workspaceId of asserted) {
    if (!knownWorkspaceIds.has(workspaceId)) continue;
    const exists = grants.some(
      (grant) =>
        grant.resourceType === "workspace" &&
        grant.resourceId === workspaceId &&
        grant.principalType === "user" &&
        grant.principalId === input.userId &&
        grant.permission === "read",
    );
    if (exists) continue;
    await repository.createResourceGrant(
      {
        id: createId("grant"),
        resourceType: "workspace",
        resourceId: workspaceId,
        principalType: "user",
        principalId: input.userId,
        permission: "read",
      },
      { source },
    );
  }
  for (const grant of sourced) {
    if (
      grant.resourceType !== "workspace" ||
      grant.principalType !== "user" ||
      asserted.has(grant.resourceId)
    )
      continue;
    const removed = await repository.deleteResourceGrant(grant.id);
    if (removed === undefined) continue;
    await auditRevocation(repository, input, {
      membershipType: "workspace",
      resourceId: grant.resourceId,
      resourceType: "workspace",
    });
  }
}

async function auditRevocation(
  repository: RomeoRepository,
  input: SyncInput,
  revoked: {
    membershipType: "group" | "workspace";
    resourceId: string;
    resourceType: "group" | "workspace";
  },
): Promise<void> {
  await writeAuditLog(repository, {
    id: createId("audit"),
    orgId: input.orgId,
    actorId: input.userId,
    action: "auth.sso.member.revoke",
    resourceType: revoked.resourceType,
    resourceId: revoked.resourceId,
    outcome: "success",
    metadata: {
      membershipType: revoked.membershipType,
      providerKind: input.source.kind,
      userId: input.userId,
    },
    createdAt: new Date().toISOString(),
  });
}
