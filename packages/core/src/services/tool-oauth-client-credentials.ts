import type { ToolConnector } from '../domain/entities'
import { ApiError } from '../errors'
import type { SecretResolver } from './secret-resolver'

const maxTokenResponseBytes = 16 * 1024
const scopePattern = /^[A-Za-z0-9_:./-]{1,120}$/u

export type OAuthClientAuthMethod = 'client_secret_basic' | 'client_secret_post'

export interface OAuthClientCredentialsTokenInput {
  connector: ToolConnector
  fetchImpl: typeof fetch
  maxBytes: number
  secretResolver: SecretResolver
  timeoutMs: number
}

export async function resolveOAuthClientCredentialsAccessToken(input: OAuthClientCredentialsTokenInput): Promise<string> {
  const tokenUrl = readOAuthTokenUrl(input.connector)
  assertOAuthTokenHostAllowed(input.connector, tokenUrl)
  const credentials = await readOAuthClientCredentials(input.connector, input.secretResolver)
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded'
  }
  const scopes = normalizeOAuthScopes(input.connector.authConfig.oauthScopes)
  if (scopes.length > 0) body.set('scope', scopes.join(' '))
  const authMethod = readOAuthClientAuthMethod(input.connector.authConfig.oauthClientAuthMethod)
  if (authMethod === 'client_secret_post') {
    body.set('client_id', credentials.clientId)
    body.set('client_secret', credentials.clientSecret)
  } else {
    headers.authorization = basicAuthHeader(credentials.clientId, credentials.clientSecret)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await input.fetchImpl(tokenUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })
    if (!response.ok) {
      throw new ApiError('tool_operation_oauth_token_request_failed', 'OAuth token request failed.', 502, { status: response.status })
    }
    const text = await readBoundedText(response, Math.min(input.maxBytes, maxTokenResponseBytes))
    return readAccessToken(text)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('tool_operation_oauth_timeout', 'OAuth token request timed out.', 504)
    }
    throw new ApiError('tool_operation_oauth_token_request_failed', 'OAuth token request failed.', 502)
  } finally {
    clearTimeout(timeout)
  }
}

export function normalizeOAuthTokenUrl(value: string): string {
  const url = parseOAuthTokenUrl(value)
  return url.toString()
}

export function normalizeOAuthScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const scopes: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !scopePattern.test(item)) continue
    if (!scopes.includes(item)) scopes.push(item)
    if (scopes.length >= 20) break
  }
  return scopes
}

export function readOAuthClientAuthMethod(value: unknown): OAuthClientAuthMethod {
  return value === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic'
}

function readOAuthTokenUrl(connector: ToolConnector): URL {
  const value = connector.authConfig.oauthTokenUrl
  if (typeof value !== 'string') throw new ApiError('tool_operation_oauth_token_url_missing', 'OAuth token URL is not configured.', 409)
  return parseOAuthTokenUrl(value)
}

function parseOAuthTokenUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ApiError('invalid_tool_oauth_config', 'OAuth token URL must be a safe absolute URL.', 400)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new ApiError('invalid_tool_oauth_config', 'OAuth token URL must not include credentials, query, or fragment.', 400)
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return parsed
  throw new ApiError('invalid_tool_oauth_config', 'OAuth token URL must use HTTPS outside localhost.', 400)
}

function assertOAuthTokenHostAllowed(connector: ToolConnector, tokenUrl: URL): void {
  const host = tokenUrl.hostname.toLowerCase()
  if (connector.networkPolicy.mode !== 'allow_hosts' || !connector.networkPolicy.allowedHosts.includes(host)) {
    throw new ApiError('tool_operation_oauth_host_not_allowed', 'OAuth token host is not allowed by connector network policy.', 409, { host })
  }
}

async function readOAuthClientCredentials(
  connector: ToolConnector,
  secretResolver: SecretResolver
): Promise<{ clientId: string; clientSecret: string }> {
  const secretRef = typeof connector.authConfig.secretRef === 'string' ? connector.authConfig.secretRef : undefined
  if (secretRef === undefined) throw new ApiError('tool_operation_auth_not_configured', 'Tool operation auth is not configured.', 409)
  if (secretResolver.resolveValue === undefined) {
    throw new ApiError('secret_value_resolution_unavailable', 'Secret value resolution is unavailable for tool operation dispatch.', 409)
  }
  const resolution = await secretResolver.resolveValue(secretRef)
  if (!resolution.available || resolution.value === undefined) {
    throw new ApiError('tool_operation_secret_unavailable', 'Tool operation secret is unavailable.', 409, {
      failureCode: resolution.failureCode,
      scheme: resolution.scheme
    })
  }
  return parseOAuthSecret(resolution.value)
}

function parseOAuthSecret(value: string): { clientId: string; clientSecret: string } {
  let payload: unknown
  try {
    payload = JSON.parse(value)
  } catch {
    throw new ApiError('tool_operation_oauth_secret_invalid', 'OAuth client credential secret must be a JSON object.', 409)
  }
  if (!isRecord(payload)) throw new ApiError('tool_operation_oauth_secret_invalid', 'OAuth client credential secret must be a JSON object.', 409)
  const clientId = payload.clientId
  const clientSecret = payload.clientSecret
  if (typeof clientId !== 'string' || clientId.length === 0 || typeof clientSecret !== 'string' || clientSecret.length === 0) {
    throw new ApiError('tool_operation_oauth_secret_invalid', 'OAuth client credential secret is missing required fields.', 409)
  }
  return { clientId, clientSecret }
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new ApiError('tool_operation_oauth_response_too_large', 'OAuth token response exceeded the configured byte limit.', 502)
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(concatBytes(chunks))
}

function readAccessToken(text: string): string {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ApiError('tool_operation_oauth_token_invalid', 'OAuth token response must be JSON.', 502)
  }
  if (!isRecord(payload)) throw new ApiError('tool_operation_oauth_token_invalid', 'OAuth token response must be an object.', 502)
  const tokenType = payload.token_type
  if (typeof tokenType === 'string' && tokenType.toLowerCase() !== 'bearer') {
    throw new ApiError('tool_operation_oauth_token_unsupported', 'OAuth token response token type is not supported.', 502)
  }
  const accessToken = payload.access_token
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new ApiError('tool_operation_oauth_token_invalid', 'OAuth token response is missing an access token.', 502)
  }
  return accessToken
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
