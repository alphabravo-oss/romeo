import {
  hasGrant,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

export function workspaceIdsFromGrants(
  workspaces: readonly { id: string }[],
  grants: readonly ResourceGrant[],
  principal: {
    id: string;
    type: AuthSubject["type"];
    groupIds: string[];
    isAdmin?: boolean;
  },
): string[] {
  if (principal.isAdmin === true) {
    return workspaces.map((workspace) => workspace.id);
  }
  const subject = grantPrincipal(principal);
  return workspaces
    .filter((workspace) =>
      hasGrant(subject, grants, "workspace", workspace.id, "read"),
    )
    .map((workspace) => workspace.id);
}

export function canUseProviderModel(
  subject: AuthSubject,
  grants: readonly ResourceGrant[],
  model: { id: string; providerId: string },
): boolean {
  if (subject.isAdmin === true) return true;
  return (
    hasGrant(subject, grants, "model", model.id, "use") &&
    hasGrant(subject, grants, "provider", model.providerId, "use")
  );
}

export function canUseProvider(
  subject: AuthSubject,
  grants: readonly ResourceGrant[],
  providerId: string,
): boolean {
  if (subject.isAdmin === true) return true;
  return hasGrant(subject, grants, "provider", providerId, "use");
}

export function canSeeKnowledgeBase(
  subject: AuthSubject,
  grants: readonly ResourceGrant[],
  knowledgeBaseId: string,
): boolean {
  if (subject.isAdmin === true) return true;
  return (
    hasGrant(subject, grants, "knowledge_base", knowledgeBaseId, "read") ||
    hasGrant(subject, grants, "knowledge_base", knowledgeBaseId, "use") ||
    hasGrant(subject, grants, "knowledge_base", knowledgeBaseId, "write")
  );
}

function grantPrincipal(principal: {
  id: string;
  type: AuthSubject["type"];
  groupIds: string[];
  isAdmin?: boolean;
}): AuthSubject {
  return {
    id: principal.id,
    type: principal.type,
    orgId: "org_visibility",
    workspaceIds: [],
    groupIds: principal.groupIds,
    scopes: [],
    ...(principal.isAdmin === true ? { isAdmin: true } : {}),
  };
}
