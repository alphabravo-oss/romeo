export interface StoredObject {
  key: string
  contentType: string
  sizeBytes: number
  etag: string
  updatedAt: string
}

export interface PutObjectInput {
  key: string
  body: Uint8Array
  contentType: string
}

export interface PresignedUpload {
  key: string
  url: string
  method: 'PUT'
  expiresAt: string
  headers: Record<string, string>
}

export interface ObjectStore {
  putObject(input: PutObjectInput): Promise<StoredObject>
  getObject(key: string): Promise<Uint8Array | undefined>
  deleteObject(key: string): Promise<void>
  createPresignedUpload(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<PresignedUpload>
}
