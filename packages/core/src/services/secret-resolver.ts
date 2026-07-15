import { parseManagedSecretRef } from "./secret-refs";

export interface SecretAvailability {
  available: boolean;
  failureCode?: string;
  scheme: string;
}

export interface SecretResolution extends SecretAvailability {
  value?: string;
}

export interface SecretResolver {
  check(secretRef: string): Promise<SecretAvailability>;
  resolveValue?(secretRef: string): Promise<SecretResolution>;
}

export interface VaultSecretResolverOptions {
  address: string;
  token: string;
  namespace?: string;
  kvMount?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class EnvironmentSecretResolver implements SecretResolver {
  constructor(
    private readonly variables: Record<
      string,
      string | undefined
    > = process.env,
  ) {}

  async check(secretRef: string): Promise<SecretAvailability> {
    const resolution = await this.resolveValue(secretRef);
    return resolution.available
      ? { available: true, scheme: resolution.scheme }
      : {
          available: false,
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          scheme: resolution.scheme,
        };
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "env")
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    const value = this.variables[parsed.path];
    if (value === undefined)
      return {
        available: false,
        failureCode: "secret_not_found",
        scheme: parsed.scheme,
      };
    if (value.length === 0)
      return {
        available: false,
        failureCode: "secret_empty",
        scheme: parsed.scheme,
      };
    return { available: true, scheme: parsed.scheme, value };
  }
}

export class VaultSecretResolver implements SecretResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly kvMount: string;
  private readonly namespace: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: VaultSecretResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.kvMount = normalizePath(options.kvMount ?? "secret");
    this.namespace =
      options.namespace === undefined || options.namespace.length === 0
        ? undefined
        : options.namespace;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "vault")
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    if (this.options.address.length === 0 || this.options.token.length === 0) {
      return {
        available: false,
        failureCode: "secret_resolver_misconfigured",
        scheme: parsed.scheme,
      };
    }
    const secretPath = normalizePath(parsed.path);
    if (!isSafeVaultPath(secretPath))
      return {
        available: false,
        failureCode: "invalid_secret_ref",
        scheme: parsed.scheme,
      };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        vaultMetadataUrl(this.options.address, this.kvMount, secretPath),
        {
          method: "GET",
          headers: vaultHeaders(this.options.token, this.namespace),
          signal: controller.signal,
        },
      );
      if (response.ok) return { available: true, scheme: parsed.scheme };
      if (response.status === 404)
        return {
          available: false,
          failureCode: "secret_not_found",
          scheme: parsed.scheme,
        };
      if (response.status === 401 || response.status === 403)
        return {
          available: false,
          failureCode: "secret_access_denied",
          scheme: parsed.scheme,
        };
      return {
        available: false,
        failureCode: "secret_resolver_error",
        scheme: parsed.scheme,
      };
    } catch (caught) {
      const failureCode =
        caught instanceof Error && caught.name === "AbortError"
          ? "secret_resolver_timeout"
          : "secret_resolver_error";
      return { available: false, failureCode, scheme: parsed.scheme };
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "vault")
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    if (this.options.address.length === 0 || this.options.token.length === 0) {
      return {
        available: false,
        failureCode: "secret_resolver_misconfigured",
        scheme: parsed.scheme,
      };
    }
    const secretPath = normalizePath(parsed.path);
    if (!isSafeVaultPath(secretPath))
      return {
        available: false,
        failureCode: "invalid_secret_ref",
        scheme: parsed.scheme,
      };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        vaultDataUrl(this.options.address, this.kvMount, secretPath),
        {
          method: "GET",
          headers: vaultHeaders(this.options.token, this.namespace),
          signal: controller.signal,
        },
      );
      if (!response.ok)
        return vaultAvailabilityFromStatus(parsed.scheme, response.status);
      const value = extractVaultSecretValue(await response.json());
      return value === undefined
        ? {
            available: false,
            failureCode: "secret_empty",
            scheme: parsed.scheme,
          }
        : { available: true, scheme: parsed.scheme, value };
    } catch (caught) {
      const failureCode =
        caught instanceof Error && caught.name === "AbortError"
          ? "secret_resolver_timeout"
          : "secret_resolver_error";
      return { available: false, failureCode, scheme: parsed.scheme };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const disabledSecretResolver: SecretResolver = {
  async check(secretRef) {
    const parsed = parseManagedSecretRef(secretRef);
    return {
      available: false,
      failureCode: "secret_resolver_disabled",
      scheme: parsed.scheme,
    };
  },
};

export class SchemeRoutingSecretResolver implements SecretResolver {
  constructor(
    private readonly routes: Record<string, SecretResolver>,
    private readonly fallback: SecretResolver,
  ) {}

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    const resolver = this.routes[parsed.scheme] ?? this.fallback;
    return resolver.check(secretRef);
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    const resolver = this.routes[parsed.scheme] ?? this.fallback;
    if (resolver.resolveValue === undefined) {
      return {
        available: false,
        failureCode: "secret_value_resolution_unavailable",
        scheme: parsed.scheme,
      };
    }
    return resolver.resolveValue(secretRef);
  }
}

function vaultMetadataUrl(
  address: string,
  mount: string,
  path: string,
): string {
  return vaultKvUrl(address, mount, "metadata", path);
}

function vaultDataUrl(address: string, mount: string, path: string): string {
  return vaultKvUrl(address, mount, "data", path);
}

function vaultKvUrl(
  address: string,
  mount: string,
  kind: "data" | "metadata",
  path: string,
): string {
  const base = new URL(address);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username.length > 0 ||
    base.password.length > 0 ||
    base.search.length > 0 ||
    base.hash.length > 0
  ) {
    throw new Error(
      "Vault address must be an http(s) origin without credentials, query, or fragment.",
    );
  }
  base.pathname = `/v1/${encodeVaultPath(mount)}/${kind}/${encodeVaultPath(path)}`;
  return base.toString();
}

function vaultHeaders(
  token: string,
  namespace: string | undefined,
): HeadersInit {
  return namespace === undefined
    ? { "x-vault-token": token }
    : { "x-vault-token": token, "x-vault-namespace": namespace };
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/gu, "");
}

function encodeVaultPath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isSafeVaultPath(path: string): boolean {
  return (
    path.length > 0 &&
    /^[A-Za-z0-9_./-]+$/u.test(path) &&
    !path.split("/").includes("..")
  );
}

function vaultAvailabilityFromStatus(
  scheme: string,
  status: number,
): SecretResolution {
  if (status === 404)
    return { available: false, failureCode: "secret_not_found", scheme };
  if (status === 401 || status === 403)
    return { available: false, failureCode: "secret_access_denied", scheme };
  return { available: false, failureCode: "secret_resolver_error", scheme };
}

function extractVaultSecretValue(payload: unknown): string | undefined {
  const data = asRecord(asRecord(payload)?.data);
  const secretData = asRecord(data?.data);
  if (secretData === undefined) return undefined;
  const value = secretData.value;
  if (typeof value === "string") return value.length === 0 ? undefined : value;
  return Object.keys(secretData).length === 0
    ? undefined
    : JSON.stringify(secretData);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
