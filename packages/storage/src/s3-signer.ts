import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3PresignInput {
  accessKeyId: string;
  bucket: string;
  contentType?: string;
  contentLength?: number;
  endpoint: string;
  expiresInSeconds: number;
  key: string;
  method: "DELETE" | "GET" | "HEAD" | "PUT";
  now?: Date;
  query?: Record<string, string | undefined>;
  region: string;
  secretAccessKey: string;
}

export interface S3PresignedRequest {
  expiresAt: string;
  headers: Record<string, string>;
  url: string;
}

/**
 * Creates an AWS Signature V4 URL through the official modular AWS SDK.
 *
 * Romeo owns the narrow operation policy; the SDK owns endpoint resolution,
 * canonicalization, signing parameters, credentials, and signature generation.
 */
export async function createS3PresignedRequest(
  input: S3PresignInput,
): Promise<S3PresignedRequest> {
  const now = input.now ?? new Date();
  const client = new S3Client(s3ClientConfig(input));
  try {
    const url = await presignedUrl(client, input, now);
    return {
      expiresAt: new Date(
        now.getTime() + input.expiresInSeconds * 1000,
      ).toISOString(),
      headers:
        input.contentType === undefined
          ? {}
          : { "content-type": input.contentType },
      url,
    };
  } finally {
    client.destroy();
  }
}

function s3ClientConfig(input: S3PresignInput): S3ClientConfig {
  return {
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  };
}

function presignOptions(input: S3PresignInput, now: Date) {
  return { expiresIn: input.expiresInSeconds, signingDate: now };
}

async function presignedUrl(
  client: S3Client,
  input: S3PresignInput,
  now: Date,
): Promise<string> {
  if (input.method === "PUT") {
    assertNoQuery(input.query);
    return getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ...(input.contentLength === undefined
          ? {}
          : { ContentLength: input.contentLength }),
        ...(input.contentType === undefined
          ? {}
          : { ContentType: input.contentType }),
      }),
      presignOptions(input, now),
    );
  }
  if (input.method === "DELETE") {
    assertNoQuery(input.query);
    return getSignedUrl(
      client,
      new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
      presignOptions(input, now),
    );
  }
  if (input.method === "HEAD") {
    assertNoQuery(input.query);
    return getSignedUrl(
      client,
      new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
      presignOptions(input, now),
    );
  }
  if (input.query?.["list-type"] === "2") {
    assertListQuery(input.query);
    const maxKeys = Number(input.query["max-keys"]);
    return getSignedUrl(
      client,
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.query.prefix ?? "",
        ...(Number.isInteger(maxKeys) ? { MaxKeys: maxKeys } : {}),
      }),
      presignOptions(input, now),
    );
  }
  assertNoQuery(input.query);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
    presignOptions(input, now),
  );
}

function assertNoQuery(
  query: Record<string, string | undefined> | undefined,
): void {
  if (query === undefined) return;
  const presentKeys = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (presentKeys.some((key) => key.toLowerCase().startsWith("x-amz-"))) {
    throw new Error("S3 presigned query cannot override signing parameters.");
  }
  if (presentKeys.length > 0) {
    throw new Error("Unsupported S3 presign query parameters.");
  }
}

function assertListQuery(query: Record<string, string | undefined>): void {
  const allowed = new Set(["list-type", "max-keys", "prefix"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new Error("Unsupported S3 list query parameters.");
  }
}
