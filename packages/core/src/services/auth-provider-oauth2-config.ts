import type {
  AuthProviderCatalogEntry,
  AuthProviderId,
} from "../domain/auth-providers";
import type {
  AuthProviderOAuth2ConnectionPatch,
  AuthProviderOAuth2ConnectionSummary,
} from "../domain/auth-provider-settings";
import { ApiError } from "../errors";

export interface StoredOAuth2ProviderConnection {
  adminTeams?: string[];
  clientId?: string;
  groupMap?: Record<string, string>;
  requiredOrganizations?: string[];
  requiredTeams?: string[];
  scopes?: string[];
  workspaceTeamMap?: Record<string, string>;
  workspaceTeamPrefix?: string;
}

export interface ResolvedOAuth2ProviderConnection {
  adminTeams: string[];
  clientId: string;
  groupMap: Record<string, string>;
  requiredOrganizations: string[];
  requiredTeams: string[];
  scopes: string[];
  workspaceTeamMap: Record<string, string>;
  workspaceTeamPrefix: string;
}

export function applyOAuth2ConnectionPatch(
  entry: AuthProviderCatalogEntry,
  existing: StoredOAuth2ProviderConnection | undefined,
  patch: AuthProviderOAuth2ConnectionPatch | null | undefined,
): StoredOAuth2ProviderConnection | undefined {
  if (patch === undefined) return existing;
  if (entry.protocol !== "oauth2") {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "OAuth2 connection settings are only valid for OAuth2 authentication providers.",
      400,
      { providerId: entry.id },
    );
  }
  if (entry.id !== "github") {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "OAuth2 connection settings are not available for this authentication provider.",
      400,
      { providerId: entry.id },
    );
  }
  if (patch === null) return undefined;
  const next = compactConnection({
    adminTeams: normalizeTeamList(patch.adminTeams, existing?.adminTeams),
    clientId: normalizeOptionalText(patch.clientId, existing?.clientId, 200),
    groupMap: normalizeOptionalMap(patch.groupMap, existing?.groupMap),
    requiredOrganizations: normalizeOrganizationList(
      patch.requiredOrganizations,
      existing?.requiredOrganizations,
    ),
    requiredTeams: normalizeTeamList(
      patch.requiredTeams,
      existing?.requiredTeams,
    ),
    scopes: normalizeScopeList(patch.scopes, existing?.scopes, entry.id),
    workspaceTeamMap: normalizeOptionalMap(
      patch.workspaceTeamMap,
      existing?.workspaceTeamMap,
    ),
    workspaceTeamPrefix: normalizeOptionalText(
      patch.workspaceTeamPrefix,
      existing?.workspaceTeamPrefix,
      200,
      true,
    ),
  });
  return Object.keys(next).length === 0 ? undefined : next;
}

export function mergeOAuth2Connection(
  global: StoredOAuth2ProviderConnection | undefined,
  override: StoredOAuth2ProviderConnection | undefined,
): StoredOAuth2ProviderConnection | undefined {
  if (global === undefined) return override;
  if (override === undefined) return global;
  return compactConnection({
    ...global,
    ...override,
    groupMap:
      global.groupMap === undefined && override.groupMap === undefined
        ? undefined
        : { ...(global.groupMap ?? {}), ...(override.groupMap ?? {}) },
    workspaceTeamMap:
      global.workspaceTeamMap === undefined &&
      override.workspaceTeamMap === undefined
        ? undefined
        : {
            ...(global.workspaceTeamMap ?? {}),
            ...(override.workspaceTeamMap ?? {}),
          },
  });
}

export function parseStoredOAuth2Connection(
  value: unknown,
): StoredOAuth2ProviderConnection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const parsed = compactConnection({
    adminTeams: stringArray(record.adminTeams),
    clientId: optionalString(record.clientId),
    groupMap: stringMap(record.groupMap),
    requiredOrganizations: stringArray(record.requiredOrganizations),
    requiredTeams: stringArray(record.requiredTeams),
    scopes: stringArray(record.scopes),
    workspaceTeamMap: stringMap(record.workspaceTeamMap),
    workspaceTeamPrefix: optionalString(record.workspaceTeamPrefix),
  });
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

export function oauth2ConnectionSummary(
  providerId: AuthProviderId,
  connection: StoredOAuth2ProviderConnection | undefined,
): AuthProviderOAuth2ConnectionSummary {
  return {
    adminTeamCount: connection?.adminTeams?.length ?? 0,
    clientIdConfigured: connection?.clientId !== undefined,
    groupMappingCount: Object.keys(connection?.groupMap ?? {}).length,
    requiredOrganizationCount: connection?.requiredOrganizations?.length ?? 0,
    requiredTeamCount: connection?.requiredTeams?.length ?? 0,
    scopeCount: (connection?.scopes ?? defaultScopes(providerId)).length,
    workspaceTeamMappingCount: Object.keys(
      connection?.workspaceTeamMap ?? {},
    ).length,
    workspaceTeamPrefixConfigured:
      (connection?.workspaceTeamPrefix?.length ?? 0) > 0,
  };
}

export function oauth2ConfigFromProviderConnection(
  providerId: AuthProviderId,
  connection: StoredOAuth2ProviderConnection,
): ResolvedOAuth2ProviderConnection {
  return {
    adminTeams: connection.adminTeams ?? [],
    clientId: connection.clientId ?? "",
    groupMap: connection.groupMap ?? {},
    requiredOrganizations: connection.requiredOrganizations ?? [],
    requiredTeams: connection.requiredTeams ?? [],
    scopes: connection.scopes ?? defaultScopes(providerId),
    workspaceTeamMap: connection.workspaceTeamMap ?? {},
    workspaceTeamPrefix: connection.workspaceTeamPrefix ?? "",
  };
}

export function hasOAuth2Connection(
  connection: StoredOAuth2ProviderConnection | undefined,
): connection is StoredOAuth2ProviderConnection {
  return connection !== undefined && Object.keys(connection).length > 0;
}

export function defaultScopes(providerId: AuthProviderId): string[] {
  if (providerId === "github") return ["read:user", "user:email", "read:org"];
  return [];
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
      "invalid_auth_provider_oauth2_config",
      "OAuth2 connection text fields must be bounded.",
      400,
    );
  }
  return normalized;
}

function normalizeScopeList(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
  providerId: AuthProviderId,
): string[] | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = [
    ...new Set(patch.map((item) => item.trim()).filter(Boolean)),
  ].sort();
  if (normalized.length > 20 || normalized.some((item) => item.length > 100)) {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "OAuth2 scope lists are limited to 20 bounded entries.",
      400,
    );
  }
  return normalized.length === 0 ? defaultScopes(providerId) : normalized;
}

function normalizeOrganizationList(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = [
    ...new Set(patch.map((item) => normalizeGitHubSlug(item)).filter(Boolean)),
  ].sort();
  if (normalized.length > 100) {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "OAuth2 organization lists are limited to 100 entries.",
      400,
    );
  }
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeTeamList(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = [
    ...new Set(patch.map((item) => normalizeGitHubTeam(item)).filter(Boolean)),
  ].sort();
  if (normalized.length > 100) {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "OAuth2 team lists are limited to 100 entries.",
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
    .map(([key, value]) => [key.trim().toLowerCase(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length > 100 ||
    entries.some(([key, value]) => key.length > 240 || value.length > 200)
  ) {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "OAuth2 mapping fields are limited to 100 bounded entries.",
      400,
    );
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function normalizeGitHubSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(normalized)) {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "GitHub organization and team slugs must be DNS-label style strings.",
      400,
    );
  }
  return normalized;
}

function normalizeGitHubTeam(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return "";
  const [org, team, extra] = normalized.split("/");
  if (
    org === undefined ||
    team === undefined ||
    extra !== undefined ||
    normalizeGitHubSlug(org) !== org ||
    normalizeGitHubSlug(team) !== team
  ) {
    throw new ApiError(
      "invalid_auth_provider_oauth2_config",
      "GitHub team entries must use org/team slug format.",
      400,
    );
  }
  return `${org}/${team}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function compactConnection(input: {
  adminTeams?: string[] | undefined;
  clientId?: string | undefined;
  groupMap?: Record<string, string> | undefined;
  requiredOrganizations?: string[] | undefined;
  requiredTeams?: string[] | undefined;
  scopes?: string[] | undefined;
  workspaceTeamMap?: Record<string, string> | undefined;
  workspaceTeamPrefix?: string | undefined;
}): StoredOAuth2ProviderConnection {
  const output: StoredOAuth2ProviderConnection = {};
  if (input.adminTeams !== undefined) output.adminTeams = input.adminTeams;
  if (input.clientId !== undefined) output.clientId = input.clientId;
  if (input.groupMap !== undefined) output.groupMap = input.groupMap;
  if (input.requiredOrganizations !== undefined) {
    output.requiredOrganizations = input.requiredOrganizations;
  }
  if (input.requiredTeams !== undefined) output.requiredTeams = input.requiredTeams;
  if (input.scopes !== undefined) output.scopes = input.scopes;
  if (input.workspaceTeamMap !== undefined) {
    output.workspaceTeamMap = input.workspaceTeamMap;
  }
  if (input.workspaceTeamPrefix !== undefined) {
    output.workspaceTeamPrefix = input.workspaceTeamPrefix;
  }
  return output;
}
