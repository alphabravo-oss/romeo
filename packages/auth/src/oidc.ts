import { scopeValues } from './types'
import type { AuthSubject, Scope } from './types'

export interface OidcClaimMappingConfig {
  orgId: string
  userId: string
  defaultWorkspaceIds: string[]
  clientId?: string
  groupClaim?: string
  groupMap?: Record<string, string>
  adminGroups?: string[]
  adminGroupId?: string
  workspaceGroupMap?: Record<string, string>
  workspaceGroupPrefix?: string
  defaultScopes?: Scope[]
}

export interface OidcMappedSubject extends AuthSubject {
  oidc: {
    subject: string
    email?: string
    name?: string
    groups: string[]
  }
}

export class OidcClaimMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcClaimMappingError'
  }
}

export function mapOidcClaimsToSubject(claims: Record<string, unknown>, config: OidcClaimMappingConfig): OidcMappedSubject {
  const subject = stringClaim(claims.sub)
  if (subject === undefined) throw new OidcClaimMappingError('OIDC claims must include a string sub claim.')

  const groupOptions: { clientId?: string; groupClaim: string } = { groupClaim: config.groupClaim ?? 'groups' }
  if (config.clientId !== undefined) groupOptions.clientId = config.clientId
  const externalGroups = extractOidcGroups(claims, groupOptions)
  const isAdmin = intersects(externalGroups, config.adminGroups ?? [])
  const groupIds = mappedGroupIds(externalGroups, config)
  if (isAdmin) groupIds.push(config.adminGroupId ?? 'group_admins')
  const email = stringClaim(claims.email)
  const name = stringClaim(claims.name)
  const oidc: OidcMappedSubject['oidc'] = { subject, groups: externalGroups }
  if (email !== undefined) oidc.email = email
  if (name !== undefined) oidc.name = name

  const mappedSubject: OidcMappedSubject = {
    id: config.userId,
    type: 'user',
    orgId: config.orgId,
    workspaceIds: dedupe([...config.defaultWorkspaceIds, ...mappedWorkspaceIds(externalGroups, config)]),
    groupIds: dedupe(groupIds),
    scopes: isAdmin ? [...scopeValues] : config.defaultScopes ?? ['me:read', 'organizations:read', 'workspaces:read'],
    isAdmin,
    oidc
  }
  if (isAdmin) mappedSubject.adminRole = 'org_admin'
  return mappedSubject
}

export function extractOidcGroups(
  claims: Record<string, unknown>,
  options: { clientId?: string; groupClaim?: string } = {}
): string[] {
  const groups = new Set(toStringArray(claims[options.groupClaim ?? 'groups']))
  const realmAccess = objectClaim(claims.realm_access)
  for (const role of toStringArray(realmAccess?.roles)) groups.add(role)

  if (options.clientId !== undefined) {
    const resourceAccess = objectClaim(claims.resource_access)
    const clientAccess = objectClaim(resourceAccess?.[options.clientId])
    for (const role of toStringArray(clientAccess?.roles)) groups.add(role)
  }

  return [...groups].sort()
}

function mappedGroupIds(groups: string[], config: OidcClaimMappingConfig): string[] {
  const mapping = config.groupMap ?? {}
  return groups.map((group) => mapping[group]).filter((groupId): groupId is string => groupId !== undefined)
}

function mappedWorkspaceIds(groups: string[], config: OidcClaimMappingConfig): string[] {
  const mapping = config.workspaceGroupMap ?? {}
  const workspaceIds = groups.map((group) => mapping[group]).filter((workspaceId): workspaceId is string => workspaceId !== undefined)
  if (config.workspaceGroupPrefix !== undefined && config.workspaceGroupPrefix.length > 0) {
    for (const group of groups) {
      if (group.startsWith(config.workspaceGroupPrefix) && group.length > config.workspaceGroupPrefix.length) {
        workspaceIds.push(group.slice(config.workspaceGroupPrefix.length))
      }
    }
  }
  return workspaceIds
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right)
  return left.some((item) => rightSet.has(item))
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function objectClaim(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
