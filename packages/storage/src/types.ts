export interface StoredObject {
  key: string;
  contentType: string;
  sizeBytes: number;
  etag: string;
  updatedAt: string;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface PresignedUpload {
  key: string;
  url: string;
  method: "PUT";
  expiresAt: string;
  headers: Record<string, string>;
}

export interface ObjectStore {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(
    key: string,
    options?: { maxBytes?: number; signal?: AbortSignal },
  ): Promise<Uint8Array | undefined>;
  getObjectStream?(
    key: string,
    options?: { maxBytes?: number; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array> | undefined>;
  headObject?(key: string): Promise<StoredObject | undefined>;
  deleteObject(key: string): Promise<void>;
  createPresignedUpload(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
    sha256?: string;
    sizeBytes?: number;
  }): Promise<PresignedUpload>;
  checkReadiness?(signal?: AbortSignal): Promise<ObjectStoreReadinessResult>;
}

export interface ObjectStoreReadinessResult {
  authenticated: boolean;
  deleteVerified: boolean;
  encryptionConfigured: boolean;
  lifecycleConfigured: boolean;
  readAfterWriteVerified: boolean;
  ready: boolean;
  replicationConfigured: boolean;
  tlsEnabled: boolean;
  versioningEnabled: boolean;
  writeVerified: boolean;
}

export class ObjectSizeLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Object exceeds the configured ${maxBytes} byte read limit.`);
    this.name = "ObjectSizeLimitError";
  }
}
