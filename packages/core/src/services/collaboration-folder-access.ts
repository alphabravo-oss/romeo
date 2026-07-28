import {
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { WorkspaceFolder } from "../domain/entities";

export function canAccessFolder(
  subject: AuthSubject,
  grants: ResourceGrant[],
  folder: WorkspaceFolder,
  permission: "read" | "write",
): boolean {
  if (!canAccessOrg(subject, folder.orgId)) return false;
  if (!hasWorkspaceAccess(subject, folder.workspaceId)) return false;
  if (subject.isAdmin === true || folder.createdBy === subject.id) return true;
  if (
    permission === "read" &&
    hasGrant(subject, grants, "folder", folder.id, "read")
  )
    return true;
  return hasGrant(subject, grants, "folder", folder.id, "write");
}
