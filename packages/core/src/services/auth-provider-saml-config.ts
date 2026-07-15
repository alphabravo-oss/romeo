import type { AuthProviderCatalogEntry } from "../domain/auth-providers";
import type {
  AuthProviderSamlConnectionPatch,
  AuthProviderSamlConnectionSummary,
} from "../domain/auth-provider-settings";
import { ApiError } from "../errors";
import { parseManagedSecretRef } from "./secret-refs";
import { safeHost } from "./sso-config";

export interface StoredSamlProviderConnection {
  acceptedClockSkewMs?: number;
  adminGroups?: string[];
  emailAttribute?: string;
  entryPoint?: string;
  groupMap?: Record<string, string>;
  groupsAttribute?: string;
  idpIssuer?: string;
  maxAssertionAgeMs?: number;
  nameAttribute?: string;
  requiredGroups?: string[];
  spEntityId?: string;
  subjectAttribute?: string;
  wantAuthnResponseSigned?: boolean;
  workspaceGroupMap?: Record<string, string>;
  workspaceGroupPrefix?: string;
}

export interface ResolvedSamlProviderConnection {
  acceptedClockSkewMs: number;
  adminGroups: string[];
  emailAttribute: string;
  entryPoint: string;
  groupMap: Record<string, string>;
  groupsAttribute: string;
  idpIssuer: string;
  maxAssertionAgeMs: number;
  nameAttribute: string;
  requiredGroups: string[];
  spEntityId: string;
  subjectAttribute: string;
  wantAssertionsSigned: true;
  wantAuthnResponseSigned: boolean;
  workspaceGroupMap: Record<string, string>;
  workspaceGroupPrefix: string;
}

interface SamlConnectionDraft {
  acceptedClockSkewMs?: number | undefined;
  adminGroups?: string[] | undefined;
  emailAttribute?: string | undefined;
  entryPoint?: string | undefined;
  groupMap?: Record<string, string> | undefined;
  groupsAttribute?: string | undefined;
  idpIssuer?: string | undefined;
  maxAssertionAgeMs?: number | undefined;
  nameAttribute?: string | undefined;
  requiredGroups?: string[] | undefined;
  spEntityId?: string | undefined;
  subjectAttribute?: string | undefined;
  wantAuthnResponseSigned?: boolean | undefined;
  workspaceGroupMap?: Record<string, string> | undefined;
  workspaceGroupPrefix?: string | undefined;
}

export function applySamlConnectionPatch(
  entry: AuthProviderCatalogEntry,
  existing: StoredSamlProviderConnection | undefined,
  patch: AuthProviderSamlConnectionPatch | null | undefined,
): StoredSamlProviderConnection | undefined {
  if (patch === undefined) return existing;
  if (entry.protocol !== "saml") {
    throw invalidSamlConfig(
      "SAML connection settings are only valid for SAML authentication providers.",
      entry.id,
    );
  }
  if (patch === null) return undefined;
  const next = compactConnection({
    acceptedClockSkewMs: normalizeOptionalInteger(
      patch.acceptedClockSkewMs,
      existing?.acceptedClockSkewMs,
      0,
      300_000,
      "accepted clock skew",
    ),
    adminGroups: normalizeOptionalList(
      patch.adminGroups,
      existing?.adminGroups,
    ),
    emailAttribute: normalizeOptionalText(
      patch.emailAttribute,
      existing?.emailAttribute,
      200,
    ),
    entryPoint: normalizeOptionalSamlUrl(
      patch.entryPoint,
      existing?.entryPoint,
    ),
    groupMap: normalizeOptionalMap(patch.groupMap, existing?.groupMap),
    groupsAttribute: normalizeOptionalText(
      patch.groupsAttribute,
      existing?.groupsAttribute,
      200,
    ),
    idpIssuer: normalizeOptionalText(patch.idpIssuer, existing?.idpIssuer, 500),
    maxAssertionAgeMs: normalizeOptionalInteger(
      patch.maxAssertionAgeMs,
      existing?.maxAssertionAgeMs,
      0,
      3_600_000,
      "maximum assertion age",
    ),
    nameAttribute: normalizeOptionalText(
      patch.nameAttribute,
      existing?.nameAttribute,
      200,
    ),
    requiredGroups: normalizeOptionalList(
      patch.requiredGroups,
      existing?.requiredGroups,
    ),
    spEntityId: normalizeOptionalText(
      patch.spEntityId,
      existing?.spEntityId,
      500,
    ),
    subjectAttribute: normalizeOptionalText(
      patch.subjectAttribute,
      existing?.subjectAttribute,
      200,
      true,
    ),
    wantAuthnResponseSigned:
      patch.wantAuthnResponseSigned === undefined
        ? existing?.wantAuthnResponseSigned
        : (patch.wantAuthnResponseSigned ?? undefined),
    workspaceGroupMap: normalizeOptionalMap(
      patch.workspaceGroupMap,
      existing?.workspaceGroupMap,
    ),
    workspaceGroupPrefix: normalizeOptionalText(
      patch.workspaceGroupPrefix,
      existing?.workspaceGroupPrefix,
      200,
      true,
    ),
  });
  return Object.keys(next).length === 0 ? undefined : next;
}

export function mergeSamlConnection(
  global: StoredSamlProviderConnection | undefined,
  override: StoredSamlProviderConnection | undefined,
): StoredSamlProviderConnection | undefined {
  if (global === undefined) return override;
  if (override === undefined) return global;
  return compactConnection({
    ...global,
    ...override,
    groupMap:
      global.groupMap === undefined && override.groupMap === undefined
        ? undefined
        : { ...(global.groupMap ?? {}), ...(override.groupMap ?? {}) },
    workspaceGroupMap:
      global.workspaceGroupMap === undefined &&
      override.workspaceGroupMap === undefined
        ? undefined
        : {
            ...(global.workspaceGroupMap ?? {}),
            ...(override.workspaceGroupMap ?? {}),
          },
  });
}

export function parseStoredSamlConnection(
  value: unknown,
): StoredSamlProviderConnection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const parsed = compactConnection({
    acceptedClockSkewMs: optionalNumber(record.acceptedClockSkewMs),
    adminGroups: stringArray(record.adminGroups),
    emailAttribute: optionalString(record.emailAttribute),
    entryPoint: optionalString(record.entryPoint),
    groupMap: stringMap(record.groupMap),
    groupsAttribute: optionalString(record.groupsAttribute),
    idpIssuer: optionalString(record.idpIssuer),
    maxAssertionAgeMs: optionalNumber(record.maxAssertionAgeMs),
    nameAttribute: optionalString(record.nameAttribute),
    requiredGroups: stringArray(record.requiredGroups),
    spEntityId: optionalString(record.spEntityId),
    subjectAttribute: optionalString(record.subjectAttribute),
    wantAuthnResponseSigned:
      typeof record.wantAuthnResponseSigned === "boolean"
        ? record.wantAuthnResponseSigned
        : undefined,
    workspaceGroupMap: stringMap(record.workspaceGroupMap),
    workspaceGroupPrefix: optionalString(record.workspaceGroupPrefix),
  });
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

export function samlConnectionSummary(
  connection: StoredSamlProviderConnection | undefined,
): AuthProviderSamlConnectionSummary {
  const entryPointHost = safeHost(connection?.entryPoint ?? "");
  return {
    acceptedClockSkewMs: connection?.acceptedClockSkewMs ?? 120_000,
    adminGroupCount: connection?.adminGroups?.length ?? 0,
    emailAttribute: connection?.emailAttribute ?? "email",
    entryPointConfigured: connection?.entryPoint !== undefined,
    ...(entryPointHost === undefined ? {} : { entryPointHost }),
    groupMappingCount: Object.keys(connection?.groupMap ?? {}).length,
    groupsAttribute: connection?.groupsAttribute ?? "groups",
    idpIssuerConfigured: connection?.idpIssuer !== undefined,
    maxAssertionAgeMs: connection?.maxAssertionAgeMs ?? 300_000,
    nameAttribute: connection?.nameAttribute ?? "name",
    requiredGroupCount: connection?.requiredGroups?.length ?? 0,
    signedAssertionRequired: true,
    signedResponseRequired: connection?.wantAuthnResponseSigned ?? false,
    spEntityIdConfigured: connection?.spEntityId !== undefined,
    subjectAttribute: connection?.subjectAttribute ?? "nameID",
    workspaceGroupMappingCount: Object.keys(connection?.workspaceGroupMap ?? {})
      .length,
    workspaceGroupPrefixConfigured:
      (connection?.workspaceGroupPrefix?.length ?? 0) > 0,
  };
}

export function samlConfigFromProviderConnection(
  connection: StoredSamlProviderConnection,
): ResolvedSamlProviderConnection {
  return {
    acceptedClockSkewMs: connection.acceptedClockSkewMs ?? 120_000,
    adminGroups: connection.adminGroups ?? [],
    emailAttribute: connection.emailAttribute ?? "email",
    entryPoint: connection.entryPoint ?? "",
    groupMap: connection.groupMap ?? {},
    groupsAttribute: connection.groupsAttribute ?? "groups",
    idpIssuer: connection.idpIssuer ?? "",
    maxAssertionAgeMs: connection.maxAssertionAgeMs ?? 300_000,
    nameAttribute: connection.nameAttribute ?? "name",
    requiredGroups: connection.requiredGroups ?? [],
    spEntityId: connection.spEntityId ?? "",
    subjectAttribute: connection.subjectAttribute ?? "nameID",
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: connection.wantAuthnResponseSigned ?? false,
    workspaceGroupMap: connection.workspaceGroupMap ?? {},
    workspaceGroupPrefix: connection.workspaceGroupPrefix ?? "",
  };
}

export function hasSamlConnection(
  connection: StoredSamlProviderConnection | undefined,
): connection is StoredSamlProviderConnection {
  return connection !== undefined && Object.keys(connection).length > 0;
}

export function samlSecretRefScheme(
  secretRef: string | undefined,
): string | undefined {
  if (secretRef === undefined) return undefined;
  try {
    return parseManagedSecretRef(secretRef).scheme;
  } catch {
    return "invalid";
  }
}

function normalizeOptionalSamlUrl(
  patch: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = patch.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > 500) {
    throw invalidSamlConfig("SAML URLs must be at most 500 characters.");
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw invalidSamlConfig("SAML entry point must be a valid HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1"
  ) {
    throw invalidSamlConfig(
      "SAML entry point must be an HTTPS URL without credentials, query, fragment, or localhost host.",
    );
  }
  return parsed.toString();
}

function normalizeOptionalText(
  patch: string | null | undefined,
  existing: string | undefined,
  maxLength: number,
  allowEmpty = false,
): string | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = patch.trim();
  if (normalized.length === 0) return allowEmpty ? undefined : existing;
  if (normalized.length > maxLength || /[\r\n]/u.test(normalized)) {
    throw invalidSamlConfig("SAML connection text fields must be bounded.");
  }
  return normalized;
}

function normalizeOptionalInteger(
  patch: number | null | undefined,
  existing: number | undefined,
  min: number,
  max: number,
  label: string,
): number | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  if (!Number.isInteger(patch) || patch < min || patch > max) {
    throw invalidSamlConfig(`SAML ${label} must be between ${min} and ${max}.`);
  }
  return patch;
}

function normalizeOptionalList(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = [
    ...new Set(patch.map((item) => item.trim()).filter(Boolean)),
  ].sort();
  if (
    normalized.length > 100 ||
    normalized.some((item) => item.length > 240 || /[\r\n]/u.test(item))
  ) {
    throw invalidSamlConfig(
      "SAML group lists are limited to 100 bounded entries.",
    );
  }
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeOptionalMap(
  patch: Record<string, string> | null | undefined,
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const entries = Object.entries(patch)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length > 100 ||
    entries.some(
      ([key, value]) =>
        key.length > 240 ||
        value.length > 200 ||
        /[\r\n]/u.test(key) ||
        /[\r\n]/u.test(value),
    )
  ) {
    throw invalidSamlConfig(
      "SAML mapping fields are limited to 100 bounded entries.",
    );
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return output.length === 0 ? undefined : output;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function compactConnection(
  input: SamlConnectionDraft,
): StoredSamlProviderConnection {
  const output: StoredSamlProviderConnection = {};
  if (input.acceptedClockSkewMs !== undefined) {
    output.acceptedClockSkewMs = input.acceptedClockSkewMs;
  }
  if (input.adminGroups !== undefined) output.adminGroups = input.adminGroups;
  if (input.emailAttribute !== undefined) {
    output.emailAttribute = input.emailAttribute;
  }
  if (input.entryPoint !== undefined) output.entryPoint = input.entryPoint;
  if (input.groupMap !== undefined) output.groupMap = input.groupMap;
  if (input.groupsAttribute !== undefined) {
    output.groupsAttribute = input.groupsAttribute;
  }
  if (input.idpIssuer !== undefined) output.idpIssuer = input.idpIssuer;
  if (input.maxAssertionAgeMs !== undefined) {
    output.maxAssertionAgeMs = input.maxAssertionAgeMs;
  }
  if (input.nameAttribute !== undefined)
    output.nameAttribute = input.nameAttribute;
  if (input.requiredGroups !== undefined) {
    output.requiredGroups = input.requiredGroups;
  }
  if (input.spEntityId !== undefined) output.spEntityId = input.spEntityId;
  if (input.subjectAttribute !== undefined) {
    output.subjectAttribute = input.subjectAttribute;
  }
  if (input.wantAuthnResponseSigned !== undefined) {
    output.wantAuthnResponseSigned = input.wantAuthnResponseSigned;
  }
  if (input.workspaceGroupMap !== undefined) {
    output.workspaceGroupMap = input.workspaceGroupMap;
  }
  if (input.workspaceGroupPrefix !== undefined) {
    output.workspaceGroupPrefix = input.workspaceGroupPrefix;
  }
  return output;
}

function invalidSamlConfig(message: string, providerId = "saml"): ApiError {
  return new ApiError("invalid_auth_provider_saml_config", message, 400, {
    providerId,
  });
}
