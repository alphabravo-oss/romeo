import { Client as VaultClient } from "@litehex/node-vault";

import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
  SecretWriteResult,
  SecretWriter,
} from "./types";
import {
  available,
  extractVaultSecretValue,
  invalid,
  isSafeVaultAddress,
  isSafeVaultPath,
  misconfigured,
  normalizeVaultPath,
  normalizedOptional,
  parseManagedSecretRef,
  sdkFailure,
  secretEmpty,
  unsupported,
  unwrapVaultResult,
  writeFailure,
  writerFailureCode,
  type ManagedSecretRef,
} from "./secret-support";

export interface VaultSdkClient {
  checkSecret(path: string, signal: AbortSignal): Promise<void>;
  getSecretValue(
    path: string,
    signal: AbortSignal,
  ): Promise<string | undefined>;
  writeSecret(path: string, value: string, signal: AbortSignal): Promise<void>;
}

export interface VaultSdkClientOptions {
  address: string;
  fetchImpl?: typeof fetch;
  kvMount: string;
  namespace?: string;
  token: string;
}

export type VaultSdkClientFactory = (
  options: VaultSdkClientOptions,
) => VaultSdkClient;

export interface VaultSecretResolverOptions {
  address: string;
  clientFactory?: VaultSdkClientFactory;
  fetchImpl?: typeof fetch;
  kvMount?: string;
  namespace?: string;
  timeoutMs?: number;
  token: string;
}

export type VaultSecretWriterOptions = VaultSecretResolverOptions;

const defaultVaultClientFactory: VaultSdkClientFactory = (options) => {
  const client = new VaultClient({
    endpoint: options.address,
    token: options.token,
    ...(options.namespace === undefined
      ? {}
      : { namespace: options.namespace }),
    ...(options.fetchImpl === undefined ? {} : { fetcher: options.fetchImpl }),
  });
  return {
    async checkSecret(path, signal) {
      unwrapVaultResult(
        await client.kv2.readMetadata(
          { mountPath: options.kvMount, path },
          { signal, strictSchema: false },
        ),
      );
    },
    async getSecretValue(path, signal) {
      const result = unwrapVaultResult(
        await client.kv2.read(
          { mountPath: options.kvMount, path },
          { signal, strictSchema: false },
        ),
      );
      return extractVaultSecretValue(result.data.data);
    },
    async writeSecret(path, value, signal) {
      unwrapVaultResult(
        await client.kv2.write(
          { mountPath: options.kvMount, path, data: { value } },
          { signal, strictSchema: false },
        ),
      );
    },
  };
};

export class VaultSecretResolver implements SecretResolver {
  private readonly clientFactory: VaultSdkClientFactory;
  private readonly kvMount: string;
  private readonly namespace: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: VaultSecretResolverOptions) {
    this.clientFactory = options.clientFactory ?? defaultVaultClientFactory;
    this.kvMount = normalizeVaultPath(options.kvMount ?? "secret");
    this.namespace = normalizedOptional(options.namespace);
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    const validation = this.validate(parsed);
    if (validation !== undefined) return validation;
    try {
      await this.client().checkSecret(
        normalizeVaultPath(parsed.path),
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
        normalizeVaultPath(parsed.path),
        AbortSignal.timeout(this.timeoutMs),
      );
      return value === undefined
        ? secretEmpty(parsed.scheme)
        : { available: true, scheme: parsed.scheme, value };
    } catch (caught) {
      return sdkFailure(parsed.scheme, caught);
    }
  }

  private client(): VaultSdkClient {
    return this.clientFactory(this.clientOptions());
  }

  private clientOptions(): VaultSdkClientOptions {
    return {
      address: this.options.address,
      token: this.options.token,
      kvMount: this.kvMount,
      ...(this.namespace === undefined ? {} : { namespace: this.namespace }),
      ...(this.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.options.fetchImpl }),
    };
  }

  private validate(parsed: ManagedSecretRef): SecretAvailability | undefined {
    if (parsed.scheme !== "vault") return unsupported(parsed.scheme);
    if (this.options.address.length === 0 || this.options.token.length === 0) {
      return misconfigured(parsed.scheme);
    }
    return isSafeVaultAddress(this.options.address) &&
      isSafeVaultPath(this.kvMount) &&
      isSafeVaultPath(normalizeVaultPath(parsed.path))
      ? undefined
      : invalid(parsed.scheme);
  }
}

export class VaultSecretWriter implements SecretWriter {
  private readonly clientFactory: VaultSdkClientFactory;
  private readonly kvMount: string;
  private readonly namespace: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: VaultSecretWriterOptions) {
    this.clientFactory = options.clientFactory ?? defaultVaultClientFactory;
    this.kvMount = normalizeVaultPath(options.kvMount ?? "secret");
    this.namespace = normalizedOptional(options.namespace);
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async write(input: {
    secretRef: string;
    value: string;
  }): Promise<SecretWriteResult> {
    const parsed = parseManagedSecretRef(input.secretRef);
    if (parsed.scheme !== "vault") {
      return writeFailure(
        input.secretRef,
        parsed.scheme,
        "secret_scheme_unsupported",
      );
    }
    if (this.options.address.length === 0 || this.options.token.length === 0) {
      return writeFailure(
        input.secretRef,
        parsed.scheme,
        "secret_writer_misconfigured",
      );
    }
    if (
      !isSafeVaultAddress(this.options.address) ||
      !isSafeVaultPath(this.kvMount) ||
      !isSafeVaultPath(normalizeVaultPath(parsed.path))
    ) {
      return writeFailure(input.secretRef, parsed.scheme, "invalid_secret_ref");
    }
    try {
      await this.client().writeSecret(
        normalizeVaultPath(parsed.path),
        input.value,
        AbortSignal.timeout(this.timeoutMs),
      );
      return {
        scheme: parsed.scheme,
        secretRef: input.secretRef,
        stored: true,
      };
    } catch (caught) {
      return writeFailure(
        input.secretRef,
        parsed.scheme,
        writerFailureCode(sdkFailure(parsed.scheme, caught).failureCode),
      );
    }
  }

  private client(): VaultSdkClient {
    return this.clientFactory({
      address: this.options.address,
      token: this.options.token,
      kvMount: this.kvMount,
      ...(this.namespace === undefined ? {} : { namespace: this.namespace }),
      ...(this.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.options.fetchImpl }),
    });
  }
}
