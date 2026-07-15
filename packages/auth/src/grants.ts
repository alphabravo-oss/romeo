import type { AuthSubject, ResourceGrant, ResourceType } from './types'

export function hasWorkspaceAccess(subject: AuthSubject, workspaceId: string): boolean {
  return subject.isAdmin === true || subject.workspaceIds.includes(workspaceId)
}

export function hasGrant(
  subject: AuthSubject,
  grants: ResourceGrant[],
  resourceType: ResourceType,
  resourceId: string,
  permission: ResourceGrant['permission']
): boolean {
  if (subject.isAdmin === true) {
    return true
  }

  for (const grant of grants) {
    if (grant.resourceType !== resourceType || grant.resourceId !== resourceId || grant.permission !== permission) {
      continue
    }

    if (grant.principalType === subject.type && grant.principalId === subject.id) {
      return true
    }

    if (grant.principalType === 'group' && subject.groupIds.includes(grant.principalId)) {
      return true
    }
  }

  return false
}
