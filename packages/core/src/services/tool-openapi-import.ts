import type { AuthSubject } from '@romeo/auth'
import type { ToolApprovalPolicy, ToolRiskLevel } from '@romeo/tools'

import type { ToolConnector, ToolOperation } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { ApiError } from '../errors'
import { createId } from '../ids'
import { normalizeOAuthScopes, normalizeOAuthTokenUrl } from './tool-oauth-client-credentials'

const supportedMethods = ['get', 'post', 'put', 'patch', 'delete'] as const

export interface ImportedToolConnector {
  connector: ToolConnector
  operations: ToolOperation[]
}

export async function importOpenApiToolConnector(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: {
    name: string
    description?: string
    spec: Record<string, unknown>
    riskLevel?: ToolRiskLevel
    approvalPolicy?: ToolApprovalPolicy
  }
): Promise<ImportedToolConnector> {
  const operations = extractOperations(input.spec)
  if (operations.length === 0) throw new ApiError('invalid_openapi_spec', 'OpenAPI spec must include at least one supported operation.', 400)

  const now = new Date().toISOString()
  const hasWrite = operations.some((operation) => operation.method !== 'get')
  const connector: ToolConnector = {
    id: createId('tool_connector'),
    orgId: subject.orgId,
    type: 'openapi',
    name: input.name,
    description: input.description ?? '',
    schema: summarizeSpec(input.spec, operations.length),
    authConfig: { type: 'none', configured: false },
    networkPolicy: { mode: 'deny_all', allowedHosts: [], allowPrivateNetwork: false },
    riskLevel: input.riskLevel ?? (hasWrite ? 'medium' : 'low'),
    approvalPolicy: input.approvalPolicy ?? (hasWrite ? 'external_side_effects' : 'never'),
    visibility: 'org',
    enabled: false,
    createdAt: now,
    updatedAt: now
  }

  const created = await repository.createToolConnector(connector)
  const createdOperations = await repository.createToolOperations(
    operations.map((operation) => toToolOperation(subject, created.id, operation, input, now))
  )
  return { connector: created, operations: createdOperations }
}

function extractOperations(spec: Record<string, unknown>) {
  const paths = asRecord(spec.paths)
  if (!paths) return []
  const seen = new Set<string>()
  const operations: Array<{
    method: string
    path: string
    operationId: string
    name: string
    description: string
    inputSchema: Record<string, unknown>
    outputSchema: Record<string, unknown>
  }> = []

  for (const [path, pathItem] of Object.entries(paths)) {
    const operationsByMethod = asRecord(pathItem)
    if (!operationsByMethod) continue
    for (const method of supportedMethods) {
      const operation = asRecord(operationsByMethod[method])
      if (!operation || operations.length >= 25) continue
      const baseId = readString(operation.operationId) ?? `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`
      const operationId = uniqueOperationId(baseId, seen)
      operations.push({
        method,
        path,
        operationId,
        name: readString(operation.summary) ?? operationId,
        description: readString(operation.description) ?? '',
        inputSchema: { parameters: operation.parameters ?? [], requestBody: operation.requestBody ?? null },
        outputSchema: asRecord(operation.responses) ?? {}
      })
    }
  }
  return operations
}

function toToolOperation(
  subject: AuthSubject,
  connectorId: string,
  operation: ReturnType<typeof extractOperations>[number],
  input: { riskLevel?: ToolRiskLevel; approvalPolicy?: ToolApprovalPolicy },
  now: string
): ToolOperation {
  const isRead = operation.method === 'get'
  return {
    id: createId('tool_operation'),
    orgId: subject.orgId,
    connectorId,
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    name: operation.name,
    description: operation.description,
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    riskLevel: input.riskLevel ?? (isRead ? 'low' : 'medium'),
    approvalPolicy: input.approvalPolicy ?? (isRead ? 'never' : 'external_side_effects'),
    enabled: false,
    createdAt: now
  }
}

function summarizeSpec(spec: Record<string, unknown>, operationCount: number): Record<string, unknown> {
  const info = asRecord(spec.info)
  const baseUrl = readOpenApiBaseUrl(spec)
  const authHints = readOpenApiAuthHints(spec, baseUrl)
  return {
    source: 'inline_openapi',
    version: readString(spec.openapi) ?? readString(spec.swagger) ?? 'unknown',
    title: info ? readString(info.title) ?? '' : '',
    operationCount,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(authHints.length === 0 ? {} : { authHints })
  }
}

type OpenApiAuthHint =
  | { apiKeyIn: 'header' | 'query'; apiKeyName: string; schemeId: string; type: 'api_key' }
  | { oauthScopes: string[]; oauthTokenUrl: string; schemeId: string; type: 'oauth2_client_credentials' }

function readOpenApiAuthHints(spec: Record<string, unknown>, baseUrl: string | undefined): OpenApiAuthHint[] {
  const securitySchemes = asRecord(asRecord(spec.components)?.securitySchemes)
  if (securitySchemes === undefined) return []
  const hints: OpenApiAuthHint[] = []
  for (const [schemeId, scheme] of Object.entries(securitySchemes)) {
    if (hints.length >= 5) break
    const record = asRecord(scheme)
    if (record === undefined) continue
    const location = record.in
    const name = readString(record.name)
    if (record.type === 'apiKey' && (location === 'header' || location === 'query') && name !== undefined && isSafeApiKeyName(name)) {
      hints.push({ type: 'api_key', schemeId, apiKeyIn: location, apiKeyName: name })
      continue
    }
    const clientCredentials = asRecord(asRecord(record.flows)?.clientCredentials)
    const tokenUrl = readOpenApiOAuthTokenUrl(readString(clientCredentials?.tokenUrl), baseUrl)
    if (record.type === 'oauth2' && clientCredentials !== undefined && tokenUrl !== undefined) {
      hints.push({
        type: 'oauth2_client_credentials',
        schemeId,
        oauthTokenUrl: tokenUrl,
        oauthScopes: normalizeOAuthScopes(Object.keys(asRecord(clientCredentials.scopes) ?? {}))
      })
    }
  }
  return hints
}

function readOpenApiOAuthTokenUrl(value: string | undefined, baseUrl: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const resolved = baseUrl === undefined ? new URL(value) : new URL(value, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    return normalizeOAuthTokenUrl(resolved.toString())
  } catch {
    return undefined
  }
}

function readOpenApiBaseUrl(spec: Record<string, unknown>): string | undefined {
  const servers = Array.isArray(spec.servers) ? spec.servers : []
  const first = asRecord(servers[0])
  const url = first === undefined ? undefined : readString(first.url)
  if (url === undefined) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) return undefined
    if (parsed.protocol === 'https:') return parsed.toString().replace(/\/+$/u, '')
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1')) {
      return parsed.toString().replace(/\/+$/u, '')
    }
  } catch {
    return undefined
  }
  return undefined
}

function uniqueOperationId(baseId: string, seen: Set<string>): string {
  let candidate = baseId
  let index = 2
  while (seen.has(candidate)) {
    candidate = `${baseId}_${index}`
    index += 1
  }
  seen.add(candidate)
  return candidate
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function isSafeApiKeyName(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,80}$/u.test(value)
}
