import type { SecretAvailability, SecretWriteResult } from "./types";

export interface ManagedSecretRef {
  path: string;
  scheme: string;
}

export function unwrapVaultResult<T>(result: { data?: T; error?: Error }): T {
  if (result.error !== undefined) throw result.error;
  if (result.data === undefined) {
    throw new Error("Vault SDK returned neither data nor an error.");
  }
  return result.data;
}

export function extractVaultSecretValue(
  secretData: Record<string, unknown>,
): string | undefined {
  const value = secretData.value;
  if (typeof value === "string") return value.length === 0 ? undefined : value;
  return Object.keys(secretData).length === 0
    ? undefined
    : JSON.stringify(secretData);
}

export function parseManagedSecretRef(secretRef: string): ManagedSecretRef {
  const separator = secretRef.indexOf("://");
  if (separator <= 0 || separator === secretRef.length - 3) {
    return {
      path: "",
      scheme: separator > 0 ? secretRef.slice(0, separator) : "invalid",
    };
  }
  return {
    scheme: secretRef.slice(0, separator),
    path: secretRef.slice(separator + 3),
  };
}

export function gcpSecretName(projectId: string, secretId: string): string {
  return `projects/${projectId}/secrets/${secretId}`;
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/^\/+|\/+$/gu, "");
}

export function normalizedOptional(
  value: string | undefined,
): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

export function isSafeVaultPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    /^[A-Za-z0-9_./-]+$/u.test(path) &&
    !path.split("/").includes("..")
  );
}

export function isSafeVaultAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function isSafeCloudPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    /^[A-Za-z0-9_./+=@-]+$/u.test(path) &&
    !path.split("/").includes("..")
  );
}

export function isSafeGcpSecretId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,255}$/u.test(value);
}

export function isSafeGcpProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(value);
}

export function isSafeAzureSecretName(value: string): boolean {
  return /^[A-Za-z0-9-]{1,127}$/u.test(value);
}

export function isSafeAzureVaultUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function sdkFailure(
  scheme: string,
  caught: unknown,
): SecretAvailability {
  if (isTimeout(caught)) return timeoutResult(scheme);
  const status = errorStatus(caught);
  const grpcCode = errorCode(caught);
  const name = caught instanceof Error ? caught.name : "";
  const message = caught instanceof Error ? caught.message.toLowerCase() : "";
  if (
    status === 404 ||
    name === "ResourceNotFoundException" ||
    name === "SecretNotFound" ||
    grpcCode === 5 ||
    message.includes("not found")
  ) {
    return notFound(scheme);
  }
  if (
    status === 401 ||
    status === 403 ||
    name === "AccessDeniedException" ||
    name === "UnrecognizedClientException" ||
    name === "InvalidSignatureException" ||
    grpcCode === 7 ||
    grpcCode === 16 ||
    message.includes("permission denied") ||
    message.includes("forbidden")
  ) {
    return accessDenied(scheme);
  }
  return resolverError(scheme);
}

export function writerFailureCode(failureCode: string | undefined): string {
  if (failureCode === "secret_access_denied") return failureCode;
  if (failureCode === "secret_resolver_timeout") return "secret_writer_timeout";
  if (failureCode === "secret_scheme_unsupported") return failureCode;
  if (failureCode === "invalid_secret_ref") return failureCode;
  if (failureCode === "secret_resolver_misconfigured") {
    return "secret_writer_misconfigured";
  }
  return "secret_writer_error";
}

export function writeFailure(
  secretRef: string,
  scheme: string,
  failureCode: string,
): SecretWriteResult {
  return { failureCode, scheme, secretRef, stored: false };
}

export function isTimeout(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    ["AbortError", "TimeoutError"].includes(caught.name)
  );
}

export function errorStatus(caught: unknown): number | undefined {
  if (typeof caught !== "object" || caught === null) return undefined;
  const record = caught as Record<string, unknown>;
  if (typeof record.statusCode === "number") return record.statusCode;
  const cause = record.cause;
  if (cause instanceof Response) return cause.status;
  const metadata = record.$metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const status = (metadata as Record<string, unknown>).httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

export function errorCode(caught: unknown): number | undefined {
  if (typeof caught !== "object" || caught === null) return undefined;
  const code = (caught as Record<string, unknown>).code;
  return typeof code === "number" ? code : undefined;
}

export function available(scheme: string): SecretAvailability {
  return { available: true, scheme };
}

export function unsupported(scheme: string): SecretAvailability {
  return { available: false, failureCode: "secret_scheme_unsupported", scheme };
}

export function misconfigured(scheme: string): SecretAvailability {
  return {
    available: false,
    failureCode: "secret_resolver_misconfigured",
    scheme,
  };
}

export function invalid(scheme: string): SecretAvailability {
  return { available: false, failureCode: "invalid_secret_ref", scheme };
}

export function notFound(scheme: string): SecretAvailability {
  return { available: false, failureCode: "secret_not_found", scheme };
}

export function accessDenied(scheme: string): SecretAvailability {
  return { available: false, failureCode: "secret_access_denied", scheme };
}

export function secretEmpty(scheme: string): SecretAvailability {
  return { available: false, failureCode: "secret_empty", scheme };
}

export function resolverError(scheme: string): SecretAvailability {
  return { available: false, failureCode: "secret_resolver_error", scheme };
}

export function timeoutResult(scheme: string): SecretAvailability {
  return { available: false, failureCode: "secret_resolver_timeout", scheme };
}
