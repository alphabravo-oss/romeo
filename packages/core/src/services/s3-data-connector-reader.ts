import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import { ApiError } from "../errors";
import { requirePublicApiErrorCode } from "../public-api-error-registry";
import type {
  S3ConnectorObject,
  S3ConnectorReader,
  S3ConnectorReadResult,
} from "./data-connector-executors";
import type { SecretResolver } from "./secret-resolver";

export interface S3HttpConnectorReaderOptions {
  accessKeyId: string;
  clientFactory?: (config: S3ClientConfig) => S3Client;
  endpoint: string;
  retryAttempts?: number;
  secretResolver?: SecretResolver;
  secretAccessKey: string;
  timeoutMs?: number;
}

interface S3ReaderCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3HttpConnectorReader implements S3ConnectorReader {
  private readonly clientFactory: (config: S3ClientConfig) => S3Client;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: S3HttpConnectorReaderOptions) {
    this.clientFactory =
      options.clientFactory ?? ((config) => new S3Client(config));
    this.maxAttempts = Math.max(1, (options.retryAttempts ?? 1) + 1);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async listObjects(input: {
    bucket: string;
    maxKeys: number;
    prefix: string;
    region: string;
    secretRef?: string;
  }): Promise<S3ConnectorObject[]> {
    const maxKeys = Math.max(1, Math.min(input.maxKeys, 1_000));
    const client = await this.client(input.region, input.secretRef);
    try {
      const command = new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        MaxKeys: maxKeys,
      });
      const response = await this.execute(
        (abortSignal) => client.send(command, { abortSignal }),
        "connector_s3_list_failed",
      );
      if (response.IsTruncated === true) {
        throw new ApiError(
          "connector_item_limit_exceeded",
          "S3 connector returned too many objects.",
          413,
          { maxItems: maxKeys },
        );
      }
      return (response.Contents ?? []).flatMap((object) => {
        if (object.Key === undefined || object.Key.length === 0) return [];
        return [
          {
            key: object.Key,
            ...(object.Size === undefined ? {} : { sizeBytes: object.Size }),
          },
        ];
      });
    } finally {
      client.destroy();
    }
  }

  async getObject(input: {
    bucket: string;
    key: string;
    region: string;
    secretRef?: string;
  }): Promise<S3ConnectorReadResult | undefined> {
    const client = await this.client(input.region, input.secretRef);
    try {
      let response;
      try {
        const command = new GetObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
        });
        response = await this.execute(
          (abortSignal) => client.send(command, { abortSignal }),
          "connector_s3_get_failed",
        );
      } catch (caught) {
        if (isNotFound(caught)) return undefined;
        throw caught;
      }
      if (response.Body === undefined) {
        throw new ApiError(
          "connector_s3_get_failed",
          "S3 connector object response has no body.",
          502,
        );
      }
      const body = await response.Body.transformToByteArray();
      return {
        body,
        ...(response.ContentType === undefined
          ? {}
          : { contentType: response.ContentType }),
      };
    } finally {
      client.destroy();
    }
  }

  private async client(
    region: string,
    secretRef: string | undefined,
  ): Promise<S3Client> {
    const credentials = await this.credentials(secretRef);
    return this.clientFactory({
      endpoint: this.options.endpoint,
      region,
      forcePathStyle: true,
      maxAttempts: this.maxAttempts,
      credentials,
    });
  }

  private async execute<Output>(
    request: (abortSignal: AbortSignal) => Promise<Output>,
    errorCode: string,
  ): Promise<Output> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await request(controller.signal);
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      const status = awsStatus(caught);
      const error = new ApiError(
        requirePublicApiErrorCode(errorCode),
        "S3 connector request failed.",
        502,
        status === undefined ? undefined : { status },
      );
      if (status === 404)
        (error as ApiError & { cause?: unknown }).cause = caught;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async credentials(
    secretRef: string | undefined,
  ): Promise<S3ReaderCredentials> {
    if (secretRef !== undefined) return this.connectorCredentials(secretRef);
    if (
      this.options.accessKeyId.length === 0 ||
      this.options.secretAccessKey.length === 0
    ) {
      throw new ApiError(
        "connector_s3_reader_not_configured",
        "S3 connector reader credentials are not configured.",
        409,
      );
    }
    return {
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
    };
  }

  private async connectorCredentials(
    secretRef: string,
  ): Promise<S3ReaderCredentials> {
    if (this.options.secretResolver?.resolveValue === undefined) {
      throw new ApiError(
        "connector_s3_secret_ref_unsupported",
        "S3 connector secret references require a value-capable secret resolver.",
        409,
      );
    }
    const resolution =
      await this.options.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "connector_s3_secret_ref_unavailable",
        "S3 connector secret reference is unavailable.",
        409,
        {
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          secretRefScheme: resolution.scheme,
        },
      );
    }
    return parseS3CredentialSecret(resolution.value);
  }
}

function parseS3CredentialSecret(value: string): S3ReaderCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidCredentialSecret();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw invalidCredentialSecret();
  const accessKeyId = (parsed as { accessKeyId?: unknown }).accessKeyId;
  const secretAccessKey = (parsed as { secretAccessKey?: unknown })
    .secretAccessKey;
  if (
    typeof accessKeyId !== "string" ||
    accessKeyId.length === 0 ||
    typeof secretAccessKey !== "string" ||
    secretAccessKey.length === 0
  ) {
    throw invalidCredentialSecret();
  }
  return { accessKeyId, secretAccessKey };
}

function invalidCredentialSecret(): ApiError {
  return new ApiError(
    "connector_s3_secret_ref_invalid",
    "S3 connector secret must be JSON with accessKeyId and secretAccessKey.",
    400,
  );
}

function awsStatus(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const metadata = (value as { $metadata?: { httpStatusCode?: unknown } })
    .$metadata;
  return typeof metadata?.httpStatusCode === "number"
    ? metadata.httpStatusCode
    : undefined;
}

function isNotFound(value: unknown): boolean {
  if (value instanceof ApiError) {
    return (value.details as { status?: unknown } | undefined)?.status === 404;
  }
  return awsStatus(value) === 404;
}
