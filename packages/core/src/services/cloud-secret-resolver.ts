import { createHash, createHmac } from 'node:crypto'

import { parseManagedSecretRef } from './secret-refs'
import type { SecretAvailability, SecretResolution, SecretResolver } from './secret-resolver'

export interface AwsSecretsManagerResolverOptions {
  accessKeyId: string
  secretAccessKey: string
  region: string
  sessionToken?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
}

export interface GcpSecretManagerResolverOptions {
  accessToken: string
  projectId: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface AzureKeyVaultResolverOptions {
  accessToken: string
  vaultUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class AwsSecretsManagerResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly now: () => Date

  constructor(private readonly options: AwsSecretsManagerResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.now = options.now ?? (() => new Date())
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme !== 'aws-sm') return unsupported(parsed.scheme)
    if (this.options.accessKeyId.length === 0 || this.options.secretAccessKey.length === 0 || this.options.region.length === 0) {
      return misconfigured(parsed.scheme)
    }
    if (!isSafeCloudPath(parsed.path)) return invalid(parsed.scheme)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const signingOptions: AwsSigningOptions = {
        action: 'DescribeSecret',
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
        region: this.options.region,
        secretId: parsed.path,
        now: this.now()
      }
      if (this.options.sessionToken !== undefined) signingOptions.sessionToken = this.options.sessionToken
      const request = signAwsSecretsManagerRequest(signingOptions)
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
      if (response.ok) return { available: true, scheme: parsed.scheme }
      const errorCode = await readAwsErrorCode(response)
      if (response.status === 404 || errorCode === 'ResourceNotFoundException') return notFound(parsed.scheme)
      if (response.status === 401 || response.status === 403 || errorCode === 'UnrecognizedClientException' || errorCode === 'InvalidSignatureException') {
        return accessDenied(parsed.scheme)
      }
      return resolverError(parsed.scheme)
    } catch (caught) {
      return caught instanceof Error && caught.name === 'AbortError' ? timeoutResult(parsed.scheme) : resolverError(parsed.scheme)
    } finally {
      clearTimeout(timeout)
    }
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme !== 'aws-sm') return unsupported(parsed.scheme)
    if (this.options.accessKeyId.length === 0 || this.options.secretAccessKey.length === 0 || this.options.region.length === 0) {
      return misconfigured(parsed.scheme)
    }
    if (!isSafeCloudPath(parsed.path)) return invalid(parsed.scheme)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const signingOptions: AwsSigningOptions = {
        action: 'GetSecretValue',
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
        region: this.options.region,
        secretId: parsed.path,
        now: this.now()
      }
      if (this.options.sessionToken !== undefined) signingOptions.sessionToken = this.options.sessionToken
      const request = signAwsSecretsManagerRequest(signingOptions)
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
      if (!response.ok) return awsAvailabilityFromResponse(parsed.scheme, response, await readAwsErrorCode(response))
      const value = await readAwsSecretString(response)
      return value === undefined ? secretEmpty(parsed.scheme) : { available: true, scheme: parsed.scheme, value }
    } catch (caught) {
      return caught instanceof Error && caught.name === 'AbortError' ? timeoutResult(parsed.scheme) : resolverError(parsed.scheme)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class GcpSecretManagerResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: GcpSecretManagerResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme !== 'gcp-sm') return unsupported(parsed.scheme)
    if (this.options.accessToken.length === 0 || this.options.projectId.length === 0) return misconfigured(parsed.scheme)
    if (!isSafeGcpSecretId(parsed.path) || !isSafeGcpProjectId(this.options.projectId)) return invalid(parsed.scheme)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(gcpSecretMetadataUrl(this.options.projectId, parsed.path), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.options.accessToken}` },
        signal: controller.signal
      })
      return availabilityFromStatus(parsed.scheme, response.status)
    } catch (caught) {
      return caught instanceof Error && caught.name === 'AbortError' ? timeoutResult(parsed.scheme) : resolverError(parsed.scheme)
    } finally {
      clearTimeout(timeout)
    }
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme !== 'gcp-sm') return unsupported(parsed.scheme)
    if (this.options.accessToken.length === 0 || this.options.projectId.length === 0) return misconfigured(parsed.scheme)
    if (!isSafeGcpSecretId(parsed.path) || !isSafeGcpProjectId(this.options.projectId)) return invalid(parsed.scheme)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(gcpSecretAccessUrl(this.options.projectId, parsed.path), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.options.accessToken}` },
        signal: controller.signal
      })
      if (!response.ok) return availabilityFromStatus(parsed.scheme, response.status)
      const value = await readGcpSecretPayload(response)
      return value === undefined ? secretEmpty(parsed.scheme) : { available: true, scheme: parsed.scheme, value }
    } catch (caught) {
      return caught instanceof Error && caught.name === 'AbortError' ? timeoutResult(parsed.scheme) : resolverError(parsed.scheme)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class AzureKeyVaultResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: AzureKeyVaultResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme !== 'azure-kv') return unsupported(parsed.scheme)
    if (this.options.accessToken.length === 0 || this.options.vaultUrl.length === 0) return misconfigured(parsed.scheme)
    if (!isSafeAzureSecretName(parsed.path)) return invalid(parsed.scheme)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(azureSecretVersionsUrl(this.options.vaultUrl, parsed.path), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.options.accessToken}` },
        signal: controller.signal
      })
      return availabilityFromStatus(parsed.scheme, response.status)
    } catch (caught) {
      return caught instanceof Error && caught.name === 'AbortError' ? timeoutResult(parsed.scheme) : resolverError(parsed.scheme)
    } finally {
      clearTimeout(timeout)
    }
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme !== 'azure-kv') return unsupported(parsed.scheme)
    if (this.options.accessToken.length === 0 || this.options.vaultUrl.length === 0) return misconfigured(parsed.scheme)
    if (!isSafeAzureSecretName(parsed.path)) return invalid(parsed.scheme)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(azureSecretValueUrl(this.options.vaultUrl, parsed.path), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.options.accessToken}` },
        signal: controller.signal
      })
      if (!response.ok) return availabilityFromStatus(parsed.scheme, response.status)
      const value = await readAzureSecretValue(response)
      return value === undefined ? secretEmpty(parsed.scheme) : { available: true, scheme: parsed.scheme, value }
    } catch (caught) {
      return caught instanceof Error && caught.name === 'AbortError' ? timeoutResult(parsed.scheme) : resolverError(parsed.scheme)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class CloudSecretResolver implements SecretResolver {
  constructor(
    private readonly resolvers: {
      aws: AwsSecretsManagerResolver
      gcp: GcpSecretManagerResolver
      azure: AzureKeyVaultResolver
    }
  ) {}

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme === 'aws-sm') return this.resolvers.aws.check(secretRef)
    if (parsed.scheme === 'gcp-sm') return this.resolvers.gcp.check(secretRef)
    if (parsed.scheme === 'azure-kv') return this.resolvers.azure.check(secretRef)
    return unsupported(parsed.scheme)
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef)
    if (parsed.scheme === 'aws-sm') return this.resolvers.aws.resolveValue(secretRef)
    if (parsed.scheme === 'gcp-sm') return this.resolvers.gcp.resolveValue(secretRef)
    if (parsed.scheme === 'azure-kv') return this.resolvers.azure.resolveValue(secretRef)
    return unsupported(parsed.scheme)
  }
}

interface AwsSignedRequest {
  body: string
  headers: Record<string, string>
  url: string
}

interface AwsSigningOptions {
  action: 'DescribeSecret' | 'GetSecretValue'
  accessKeyId: string
  now: Date
  region: string
  secretAccessKey: string
  secretId: string
  sessionToken?: string
}

function signAwsSecretsManagerRequest(options: AwsSigningOptions): AwsSignedRequest {
  const service = 'secretsmanager'
  const host = `${service}.${options.region}.amazonaws.com`
  const body = JSON.stringify({ SecretId: options.secretId })
  const amzDate = awsDate(options.now)
  const dateStamp = amzDate.slice(0, 8)
  const credentialScope = `${dateStamp}/${options.region}/${service}/aws4_request`
  const headers: Record<string, string> = {
    'content-type': 'application/x-amz-json-1.1',
    host,
    'x-amz-date': amzDate,
    'x-amz-target': `secretsmanager.${options.action}`
  }
  if (options.sessionToken !== undefined && options.sessionToken.length > 0) headers['x-amz-security-token'] = options.sessionToken

  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}`).join('\n')
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalRequest = ['POST', '/', '', `${canonicalHeaders}\n`, signedHeaders, sha256Hex(body)].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = awsSigningKey(options.secretAccessKey, dateStamp, options.region, service)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    body,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    url: `https://${host}/`
  }
}

function awsSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const dateKey = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest()
  const regionKey = createHmac('sha256', dateKey).update(region).digest()
  const serviceKey = createHmac('sha256', regionKey).update(service).digest()
  return createHmac('sha256', serviceKey).update('aws4_request').digest()
}

function awsDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, '')
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readAwsErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { __type?: unknown; code?: unknown }
    const rawCode = typeof body.__type === 'string' ? body.__type : typeof body.code === 'string' ? body.code : undefined
    return rawCode?.split('#').at(-1)
  } catch {
    return undefined
  }
}

async function readAwsSecretString(response: Response): Promise<string | undefined> {
  const body = await response.json() as { SecretString?: unknown }
  return typeof body.SecretString === 'string' && body.SecretString.length > 0 ? body.SecretString : undefined
}

function gcpSecretMetadataUrl(projectId: string, secretId: string): string {
  const url = new URL(`https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretId)}`)
  return url.toString()
}

function gcpSecretAccessUrl(projectId: string, secretId: string): string {
  const url = new URL(`https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretId)}/versions/latest:access`)
  return url.toString()
}

async function readGcpSecretPayload(response: Response): Promise<string | undefined> {
  const body = await response.json() as { payload?: { data?: unknown } }
  if (typeof body.payload?.data !== 'string' || body.payload.data.length === 0) return undefined
  const value = Buffer.from(body.payload.data, 'base64').toString('utf8')
  return value.length === 0 ? undefined : value
}

function azureSecretVersionsUrl(vaultUrl: string, secretName: string): string {
  return azureSecretUrl(vaultUrl, `/secrets/${encodeURIComponent(secretName)}/versions`)
}

function azureSecretValueUrl(vaultUrl: string, secretName: string): string {
  return azureSecretUrl(vaultUrl, `/secrets/${encodeURIComponent(secretName)}`)
}

function azureSecretUrl(vaultUrl: string, pathname: string): string {
  const url = new URL(vaultUrl)
  if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new Error('Azure Key Vault URL must be an https origin without credentials, query, or fragment.')
  }
  url.pathname = pathname
  url.searchParams.set('api-version', '7.5')
  return url.toString()
}

async function readAzureSecretValue(response: Response): Promise<string | undefined> {
  const body = await response.json() as { value?: unknown }
  return typeof body.value === 'string' && body.value.length > 0 ? body.value : undefined
}

function availabilityFromStatus(scheme: string, status: number): SecretAvailability {
  if (status >= 200 && status < 300) return { available: true, scheme }
  if (status === 404) return notFound(scheme)
  if (status === 401 || status === 403) return accessDenied(scheme)
  return resolverError(scheme)
}

function awsAvailabilityFromResponse(scheme: string, response: Response, errorCode: string | undefined): SecretAvailability {
  if (response.status === 404 || errorCode === 'ResourceNotFoundException') return notFound(scheme)
  if (response.status === 401 || response.status === 403 || errorCode === 'UnrecognizedClientException' || errorCode === 'InvalidSignatureException') {
    return accessDenied(scheme)
  }
  return resolverError(scheme)
}

function isSafeCloudPath(path: string): boolean {
  return path.length > 0 && path.length <= 512 && /^[A-Za-z0-9_./+=@-]+$/u.test(path) && !path.split('/').includes('..')
}

function isSafeGcpSecretId(secretId: string): boolean {
  return secretId.length > 0 && secretId.length <= 255 && /^[A-Za-z0-9_-]+$/u.test(secretId)
}

function isSafeGcpProjectId(projectId: string): boolean {
  return projectId.length > 0 && projectId.length <= 63 && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(projectId)
}

function isSafeAzureSecretName(secretName: string): boolean {
  return secretName.length > 0 && secretName.length <= 127 && /^[A-Za-z0-9-]+$/u.test(secretName)
}

function unsupported(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_scheme_unsupported', scheme }
}

function misconfigured(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_resolver_misconfigured', scheme }
}

function invalid(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'invalid_secret_ref', scheme }
}

function notFound(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_not_found', scheme }
}

function accessDenied(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_access_denied', scheme }
}

function secretEmpty(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_empty', scheme }
}

function resolverError(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_resolver_error', scheme }
}

function timeoutResult(scheme: string): SecretAvailability {
  return { available: false, failureCode: 'secret_resolver_timeout', scheme }
}
