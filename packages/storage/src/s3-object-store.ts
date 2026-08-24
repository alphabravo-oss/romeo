import { createS3PresignedRequest } from "./s3-signer";
import {
  checkS3Readiness,
  type S3ReadinessClientFactory,
  type S3ReadinessConfig,
} from "./s3-readiness";
import type {
  ObjectStore,
  PresignedUpload,
  PutObjectInput,
  StoredObject,
} from "./types";
import { ObjectSizeLimitError } from "./types";

export type S3ObjectStoreConfig = S3ReadinessConfig;

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly config: S3ObjectStoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly readinessClientFactory?: S3ReadinessClientFactory,
  ) {}

  checkReadiness(signal?: AbortSignal) {
    return checkS3Readiness(this.config, this.readinessClientFactory, signal);
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const upload = await this.createPresignedUpload({
      key: input.key,
      contentType: input.contentType,
      expiresInSeconds: 900,
    });
    const response = await this.fetchImpl(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: toArrayBuffer(input.body),
    });
    if (!response.ok)
      throw new Error(`Object upload failed with ${response.status}.`);

    return {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      etag:
        normalizeEtag(response.headers.get("etag")) ??
        (await objectEtag(input.body)),
      updatedAt: new Date().toISOString(),
    };
  }

  async getObject(
    key: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<Uint8Array | undefined> {
    const request = await this.presign({
      key,
      method: "GET",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, {
      method: "GET",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Object read failed with ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      options.maxBytes !== undefined &&
      Number.isFinite(declaredLength) &&
      declaredLength > options.maxBytes
    ) {
      await response.body?.cancel();
      throw new ObjectSizeLimitError(options.maxBytes);
    }
    return readResponseBytes(response, options.maxBytes);
  }

  async getObjectStream(
    key: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<ReadableStream<Uint8Array> | undefined> {
    const request = await this.presign({
      key,
      method: "GET",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, {
      method: "GET",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Object read failed with ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      options.maxBytes !== undefined &&
      Number.isFinite(declaredLength) &&
      declaredLength > options.maxBytes
    ) {
      await response.body?.cancel();
      throw new ObjectSizeLimitError(options.maxBytes);
    }
    return response.body === null
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        })
      : boundedObjectStream(response.body, options.maxBytes);
  }

  async headObject(key: string): Promise<StoredObject | undefined> {
    const request = await this.presign({
      key,
      method: "HEAD",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, { method: "HEAD" });
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Object metadata read failed with ${response.status}.`);
    const sizeBytes = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
      throw new Error("Object metadata did not include a valid byte length.");
    return {
      key,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      sizeBytes,
      etag: normalizeEtag(response.headers.get("etag")) ?? "",
      updatedAt:
        response.headers.get("last-modified") ?? new Date().toISOString(),
    };
  }

  async deleteObject(key: string): Promise<void> {
    const request = await this.presign({
      key,
      method: "DELETE",
      expiresInSeconds: 300,
    });
    const response = await this.fetchImpl(request.url, { method: "DELETE" });
    if (!response.ok && response.status !== 404)
      throw new Error(`Object delete failed with ${response.status}.`);
  }

  async createPresignedUpload(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
    sha256?: string;
    sizeBytes?: number;
  }): Promise<PresignedUpload> {
    const checksumSha256 = checksumSha256FromHex(input.sha256);
    const request = await this.presign({
      key: input.key,
      method: "PUT",
      contentType: input.contentType,
      ...(input.sizeBytes === undefined
        ? {}
        : { contentLength: input.sizeBytes }),
      ...(checksumSha256 === undefined ? {} : { checksumSha256 }),
      expiresInSeconds: input.expiresInSeconds,
    });
    return {
      key: input.key,
      url: request.url,
      method: "PUT",
      expiresAt: request.expiresAt,
      headers: request.headers,
    };
  }

  private presign(input: {
    checksumSha256?: string;
    contentLength?: number;
    contentType?: string;
    expiresInSeconds: number;
    key: string;
    method: "DELETE" | "GET" | "HEAD" | "PUT";
  }) {
    return createS3PresignedRequest({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      key: input.key,
      method: input.method,
      region: this.config.region ?? "us-east-1",
      secretAccessKey: this.config.secretAccessKey,
      expiresInSeconds: input.expiresInSeconds,
      ...(input.contentLength === undefined
        ? {}
        : { contentLength: input.contentLength }),
      ...(input.contentType !== undefined
        ? { contentType: input.contentType }
        : {}),
      ...(input.checksumSha256 === undefined
        ? {}
        : { checksumSha256: input.checksumSha256 }),
    });
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number | undefined,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (maxBytes !== undefined && total > maxBytes) {
        await reader.cancel();
        throw new ObjectSizeLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function boundedObjectStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number | undefined,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        total += value.byteLength;
        if (maxBytes !== undefined && total > maxBytes) {
          await reader.cancel();
          controller.error(new ObjectSizeLimitError(maxBytes));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function objectEtag(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function checksumSha256FromHex(value: string | undefined): string | undefined {
  const hex = value?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{64}$/u.test(hex)) return undefined;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytesToBase64(bytes);
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)];
    encoded +=
      second === undefined
        ? "="
        : BASE64_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[third & 63];
  }
  return encoded;
}

function normalizeEtag(value: string | null): string | undefined {
  return value?.replace(/^"|"$/g, "");
}
