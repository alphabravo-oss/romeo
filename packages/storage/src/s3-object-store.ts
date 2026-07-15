import { createS3PresignedRequest } from './s3-signer'
import type { ObjectStore, PresignedUpload, PutObjectInput, StoredObject } from './types'

export interface S3ObjectStoreConfig {
  accessKeyId: string
  bucket: string
  endpoint: string
  region?: string
  secretAccessKey: string
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly config: S3ObjectStoreConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const upload = await this.createPresignedUpload({ key: input.key, contentType: input.contentType, expiresInSeconds: 900 })
    const response = await this.fetchImpl(upload.url, { method: upload.method, headers: upload.headers, body: toArrayBuffer(input.body) })
    if (!response.ok) throw new Error(`Object upload failed with ${response.status}.`)

    return {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      etag: normalizeEtag(response.headers.get('etag')) ?? (await objectEtag(input.body)),
      updatedAt: new Date().toISOString()
    }
  }

  async getObject(key: string): Promise<Uint8Array | undefined> {
    const request = await this.presign({ key, method: 'GET', expiresInSeconds: 300 })
    const response = await this.fetchImpl(request.url, { method: 'GET' })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`Object read failed with ${response.status}.`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async deleteObject(key: string): Promise<void> {
    const request = await this.presign({ key, method: 'DELETE', expiresInSeconds: 300 })
    const response = await this.fetchImpl(request.url, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw new Error(`Object delete failed with ${response.status}.`)
  }

  async createPresignedUpload(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload> {
    const request = await this.presign({
      key: input.key,
      method: 'PUT',
      contentType: input.contentType,
      expiresInSeconds: input.expiresInSeconds
    })
    return {
      key: input.key,
      url: request.url,
      method: 'PUT',
      expiresAt: request.expiresAt,
      headers: request.headers
    }
  }

  private presign(input: {
    contentType?: string
    expiresInSeconds: number
    key: string
    method: 'DELETE' | 'GET' | 'PUT'
  }) {
    return createS3PresignedRequest({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      key: input.key,
      method: input.method,
      region: this.config.region ?? 'us-east-1',
      secretAccessKey: this.config.secretAccessKey,
      expiresInSeconds: input.expiresInSeconds,
      ...(input.contentType !== undefined ? { contentType: input.contentType } : {})
    })
  }
}

async function objectEtag(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function normalizeEtag(value: string | null): string | undefined {
  return value?.replace(/^"|"$/g, '')
}
