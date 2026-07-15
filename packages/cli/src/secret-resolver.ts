import {
  AwsSecretValueResolver,
  AzureSecretValueResolver,
  CloudSecretValueResolver,
  GcpSecretValueResolver,
} from "./cloud-secret-resolver";
import { parseManagedSecretRef } from "./managed-secret-ref";
import { VaultSecretValueResolver } from "./vault-secret-resolver";

export interface SecretValueResolution {
  available: boolean;
  failureCode?: string;
  scheme: string;
  value?: string;
}

export interface SecretValueResolver {
  resolveValue(secretRef: string): Promise<SecretValueResolution>;
}

export type SecretValueResolverDriver =
  | "aws-sm"
  | "azure-kv"
  | "cloud"
  | "disabled"
  | "env"
  | "gcp-sm"
  | "vault";

export interface CreateSecretValueResolverOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export const disabledSecretValueResolver: SecretValueResolver = {
  async resolveValue(secretRef) {
    const parsed = parseManagedSecretRef(secretRef);
    return {
      available: false,
      failureCode: "secret_resolver_disabled",
      scheme: parsed.scheme,
    };
  },
};

export class EnvironmentSecretValueResolver implements SecretValueResolver {
  constructor(
    private readonly variables: Record<
      string,
      string | undefined
    > = process.env,
  ) {}

  async resolveValue(secretRef: string): Promise<SecretValueResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "env") {
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    }
    const value = this.variables[parsed.path];
    if (value === undefined) {
      return {
        available: false,
        failureCode: "secret_not_found",
        scheme: parsed.scheme,
      };
    }
    if (value.length === 0) {
      return {
        available: false,
        failureCode: "secret_empty",
        scheme: parsed.scheme,
      };
    }
    return { available: true, scheme: parsed.scheme, value };
  }
}

export function createSecretValueResolver(
  driver: SecretValueResolverDriver,
  options: CreateSecretValueResolverOptions = {},
): SecretValueResolver {
  const env = options.env ?? process.env;
  if (driver === "env") return new EnvironmentSecretValueResolver(env);
  if (driver === "vault") return createVaultSecretResolver(env, options);
  if (driver === "aws-sm") return createAwsSecretResolver(env, options);
  if (driver === "gcp-sm") return createGcpSecretResolver(env, options);
  if (driver === "azure-kv") return createAzureSecretResolver(env, options);
  if (driver === "cloud")
    return new CloudSecretValueResolver({
      aws: createAwsSecretResolver(env, options),
      azure: createAzureSecretResolver(env, options),
      gcp: createGcpSecretResolver(env, options),
    });
  return disabledSecretValueResolver;
}

function createVaultSecretResolver(
  env: Record<string, string | undefined>,
  options: CreateSecretValueResolverOptions,
): VaultSecretValueResolver {
  return new VaultSecretValueResolver({
    address: env.VAULT_ADDR ?? "",
    kvMount: env.VAULT_KV_MOUNT ?? "secret",
    timeoutMs: positiveIntegerEnv(env, "VAULT_TIMEOUT_MS", 5_000),
    token: env.VAULT_TOKEN ?? "",
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(env.VAULT_NAMESPACE === undefined
      ? {}
      : { namespace: env.VAULT_NAMESPACE }),
  });
}

function createAwsSecretResolver(
  env: Record<string, string | undefined>,
  options: CreateSecretValueResolverOptions,
): AwsSecretValueResolver {
  return new AwsSecretValueResolver({
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
    timeoutMs: positiveIntegerEnv(env, "AWS_SECRET_MANAGER_TIMEOUT_MS", 5_000),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(env.AWS_SESSION_TOKEN === undefined
      ? {}
      : { sessionToken: env.AWS_SESSION_TOKEN }),
  });
}

function createGcpSecretResolver(
  env: Record<string, string | undefined>,
  options: CreateSecretValueResolverOptions,
): GcpSecretValueResolver {
  return new GcpSecretValueResolver({
    accessToken: env.GCP_ACCESS_TOKEN ?? "",
    projectId: env.GCP_SECRET_MANAGER_PROJECT ?? "",
    timeoutMs: positiveIntegerEnv(env, "GCP_SECRET_MANAGER_TIMEOUT_MS", 5_000),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createAzureSecretResolver(
  env: Record<string, string | undefined>,
  options: CreateSecretValueResolverOptions,
): AzureSecretValueResolver {
  return new AzureSecretValueResolver({
    accessToken: env.AZURE_ACCESS_TOKEN ?? "",
    timeoutMs: positiveIntegerEnv(env, "AZURE_KEY_VAULT_TIMEOUT_MS", 5_000),
    vaultUrl: env.AZURE_KEY_VAULT_URL ?? "",
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function positiveIntegerEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
