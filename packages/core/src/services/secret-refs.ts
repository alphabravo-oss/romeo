import { ApiError } from "../errors";

const allowedSecretSchemes = new Set([
  "vault:",
  "external-secret:",
  "aws-sm:",
  "gcp-sm:",
  "azure-kv:",
  "env:",
  "romeo-secret:",
]);
const envVarNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ManagedSecretRef {
  path: string;
  scheme: string;
}

export function assertManagedSecretRef(secretRef: string): void {
  void parseManagedSecretRef(secretRef);
}

export function parseManagedSecretRef(secretRef: string): ManagedSecretRef {
  let parsed: URL;
  try {
    parsed = new URL(secretRef);
  } catch {
    throw invalidSecretRef(secretRef);
  }
  if (
    !allowedSecretSchemes.has(parsed.protocol) ||
    parsed.hostname.length === 0
  )
    throw invalidSecretRef(secretRef);
  if (
    parsed.protocol === "env:" &&
    (!envVarNamePattern.test(parsed.hostname) || parsed.pathname !== "")
  )
    throw invalidSecretRef(secretRef);
  return {
    scheme: parsed.protocol.slice(0, -1),
    path: `${parsed.hostname}${parsed.pathname}`,
  };
}

function invalidSecretRef(secretRef: string): ApiError {
  return new ApiError(
    "invalid_secret_ref",
    "Secret reference must use a managed secret URI scheme.",
    400,
    { secretRefScheme: readScheme(secretRef) },
  );
}

function readScheme(secretRef: string): string {
  const index = secretRef.indexOf(":");
  return index > 0 ? secretRef.slice(0, index + 1) : "";
}
