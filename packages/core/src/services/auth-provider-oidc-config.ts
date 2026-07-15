import type {
  AuthProviderCatalogEntry,
  AuthProviderId,
} from "../domain/auth-providers";
import type {
  AuthProviderOidcConnectionPatch,
  AuthProviderOidcConnectionSummary,
} from "../domain/auth-provider-settings";
import {
  providerPresetById,
  type SsoOidcProviderPresetId,
} from "../domain/sso-provider-presets";
import { ApiError } from "../errors";
import {
  assertTrustedMetadataUrl,
  normalizeIssuer,
  safeHost,
  type ResolvedSsoOidcConfig,
} from "./sso-config";

export interface StoredOidcProviderConnection {
  issuerUrl?: string;
  clientId?: string;
  groupClaim?: string;
  adminGroups?: string[];
  groupMap?: Record<string, string>;
  workspaceGroupMap?: Record<string, string>;
  workspaceGroupPrefix?: string;
}

export function applyOidcConnectionPatch(
  entry: AuthProviderCatalogEntry,
  existing: StoredOidcProviderConnection | undefined,
  patch: AuthProviderOidcConnectionPatch | null | undefined,
): StoredOidcProviderConnection | undefined {
  if (patch === undefined) return existing;
  if (entry.protocol !== "oidc") {
    throw new ApiError(
      "invalid_auth_provider_oidc_config",
      "OIDC connection settings are only valid for OIDC authentication providers.",
      400,
      { providerId: entry.id },
    );
  }
  if (patch === null) return undefined;
  const next = compactConnection({
    issuerUrl: normalizeOptionalIssuer(patch.issuerUrl, existing?.issuerUrl),
    clientId: normalizeOptionalText(patch.clientId, existing?.clientId, 200),
    groupClaim: normalizeOptionalText(
      patch.groupClaim,
      existing?.groupClaim,
      100,
    ),
    adminGroups: normalizeOptionalList(
      patch.adminGroups,
      existing?.adminGroups,
    ),
    groupMap: normalizeOptionalMap(patch.groupMap, existing?.groupMap),
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

export function mergeOidcConnection(
  global: StoredOidcProviderConnection | undefined,
  override: StoredOidcProviderConnection | undefined,
): StoredOidcProviderConnection | undefined {
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

export function parseStoredOidcConnection(
  value: unknown,
): StoredOidcProviderConnection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const parsed = compactConnection({
    issuerUrl: optionalString(record.issuerUrl),
    clientId: optionalString(record.clientId),
    groupClaim: optionalString(record.groupClaim),
    adminGroups: stringArray(record.adminGroups),
    groupMap: stringMap(record.groupMap),
    workspaceGroupMap: stringMap(record.workspaceGroupMap),
    workspaceGroupPrefix: optionalString(record.workspaceGroupPrefix),
  });
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

export function oidcConnectionSummary(
  providerId: AuthProviderId,
  connection: StoredOidcProviderConnection | undefined,
): AuthProviderOidcConnectionSummary {
  const issuerHost = safeHost(connection?.issuerUrl ?? "");
  return {
    issuerConfigured: connection?.issuerUrl !== undefined,
    ...(issuerHost === undefined ? {} : { issuerHost }),
    clientIdConfigured: connection?.clientId !== undefined,
    groupClaim: connection?.groupClaim ?? defaultGroupClaim(providerId),
    adminGroupCount: connection?.adminGroups?.length ?? 0,
    groupMappingCount: Object.keys(connection?.groupMap ?? {}).length,
    workspaceGroupMappingCount: Object.keys(connection?.workspaceGroupMap ?? {})
      .length,
    workspaceGroupPrefixConfigured:
      (connection?.workspaceGroupPrefix?.length ?? 0) > 0,
  };
}

export function oidcConfigFromProviderConnection(
  providerId: AuthProviderId,
  connection: StoredOidcProviderConnection,
): ResolvedSsoOidcConfig {
  const issuerUrl = connection.issuerUrl ?? "";
  const clientId = connection.clientId ?? "";
  return {
    source: "database",
    enabled: issuerUrl.length > 0 && clientId.length > 0,
    issuerUrl,
    clientId,
    groupClaim: connection.groupClaim ?? defaultGroupClaim(providerId),
    adminGroups: connection.adminGroups ?? [],
    groupMap: connection.groupMap ?? {},
    workspaceGroupMap: connection.workspaceGroupMap ?? {},
    workspaceGroupPrefix: connection.workspaceGroupPrefix ?? "",
  };
}

export function hasOidcConnection(
  connection: StoredOidcProviderConnection | undefined,
): connection is StoredOidcProviderConnection {
  return connection !== undefined && Object.keys(connection).length > 0;
}

function normalizeOptionalIssuer(
  patch: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const trimmed = patch.trim();
  if (trimmed.length === 0) return undefined;
  const issuer = normalizeIssuer(trimmed);
  try {
    assertTrustedMetadataUrl(issuer);
    return issuer;
  } catch {
    throw new ApiError(
      "invalid_auth_provider_oidc_config",
      "OIDC issuer URL must use HTTPS outside localhost.",
      400,
    );
  }
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
  if (normalized.length > maxLength) {
    throw new ApiError(
      "invalid_auth_provider_oidc_config",
      "OIDC connection text fields must be bounded.",
      400,
    );
  }
  return normalized;
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
  if (normalized.length > 100) {
    throw new ApiError(
      "invalid_auth_provider_oidc_config",
      "OIDC group lists are limited to 100 entries.",
      400,
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
  if (entries.length > 100) {
    throw new ApiError(
      "invalid_auth_provider_oidc_config",
      "OIDC mapping fields are limited to 100 entries.",
      400,
    );
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function defaultGroupClaim(providerId: AuthProviderId): string {
  const presetId = (
    providerId === "generic-oidc" ? "generic" : providerId
  ) as SsoOidcProviderPresetId;
  return providerPresetById(presetId).recommendedGroupClaim;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output = value.filter(
    (item): item is string => typeof item === "string",
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

function compactConnection(input: {
  issuerUrl?: string | undefined;
  clientId?: string | undefined;
  groupClaim?: string | undefined;
  adminGroups?: string[] | undefined;
  groupMap?: Record<string, string> | undefined;
  workspaceGroupMap?: Record<string, string> | undefined;
  workspaceGroupPrefix?: string | undefined;
}): StoredOidcProviderConnection {
  const output: StoredOidcProviderConnection = {};
  if (input.issuerUrl !== undefined) output.issuerUrl = input.issuerUrl;
  if (input.clientId !== undefined) output.clientId = input.clientId;
  if (input.groupClaim !== undefined) output.groupClaim = input.groupClaim;
  if (input.adminGroups !== undefined) output.adminGroups = input.adminGroups;
  if (input.groupMap !== undefined) output.groupMap = input.groupMap;
  if (input.workspaceGroupMap !== undefined) {
    output.workspaceGroupMap = input.workspaceGroupMap;
  }
  if (input.workspaceGroupPrefix !== undefined) {
    output.workspaceGroupPrefix = input.workspaceGroupPrefix;
  }
  return output;
}
