import type { ObjectStore, PresignedUpload, PutObjectInput, StoredObject } from './types'

interface MemoryObject {
  bytes: Uint8Array
  metadata: StoredObject
}

export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, MemoryObject>()

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const updatedAt = new Date().toISOString()
    const metadata: StoredObject = {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      etag: await objectEtag(input.body),
      updatedAt
    }
    this.objects.set(input.key, { bytes: new Uint8Array(input.body), metadata })
    return metadata
  }

  async getObject(key: string): Promise<Uint8Array | undefined> {
    const object = this.objects.get(key)
    return object ? new Uint8Array(object.bytes) : undefined
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async createPresignedUpload(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload> {
    return {
      key: input.key,
      url: `memory://object-store/${encodeURIComponent(input.key)}`,
      method: 'PUT',
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: { 'content-type': input.contentType }
    }
  }
}

export const memoryObjectStore = new MemoryObjectStore()

async function objectEtag(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
