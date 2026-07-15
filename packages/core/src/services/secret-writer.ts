import { parseManagedSecretRef } from "./secret-refs";

export interface SecretWriteResult {
  failureCode?: string;
  scheme: string;
  secretRef: string;
  stored: boolean;
}

export interface SecretWriter {
  write(input: {
    secretRef: string;
    value: string;
  }): Promise<SecretWriteResult>;
}

export interface VaultSecretWriterOptions {
  address: string;
  token: string;
  namespace?: string;
  kvMount?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const disabledSecretWriter: SecretWriter = {
  async write(input) {
    const parsed = parseManagedSecretRef(input.secretRef);
    return {
      failureCode: "secret_writer_disabled",
      scheme: parsed.scheme,
      secretRef: input.secretRef,
      stored: false,
    };
  },
};

export class VaultSecretWriter implements SecretWriter {
  private readonly fetchImpl: typeof fetch;
  private readonly kvMount: string;
  private readonly namespace: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: VaultSecretWriterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.kvMount = normalizePath(options.kvMount ?? "secret");
    this.namespace =
      options.namespace === undefined || options.namespace.length === 0
        ? undefined
        : options.namespace;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async write(input: {
    secretRef: string;
    value: string;
  }): Promise<SecretWriteResult> {
    const parsed = parseManagedSecretRef(input.secretRef);
    if (parsed.scheme !== "vault")
      return result(
        input.secretRef,
        parsed.scheme,
        "secret_scheme_unsupported",
      );
    if (this.options.address.length === 0 || this.options.token.length === 0)
      return result(
        input.secretRef,
        parsed.scheme,
        "secret_writer_misconfigured",
      );

    const secretPath = normalizePath(parsed.path);
    if (!isSafeVaultPath(secretPath))
      return result(input.secretRef, parsed.scheme, "invalid_secret_ref");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        vaultDataUrl(this.options.address, this.kvMount, secretPath),
        {
          method: "PUT",
          headers: {
            ...vaultHeaders(this.options.token, this.namespace),
            "content-type": "application/json",
          },
          body: JSON.stringify({ data: { value: input.value } }),
          signal: controller.signal,
        },
      );
      if (response.ok)
        return {
          scheme: parsed.scheme,
          secretRef: input.secretRef,
          stored: true,
        };
      if (response.status === 401 || response.status === 403)
        return result(input.secretRef, parsed.scheme, "secret_access_denied");
      return result(input.secretRef, parsed.scheme, "secret_writer_error");
    } catch (caught) {
      return result(
        input.secretRef,
        parsed.scheme,
        caught instanceof Error && caught.name === "AbortError"
          ? "secret_writer_timeout"
          : "secret_writer_error",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function result(
  secretRef: string,
  scheme: string,
  failureCode: string,
): SecretWriteResult {
  return { failureCode, scheme, secretRef, stored: false };
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
): Record<string, string> {
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
