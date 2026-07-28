import { v1 as secretManagerV1 } from "@google-cloud/secret-manager";
import { OAuth2Client } from "google-auth-library";

import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
} from "./types";
import {
  available,
  gcpSecretName,
  invalid,
  isSafeGcpProjectId,
  isSafeGcpSecretId,
  misconfigured,
  parseManagedSecretRef,
  sdkFailure,
  secretEmpty,
  unsupported,
  type ManagedSecretRef,
} from "./secret-support";

export interface GcpSecretManagerResolverOptions {
  accessToken: string;
  clientFactory?: GcpSecretManagerSdkClientFactory;
  projectId: string;
  timeoutMs?: number;
}

export interface GcpSecretManagerSdkClient {
  checkSecret(secretName: string, timeoutMs: number): Promise<void>;
  accessSecretValue(
    secretVersionName: string,
    timeoutMs: number,
  ): Promise<string | undefined>;
}

export interface GcpSecretManagerSdkClientOptions {
  accessToken: string;
  projectId: string;
}

export type GcpSecretManagerSdkClientFactory = (
  options: GcpSecretManagerSdkClientOptions,
) => GcpSecretManagerSdkClient;

const defaultGcpClientFactory: GcpSecretManagerSdkClientFactory = (options) => {
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: options.accessToken });
  const client = new secretManagerV1.SecretManagerServiceClient({
    authClient,
    fallback: true,
    projectId: options.projectId,
  });
  return {
    async checkSecret(secretName, timeoutMs) {
      await client.getSecret({ name: secretName }, { timeout: timeoutMs });
    },
    async accessSecretValue(secretVersionName, timeoutMs) {
      const [version] = await client.accessSecretVersion(
        { name: secretVersionName },
        { timeout: timeoutMs },
      );
      const data = version.payload?.data;
      if (data === undefined || data === null) return undefined;
      const value = Buffer.from(data).toString("utf8");
      return value.length === 0 ? undefined : value;
    },
  };
};

export class GcpSecretManagerResolver implements SecretResolver {
  private readonly clientFactory: GcpSecretManagerSdkClientFactory;
  private readonly timeoutMs: number;

  constructor(private readonly options: GcpSecretManagerResolverOptions) {
    this.clientFactory = options.clientFactory ?? defaultGcpClientFactory;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    const validation = this.validate(parsed);
    if (validation !== undefined) return validation;
    try {
      await this.client().checkSecret(
        gcpSecretName(this.options.projectId, parsed.path),
        this.timeoutMs,
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
      const value = await this.client().accessSecretValue(
        `${gcpSecretName(this.options.projectId, parsed.path)}/versions/latest`,
        this.timeoutMs,
      );
      return value === undefined
        ? secretEmpty(parsed.scheme)
        : { available: true, scheme: parsed.scheme, value };
    } catch (caught) {
      return sdkFailure(parsed.scheme, caught);
    }
  }

  private client(): GcpSecretManagerSdkClient {
    return this.clientFactory({
      accessToken: this.options.accessToken,
      projectId: this.options.projectId,
    });
  }

  private validate(parsed: ManagedSecretRef): SecretAvailability | undefined {
    if (parsed.scheme !== "gcp-sm") return unsupported(parsed.scheme);
    if (
      this.options.accessToken.length === 0 ||
      this.options.projectId.length === 0
    ) {
      return misconfigured(parsed.scheme);
    }
    return isSafeGcpSecretId(parsed.path) &&
      isSafeGcpProjectId(this.options.projectId)
      ? undefined
      : invalid(parsed.scheme);
  }
}
