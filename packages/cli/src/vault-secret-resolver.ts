import { parseManagedSecretRef } from "./managed-secret-ref";
import type {
  SecretValueResolution,
  SecretValueResolver,
} from "./secret-resolver";

export interface VaultSecretValueResolverOptions {
  address: string;
  fetchImpl?: typeof fetch;
  kvMount?: string;
  namespace?: string;
  timeoutMs?: number;
  token: string;
}

export class VaultSecretValueResolver implements SecretValueResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly kvMount: string;
  private readonly namespace: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: VaultSecretValueResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.kvMount = normalizePath(options.kvMount ?? "secret");
    this.namespace =
      options.namespace === undefined || options.namespace.length === 0
        ? undefined
        : options.namespace;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async resolveValue(secretRef: string): Promise<SecretValueResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "vault") return unsupported(parsed.scheme);
    if (this.options.address.length === 0 || this.options.token.length === 0) {
      return misconfigured(parsed.scheme);
    }
    const secretPath = normalizePath(parsed.path);
    if (!isSafeVaultPath(secretPath)) return invalid(parsed.scheme);

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
        return availabilityFromStatus(parsed.scheme, response.status);
      const value = extractVaultSecretValue(await response.json());
      return value === undefined
        ? {
            available: false,
            failureCode: "secret_empty",
            scheme: parsed.scheme,
          }
        : { available: true, scheme: parsed.scheme, value };
    } catch (caught) {
      return caught instanceof Error && caught.name === "AbortError"
        ? {
            available: false,
            failureCode: "secret_resolver_timeout",
            scheme: parsed.scheme,
          }
        : {
            available: false,
            failureCode: "secret_resolver_error",
            scheme: parsed.scheme,
          };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function vaultDataUrl(address: string, mount: string, path: string): string {
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
  base.pathname = `/v1/${encodeVaultPath(mount)}/data/${encodeVaultPath(path)}`;
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

function availabilityFromStatus(
  scheme: string,
  status: number,
): SecretValueResolution {
  if (status === 404)
    return { available: false, failureCode: "secret_not_found", scheme };
  if (status === 401 || status === 403)
    return { available: false, failureCode: "secret_access_denied", scheme };
  return { available: false, failureCode: "secret_resolver_error", scheme };
}

function unsupported(scheme: string): SecretValueResolution {
  return { available: false, failureCode: "secret_scheme_unsupported", scheme };
}

function misconfigured(scheme: string): SecretValueResolution {
  return {
    available: false,
    failureCode: "secret_resolver_misconfigured",
    scheme,
  };
}

function invalid(scheme: string): SecretValueResolution {
  return { available: false, failureCode: "invalid_secret_ref", scheme };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
