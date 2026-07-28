import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
} from "./types";
import {
  available,
  invalid,
  isSafeCloudPath,
  misconfigured,
  parseManagedSecretRef,
  sdkFailure,
  secretEmpty,
  unsupported,
  type ManagedSecretRef,
} from "./secret-support";

export interface AwsSecretsManagerSdkClient {
  describeSecret(secretId: string, signal: AbortSignal): Promise<void>;
  getSecretValue(
    secretId: string,
    signal: AbortSignal,
  ): Promise<string | undefined>;
}

export interface AwsSecretsManagerSdkClientOptions {
  accessKeyId: string;
  region: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type AwsSecretsManagerSdkClientFactory = (
  options: AwsSecretsManagerSdkClientOptions,
) => AwsSecretsManagerSdkClient;

export interface AwsSecretsManagerResolverOptions extends AwsSecretsManagerSdkClientOptions {
  clientFactory?: AwsSecretsManagerSdkClientFactory;
  timeoutMs?: number;
}

const defaultAwsClientFactory: AwsSecretsManagerSdkClientFactory = (
  options,
) => {
  const client = new SecretsManagerClient({
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      ...(options.sessionToken === undefined
        ? {}
        : { sessionToken: options.sessionToken }),
    },
  });
  return {
    async describeSecret(secretId, signal) {
      await client.send(new DescribeSecretCommand({ SecretId: secretId }), {
        abortSignal: signal,
      });
    },
    async getSecretValue(secretId, signal) {
      const response = await client.send(
        new GetSecretValueCommand({ SecretId: secretId }),
        { abortSignal: signal },
      );
      if (
        typeof response.SecretString === "string" &&
        response.SecretString.length > 0
      ) {
        return response.SecretString;
      }
      if (response.SecretBinary !== undefined) {
        const value = Buffer.from(response.SecretBinary).toString("utf8");
        return value.length === 0 ? undefined : value;
      }
      return undefined;
    },
  };
};

export class AwsSecretsManagerResolver implements SecretResolver {
  private readonly clientFactory: AwsSecretsManagerSdkClientFactory;
  private readonly timeoutMs: number;

  constructor(private readonly options: AwsSecretsManagerResolverOptions) {
    this.clientFactory = options.clientFactory ?? defaultAwsClientFactory;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    const validation = this.validate(parsed);
    if (validation !== undefined) return validation;
    try {
      await this.client().describeSecret(
        parsed.path,
        AbortSignal.timeout(this.timeoutMs),
      );
      return available(parsed.scheme);
    } catch (caught) {
      return sdkFailure(parsed.scheme, caught);
    }
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    const validation = this.validate(parsed);
    if (validation !== undefined) return validation;
    try {
      const value = await this.client().getSecretValue(
        parsed.path,
        AbortSignal.timeout(this.timeoutMs),
      );
      return value === undefined
        ? secretEmpty(parsed.scheme)
        : { available: true, scheme: parsed.scheme, value };
    } catch (caught) {
      return sdkFailure(parsed.scheme, caught);
    }
  }

  private client(): AwsSecretsManagerSdkClient {
    return this.clientFactory({
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.options.region,
      ...(this.options.sessionToken === undefined
        ? {}
        : { sessionToken: this.options.sessionToken }),
    });
  }

  private validate(parsed: ManagedSecretRef): SecretAvailability | undefined {
    if (parsed.scheme !== "aws-sm") return unsupported(parsed.scheme);
    if (
      this.options.accessKeyId.length === 0 ||
      this.options.secretAccessKey.length === 0 ||
      this.options.region.length === 0
    ) {
      return misconfigured(parsed.scheme);
    }
    return isSafeCloudPath(parsed.path) ? undefined : invalid(parsed.scheme);
  }
}
