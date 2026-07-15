import type { ObjectStore, PresignedUpload, PutObjectInput, StoredObject } from './types'

export const disabledObjectStore: ObjectStore = {
  async putObject(_input: PutObjectInput): Promise<StoredObject> {
    throw new Error('Object storage is not configured.')
  },
  async getObject(_key: string): Promise<Uint8Array | undefined> {
    throw new Error('Object storage is not configured.')
  },
  async deleteObject(_key: string): Promise<void> {
    throw new Error('Object storage is not configured.')
  },
  async createPresignedUpload(_input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload> {
    throw new Error('Object storage is not configured.')
  }
}
