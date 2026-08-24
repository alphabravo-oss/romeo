import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type { ObjectStoreReadinessResult } from "./types";

export interface S3ReadinessPolicy {
  requireEncryption: boolean;
  requireLifecycle: boolean;
  requireReplication: boolean;
  requireVersioning: boolean;
  timeoutMs: number;
}

export interface S3ReadinessConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  readiness?: Partial<S3ReadinessPolicy>;
  region?: string;
  secretAccessKey: string;
}

type S3ReadinessCommand =
  | DeleteObjectCommand
  | GetBucketEncryptionCommand
  | GetBucketLifecycleConfigurationCommand
  | GetBucketReplicationCommand
  | GetBucketVersioningCommand
  | GetObjectCommand
  | HeadBucketCommand
  | HeadObjectCommand
  | PutObjectCommand;

export interface S3ReadinessClient {
  destroy(): void;
  send(
    command: S3ReadinessCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

export type S3ReadinessClientFactory = (
  config: S3ReadinessConfig,
) => S3ReadinessClient;

const defaultPolicy: S3ReadinessPolicy = {
  requireEncryption: true,
  requireLifecycle: true,
  requireReplication: false,
  requireVersioning: true,
  timeoutMs: 5_000,
};

/**
 * Runs authenticated bucket-policy and reversible data-plane probes. Returned
 * evidence is deliberately boolean-only: bucket, endpoint, key, and provider
 * error details never cross the readiness boundary.
 */
export async function checkS3Readiness(
  config: S3ReadinessConfig,
  clientFactory: S3ReadinessClientFactory = createS3ReadinessClient,
  parentSignal?: AbortSignal,
): Promise<ObjectStoreReadinessResult> {
  const policy = { ...defaultPolicy, ...config.readiness };
  let tlsEnabled = false;
  try {
    tlsEnabled = new URL(config.endpoint).protocol === "https:";
  } catch (cause) {
    throw new Error("S3 readiness probe endpoint is invalid.", { cause });
  }
  if (!tlsEnabled)
    throw new Error("S3 readiness probe requires an HTTPS endpoint.");
  let client: S3ReadinessClient;
  try {
    client = clientFactory(config);
  } catch (cause) {
    throw new Error("S3 readiness probe could not initialize.", { cause });
  }
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
  const key = `.romeo-readiness/${crypto.randomUUID()}`;
  const expected = crypto.getRandomValues(new Uint8Array(32));
  let putCompleted = false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
      abortSignal: controller.signal,
    });
    const [
      encryptionConfigured,
      versioningEnabled,
      lifecycleConfigured,
      replicationConfigured,
    ] = await Promise.all([
      bucketEncryptionConfigured(client, config.bucket, controller.signal),
      bucketVersioningEnabled(client, config.bucket, controller.signal),
      bucketLifecycleConfigured(client, config.bucket, controller.signal),
      bucketReplicationConfigured(client, config.bucket, controller.signal),
    ]);

    await client.send(
      new PutObjectCommand({
        Body: expected,
        Bucket: config.bucket,
        ContentType: "application/octet-stream",
        Key: key,
      }),
      { abortSignal: controller.signal },
    );
    putCompleted = true;
    const read = (await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: controller.signal },
    )) as {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
      ContentLength?: number;
    };
    if (read.Body === undefined || read.ContentLength !== expected.byteLength) {
      throw new Error("S3 readiness read response was not bounded.");
    }
    const actual = await read.Body.transformToByteArray();
    const readAfterWriteVerified =
      actual.byteLength === expected.byteLength && equalBytes(actual, expected);
    if (!readAfterWriteVerified)
      throw new Error("S3 readiness read-after-write verification failed.");

    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: controller.signal },
    );
    putCompleted = false;
    const deleteVerified = await objectAbsent(
      client,
      config.bucket,
      key,
      controller.signal,
    );
    const ready =
      tlsEnabled &&
      readAfterWriteVerified &&
      deleteVerified &&
      (!policy.requireEncryption || encryptionConfigured) &&
      (!policy.requireVersioning || versioningEnabled) &&
      (!policy.requireLifecycle || lifecycleConfigured) &&
      (!policy.requireReplication || replicationConfigured);
    return {
      authenticated: true,
      deleteVerified,
      encryptionConfigured,
      lifecycleConfigured,
      readAfterWriteVerified,
      ready,
      replicationConfigured,
      tlsEnabled,
      versioningEnabled,
      writeVerified: true,
    };
  } catch (error) {
    if (putCompleted) await bestEffortDelete(client, config.bucket, key);
    throw new Error(
      controller.signal.aborted
        ? "S3 readiness probe timed out."
        : "S3 readiness probe failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
    client.destroy();
  }
}

function createS3ReadinessClient(config: S3ReadinessConfig): S3ReadinessClient {
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  const client = new S3Client(clientConfig);
  return {
    destroy: () => client.destroy(),
    send: (command, options) =>
      (
        client.send as unknown as (
          command: S3ReadinessCommand,
          options?: { abortSignal?: AbortSignal },
        ) => Promise<unknown>
      )(command, options),
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function bucketEncryptionConfigured(
  client: S3ReadinessClient,
  bucket: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const output = (await client.send(
      new GetBucketEncryptionCommand({ Bucket: bucket }),
      { abortSignal: signal },
    )) as {
      ServerSideEncryptionConfiguration?: {
        Rules?: Array<{
          ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: string };
        }>;
      };
    };
    return (
      output.ServerSideEncryptionConfiguration?.Rules?.some((rule) =>
        ["AES256", "aws:kms", "aws:kms:dsse"].includes(
          rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? "",
        ),
      ) === true
    );
  } catch (error) {
    if (
      missingConfiguration(error, [
        "ServerSideEncryptionConfigurationNotFoundError",
      ])
    )
      return false;
    throw error;
  }
}

async function bucketVersioningEnabled(
  client: S3ReadinessClient,
  bucket: string,
  signal: AbortSignal,
): Promise<boolean> {
  const output = (await client.send(
    new GetBucketVersioningCommand({ Bucket: bucket }),
    { abortSignal: signal },
  )) as { Status?: string };
  return output.Status === "Enabled";
}

async function bucketLifecycleConfigured(
  client: S3ReadinessClient,
  bucket: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const output = (await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
      { abortSignal: signal },
    )) as {
      Rules?: Array<{
        AbortIncompleteMultipartUpload?: unknown;
        Expiration?: unknown;
        NoncurrentVersionExpiration?: unknown;
        Status?: string;
      }>;
    };
    return (
      output.Rules?.some(
        (rule) =>
          rule.Status === "Enabled" &&
          (rule.Expiration !== undefined ||
            rule.NoncurrentVersionExpiration !== undefined ||
            rule.AbortIncompleteMultipartUpload !== undefined),
      ) === true
    );
  } catch (error) {
    if (missingConfiguration(error, ["NoSuchLifecycleConfiguration"]))
      return false;
    throw error;
  }
}

async function bucketReplicationConfigured(
  client: S3ReadinessClient,
  bucket: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const output = (await client.send(
      new GetBucketReplicationCommand({ Bucket: bucket }),
      { abortSignal: signal },
    )) as {
      ReplicationConfiguration?: {
        Role?: string;
        Rules?: Array<{ Status?: string }>;
      };
    };
    const configuration = output.ReplicationConfiguration;
    return (
      configuration?.Role !== undefined &&
      configuration.Rules?.some((rule) => rule.Status === "Enabled") === true
    );
  } catch (error) {
    if (missingConfiguration(error, ["ReplicationConfigurationNotFoundError"]))
      return false;
    throw error;
  }
}

async function objectAbsent(
  client: S3ReadinessClient,
  bucket: string,
  key: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: signal,
    });
    return false;
  } catch (error) {
    if (httpStatus(error) === 404 || errorName(error) === "NotFound")
      return true;
    throw error;
  }
}

async function bestEffortDelete(
  client: S3ReadinessClient,
  bucket: string,
  key: string,
): Promise<void> {
  const signal = AbortSignal.timeout(2_000);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: signal,
    });
  } catch {
    // The public error remains sanitized; lifecycle policy is the cleanup backstop.
  }
}

function missingConfiguration(error: unknown, names: string[]): boolean {
  return names.includes(errorName(error)) || httpStatus(error) === 404;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata = (error as { $metadata?: unknown }).$metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const status = (metadata as { httpStatusCode?: unknown }).httpStatusCode;
  return typeof status === "number" ? status : undefined;
}
