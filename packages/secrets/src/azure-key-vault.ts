import { SecretClient } from "@azure/keyvault-secrets";

import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
} from "./types";
import {
  available,
  invalid,
  isSafeAzureSecretName,
  isSafeAzureVaultUrl,
  misconfigured,
  parseManagedSecretRef,
  sdkFailure,
  secretEmpty,
  unsupported,
  type ManagedSecretRef,
} from "./secret-support";

export interface AzureKeyVaultSdkClient {
  checkSecret(secretName: string, signal: AbortSignal): Promise<void>;
  getSecretValue(
    secretName: string,
    signal: AbortSignal,
  ): Promise<string | undefined>;
}

export interface AzureKeyVaultSdkClientOptions {
  accessToken: string;
  vaultUrl: string;
}

export type AzureKeyVaultSdkClientFactory = (
  options: AzureKeyVaultSdkClientOptions,
) => AzureKeyVaultSdkClient;

export interface AzureKeyVaultResolverOptions extends AzureKeyVaultSdkClientOptions {
  clientFactory?: AzureKeyVaultSdkClientFactory;
  timeoutMs?: number;
}

const defaultAzureClientFactory: AzureKeyVaultSdkClientFactory = (options) => {
  const credential = {
    async getToken() {
      return {
        token: options.accessToken,
        expiresOnTimestamp: Date.now() + 5 * 60_000,
      };
    },
  };
  const client = new SecretClient(options.vaultUrl, credential);
  return {
    async checkSecret(secretName, signal) {
      const iterator = client
        .listPropertiesOfSecretVersions(secretName, { abortSignal: signal })
        [Symbol.asyncIterator]();
      await iterator.next();
    },
    async getSecretValue(secretName, signal) {
      const secret = await client.getSecret(secretName, {
        abortSignal: signal,
      });
      return typeof secret.value === "string" && secret.value.length > 0
        ? secret.value
        : undefined;
    },
  };
};

export class AzureKeyVaultResolver implements SecretResolver {
  private readonly clientFactory: AzureKeyVaultSdkClientFactory;
  private readonly timeoutMs: number;

  constructor(private readonly options: AzureKeyVaultResolverOptions) {
    this.clientFactory = options.clientFactory ?? defaultAzureClientFactory;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    const validation = this.validate(parsed);
    if (validation !== undefined) return validation;
    try {
      await this.client().checkSecret(
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

  private client(): AzureKeyVaultSdkClient {
    return this.clientFactory({
      accessToken: this.options.accessToken,
      vaultUrl: this.options.vaultUrl,
    });
  }

  private validate(parsed: ManagedSecretRef): SecretAvailability | undefined {
    if (parsed.scheme !== "azure-kv") return unsupported(parsed.scheme);
    if (
      this.options.accessToken.length === 0 ||
      this.options.vaultUrl.length === 0
    ) {
      return misconfigured(parsed.scheme);
    }
    return isSafeAzureSecretName(parsed.path) &&
      isSafeAzureVaultUrl(this.options.vaultUrl)
      ? undefined
      : invalid(parsed.scheme);
  }
}
