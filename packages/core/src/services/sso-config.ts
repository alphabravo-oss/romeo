import type { RomeoEnv } from '@romeo/config'

import type { RomeoRepository } from '../domain/repository'

export type SsoConfigurationSource = 'database' | 'environment'

export interface ResolvedSsoOidcConfig {
  source: SsoConfigurationSource
  enabled: boolean
  issuerUrl: string
  clientId: string
  groupClaim: string
  adminGroups: string[]
  groupMap: Record<string, string>
  workspaceGroupMap: Record<string, string>
  workspaceGroupPrefix: string
}

export async function resolveSsoOidcConfig(repository: RomeoRepository, env: RomeoEnv, orgId: string): Promise<ResolvedSsoOidcConfig> {
  const settings = await repository.getSsoOidcSettings(orgId)
  if (settings !== undefined) {
    return {
      source: 'database',
      enabled: settings.enabled,
      issuerUrl: settings.issuerUrl,
      clientId: settings.clientId,
      groupClaim: settings.groupClaim,
      adminGroups: settings.adminGroups,
      groupMap: settings.groupMap,
      workspaceGroupMap: settings.workspaceGroupMap,
      workspaceGroupPrefix: settings.workspaceGroupPrefix
    }
  }
  return envSsoOidcConfig(env)
}

export function envSsoOidcConfig(env: RomeoEnv): ResolvedSsoOidcConfig {
  const issuerConfigured = env.OIDC_ISSUER_URL.length > 0
  const clientIdConfigured = env.OIDC_CLIENT_ID.length > 0
  return {
    source: 'environment',
    enabled: issuerConfigured && clientIdConfigured,
    issuerUrl: env.OIDC_ISSUER_URL,
    clientId: env.OIDC_CLIENT_ID,
    groupClaim: env.OIDC_GROUP_CLAIM,
    adminGroups: csv(env.OIDC_ADMIN_GROUPS),
    groupMap: mapping(env.OIDC_GROUP_MAP),
    workspaceGroupMap: mapping(env.OIDC_WORKSPACE_GROUP_MAP),
    workspaceGroupPrefix: env.OIDC_WORKSPACE_GROUP_PREFIX
  }
}

export function oidcConfigStatus(config: ResolvedSsoOidcConfig): {
  bearerTokenAuthEnabled: boolean
  clientIdConfigured: boolean
  issuerConfigured: boolean
  status: 'disabled' | 'enabled' | 'partial'
} {
  const issuerConfigured = config.issuerUrl.length > 0
  const clientIdConfigured = config.clientId.length > 0
  const complete = config.enabled && issuerConfigured && clientIdConfigured
  return {
    bearerTokenAuthEnabled: complete,
    clientIdConfigured,
    issuerConfigured,
    status: complete ? 'enabled' : config.enabled || issuerConfigured || clientIdConfigured ? 'partial' : 'disabled'
  }
}

export function safeHost(value: string): string | undefined {
  try {
    return new URL(value).host
  } catch {
    return undefined
  }
}

export function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/u, '')
}

export function assertTrustedMetadataUrl(value: string): void {
  const url = new URL(value)
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')) return
  throw new Error('oidc_metadata_url_untrusted')
}

export function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function mapping(value: string): Record<string, string> {
  const output: Record<string, string> = {}
  for (const item of csv(value)) {
    const [external, internal] = item.split('=', 2)
    if (external !== undefined && internal !== undefined && external.length > 0 && internal.length > 0) output[external] = internal
  }
  return output
}

export function mappingCount(value: Record<string, string>): number {
  return Object.keys(value).length
}
