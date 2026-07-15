import {
  scopeValues,
  type AuthSubject,
  type Scope,
  type UserRole,
} from "@romeo/auth";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

export const localUserScopes: Scope[] = [
  "me:read",
  "organizations:read",
  "workspaces:read",
  "providers:read",
  "models:read",
  "models:use",
  "agents:read",
  "agents:create",
  "agents:write",
  "agents:run",
  "chats:read",
  "chats:write",
  "runs:read",
  "runs:create",
  "runs:cancel",
  "files:read",
  "files:write",
  "knowledge:read",
  "knowledge:write",
  "knowledge:query",
  "usage:read",
  "voices:use",
  "tools:use",
];

export function normalizeUserRole(user: Pick<User, "id" | "role">): UserRole {
  if (user.id === "user_dev_admin") return "global_admin";
  return user.role === "org_admin" || user.role === "global_admin"
    ? user.role
    : "user";
}

export function isUserAdminRole(
  role: UserRole,
): role is Exclude<UserRole, "user"> {
  return role === "org_admin" || role === "global_admin";
}

export async function createUserAuthSubject(
  repository: RomeoRepository,
  user: User,
  options: {
    apiKeyId?: string;
    externalGroupIds?: string[];
    forceAdmin?: boolean;
    sessionId?: string;
    sessionScopes?: Scope[];
    supportSession?: AuthSubject["supportSession"];
  } = {},
): Promise<AuthSubject> {
  const [workspaces, memberships] = await Promise.all([
    repository.listWorkspaces(user.orgId),
    repository.listGroupMemberships(user.orgId, undefined, user.id),
  ]);
  const role = normalizeUserRole(user);
  const adminRole = isUserAdminRole(role)
    ? role
    : options.forceAdmin === true
      ? "org_admin"
      : undefined;
  const isAdmin = adminRole !== undefined;
  const groupIds = new Set([
    ...memberships.map((membership) => membership.groupId),
    ...(options.externalGroupIds ?? []),
  ]);
  if (isAdmin) groupIds.add("group_admins");

  const subject: AuthSubject = {
    id: user.id,
    type: "user",
    email: user.email,
    name: user.name,
    orgId: user.orgId,
    workspaceIds: workspaces.map((workspace) => workspace.id),
    groupIds: [...groupIds].sort(),
    scopes: isAdmin
      ? [...scopeValues]
      : (options.sessionScopes ?? localUserScopes),
    isAdmin,
  };
  if (adminRole !== undefined) subject.adminRole = adminRole;
  if (options.apiKeyId !== undefined) subject.apiKeyId = options.apiKeyId;
  if (options.sessionId !== undefined) subject.sessionId = options.sessionId;
  if (options.supportSession !== undefined)
    subject.supportSession = options.supportSession;
  return subject;
}
