import { createS3PresignedRequest } from '@romeo/storage'

import { ApiError } from '../errors'
import type { S3ConnectorObject, S3ConnectorReader, S3ConnectorReadResult } from './data-connector-executors'
import { retryConnectorResponse, type DataConnectorRetryPolicy } from './data-connector-retry'
import type { SecretResolver } from './secret-resolver'

export interface S3HttpConnectorReaderOptions {
  accessKeyId: string
  endpoint: string
  fetchImpl?: typeof fetch
  maxListResponseBytes?: number
  presignExpiresInSeconds?: number
  retryAttempts?: number
  retryBackoffMs?: number
  secretResolver?: SecretResolver
  secretAccessKey: string
  timeoutMs?: number
}

interface S3ReaderCredentials {
  accessKeyId: string
  secretAccessKey: string
}

export class S3HttpConnectorReader implements S3ConnectorReader {
  private readonly fetchImpl: typeof fetch
  private readonly maxListResponseBytes: number
  private readonly presignExpiresInSeconds: number
  private readonly retryPolicy: DataConnectorRetryPolicy
  private readonly timeoutMs: number

  constructor(private readonly options: S3HttpConnectorReaderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.maxListResponseBytes = options.maxListResponseBytes ?? 1_000_000
    this.presignExpiresInSeconds = options.presignExpiresInSeconds ?? 300
    this.retryPolicy = {
      retryAttempts: options.retryAttempts ?? 1,
      retryBackoffMs: options.retryBackoffMs ?? 250
    }
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async listObjects(input: { bucket: string; maxKeys: number; prefix: string; region: string; secretRef?: string }): Promise<S3ConnectorObject[]> {
    const credentials = await this.credentials(input.secretRef)
    const maxKeys = Math.max(1, Math.min(input.maxKeys, 1_000))
    const request = await this.presign({
      bucket: input.bucket,
      credentials,
      key: '',
      method: 'GET',
      region: input.region,
      query: { 'list-type': '2', 'max-keys': String(maxKeys), prefix: input.prefix }
    })
    const response = await this.fetchWithTimeout(request.url, { method: 'GET' }, 'connector_s3_list_failed')
    if (!response.ok) throw new ApiError('connector_s3_list_failed', 'S3 connector object listing failed.', 502, { status: response.status })
    const xml = await responseText(response, this.maxListResponseBytes)
    const parsed = parseListObjectsV2(xml)
    if (parsed.truncated) throw new ApiError('connector_item_limit_exceeded', 'S3 connector returned too many objects.', 413, { maxItems: maxKeys })
    return parsed.objects
  }

  async getObject(input: { bucket: string; key: string; region: string; secretRef?: string }): Promise<S3ConnectorReadResult | undefined> {
    const credentials = await this.credentials(input.secretRef)
    const request = await this.presign({
      bucket: input.bucket,
      credentials,
      key: input.key,
      method: 'GET',
      region: input.region
    })
    const response = await this.fetchWithTimeout(request.url, { method: 'GET' }, 'connector_s3_get_failed')
    if (response.status === 404) return undefined
    if (!response.ok) throw new ApiError('connector_s3_get_failed', 'S3 connector object read failed.', 502, { status: response.status })
    const contentType = response.headers.get('content-type') ?? undefined
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      ...(contentType === undefined ? {} : { contentType })
    }
  }

  private async credentials(secretRef: string | undefined): Promise<S3ReaderCredentials> {
    if (secretRef !== undefined) return this.connectorCredentials(secretRef)
    if (this.options.accessKeyId.length === 0 || this.options.secretAccessKey.length === 0) {
      throw new ApiError('connector_s3_reader_not_configured', 'S3 connector reader credentials are not configured.', 409)
    }
    return { accessKeyId: this.options.accessKeyId, secretAccessKey: this.options.secretAccessKey }
  }

  private async connectorCredentials(secretRef: string): Promise<S3ReaderCredentials> {
    if (this.options.secretResolver?.resolveValue === undefined) {
      throw new ApiError('connector_s3_secret_ref_unsupported', 'S3 connector secret references require a value-capable secret resolver.', 409)
    }
    const resolution = await this.options.secretResolver.resolveValue(secretRef)
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError('connector_s3_secret_ref_unavailable', 'S3 connector secret reference is unavailable.', 409, {
        ...(resolution.failureCode === undefined ? {} : { failureCode: resolution.failureCode }),
        secretRefScheme: resolution.scheme
      })
    }
    return parseS3CredentialSecret(resolution.value)
  }

  private presign(input: {
    bucket: string
    credentials: S3ReaderCredentials
    key: string
    method: 'GET'
    query?: Record<string, string | undefined>
    region: string
  }) {
    return createS3PresignedRequest({
      accessKeyId: input.credentials.accessKeyId,
      bucket: input.bucket,
      endpoint: this.options.endpoint,
      expiresInSeconds: this.presignExpiresInSeconds,
      key: input.key,
      method: input.method,
      ...(input.query === undefined ? {} : { query: input.query }),
      region: input.region,
      secretAccessKey: input.credentials.secretAccessKey
    })
  }

  private async fetchWithTimeout(url: string, init: RequestInit, errorCode: string): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await retryConnectorResponse(
        () => this.fetchImpl(url, { ...init, signal: controller.signal }),
        this.retryPolicy
      )
    } catch {
      throw new ApiError(errorCode, 'S3 connector request failed.', 502)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function parseS3CredentialSecret(value: string): S3ReaderCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalidCredentialSecret()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidCredentialSecret()
  const accessKeyId = (parsed as { accessKeyId?: unknown }).accessKeyId
  const secretAccessKey = (parsed as { secretAccessKey?: unknown }).secretAccessKey
  if (typeof accessKeyId !== 'string' || accessKeyId.length === 0 || typeof secretAccessKey !== 'string' || secretAccessKey.length === 0) {
    throw invalidCredentialSecret()
  }
  return { accessKeyId, secretAccessKey }
}

function invalidCredentialSecret(): ApiError {
  return new ApiError('connector_s3_secret_ref_invalid', 'S3 connector secret must be JSON with accessKeyId and secretAccessKey.', 400)
}

interface ParsedListObjects {
  objects: S3ConnectorObject[]
  truncated: boolean
}

function parseListObjectsV2(xml: string): ParsedListObjects {
  return {
    objects: [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)].flatMap((match) => {
      const block = match[1] ?? ''
      const key = tagText(block, 'Key')
      if (key === undefined || key.length === 0) return []
      const size = tagText(block, 'Size')
      const object: S3ConnectorObject = { key }
      if (size !== undefined) {
        const sizeBytes = Number(size)
        if (Number.isFinite(sizeBytes) && sizeBytes >= 0) object.sizeBytes = sizeBytes
      }
      return [object]
    }),
    truncated: tagText(xml, 'IsTruncated') === 'true'
  }
}

async function responseText(response: Response, maxBytes: number): Promise<string> {
  const body = await response.arrayBuffer()
  if (body.byteLength > maxBytes) throw new ApiError('connector_response_too_large', 'S3 connector list response exceeds the configured size limit.', 413)
  return new TextDecoder().decode(body)
}

function tagText(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'u').exec(xml)
  return match === null ? undefined : decodeXml(match[1] ?? '')
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}
