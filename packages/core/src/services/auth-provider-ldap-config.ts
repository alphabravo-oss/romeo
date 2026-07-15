import type {
  AuthProviderCatalogEntry,
  AuthProviderId,
} from "../domain/auth-providers";
import type {
  AuthProviderLdapConnectionPatch,
  AuthProviderLdapConnectionSummary,
} from "../domain/auth-provider-settings";
import { ApiError } from "../errors";

export interface StoredLdapProviderConnection {
  adminGroups?: string[];
  baseDn?: string;
  bindDn?: string;
  emailAttribute?: string;
  groupMap?: Record<string, string>;
  groupNameAttribute?: string;
  groupSearchBaseDn?: string;
  groupSearchFilter?: string;
  nameAttribute?: string;
  requiredGroups?: string[];
  startTls?: boolean;
  url?: string;
  userIdAttribute?: string;
  userSearchFilter?: string;
  workspaceGroupMap?: Record<string, string>;
  workspaceGroupPrefix?: string;
}

export interface ResolvedLdapProviderConnection {
  adminGroups: string[];
  baseDn: string;
  bindDn: string;
  emailAttribute: string;
  groupMap: Record<string, string>;
  groupNameAttribute: string;
  groupSearchBaseDn: string;
  groupSearchFilter: string;
  nameAttribute: string;
  requiredGroups: string[];
  startTls: boolean;
  url: string;
  userIdAttribute: string;
  userSearchFilter: string;
  workspaceGroupMap: Record<string, string>;
  workspaceGroupPrefix: string;
}

export function applyLdapConnectionPatch(
  entry: AuthProviderCatalogEntry,
  existing: StoredLdapProviderConnection | undefined,
  patch: AuthProviderLdapConnectionPatch | null | undefined,
): StoredLdapProviderConnection | undefined {
  if (patch === undefined) return existing;
  if (entry.protocol !== "ldap") {
    throw new ApiError(
      "invalid_auth_provider_ldap_config",
      "LDAP connection settings are only valid for LDAP authentication providers.",
      400,
      { providerId: entry.id },
    );
  }
  if (patch === null) return undefined;
  const startTls = normalizeOptionalBoolean(patch.startTls, existing?.startTls);
  const url = normalizeOptionalLdapUrl(patch.url, existing?.url, startTls);
  assertLdapUrlTlsPolicy(url, startTls);
  const next = compactConnection({
    adminGroups: normalizeOptionalList(patch.adminGroups, existing?.adminGroups),
    baseDn: normalizeOptionalDn(patch.baseDn, existing?.baseDn),
    bindDn: normalizeOptionalDn(patch.bindDn, existing?.bindDn),
    emailAttribute: normalizeOptionalAttribute(
      patch.emailAttribute,
      existing?.emailAttribute,
    ),
    groupMap: normalizeOptionalMap(patch.groupMap, existing?.groupMap),
    groupNameAttribute: normalizeOptionalAttribute(
      patch.groupNameAttribute,
      existing?.groupNameAttribute,
    ),
    groupSearchBaseDn: normalizeOptionalDn(
      patch.groupSearchBaseDn,
      existing?.groupSearchBaseDn,
    ),
    groupSearchFilter: normalizeOptionalFilter(
      patch.groupSearchFilter,
      existing?.groupSearchFilter,
      ["{userDn}", "{userId}", "{identifier}"],
    ),
    nameAttribute: normalizeOptionalAttribute(
      patch.nameAttribute,
      existing?.nameAttribute,
    ),
    requiredGroups: normalizeOptionalList(
      patch.requiredGroups,
      existing?.requiredGroups,
    ),
    startTls,
    url,
    userIdAttribute: normalizeOptionalAttribute(
      patch.userIdAttribute,
      existing?.userIdAttribute,
    ),
    userSearchFilter: normalizeOptionalFilter(
      patch.userSearchFilter,
      existing?.userSearchFilter,
      ["{identifier}"],
    ),
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

export function mergeLdapConnection(
  global: StoredLdapProviderConnection | undefined,
  override: StoredLdapProviderConnection | undefined,
): StoredLdapProviderConnection | undefined {
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

export function parseStoredLdapConnection(
  value: unknown,
): StoredLdapProviderConnection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const parsed = compactConnection({
    adminGroups: stringArray(record.adminGroups),
    baseDn: optionalString(record.baseDn),
    bindDn: optionalString(record.bindDn),
    emailAttribute: optionalString(record.emailAttribute),
    groupMap: stringMap(record.groupMap),
    groupNameAttribute: optionalString(record.groupNameAttribute),
    groupSearchBaseDn: optionalString(record.groupSearchBaseDn),
    groupSearchFilter: optionalString(record.groupSearchFilter),
    nameAttribute: optionalString(record.nameAttribute),
    requiredGroups: stringArray(record.requiredGroups),
    startTls: typeof record.startTls === "boolean" ? record.startTls : undefined,
    url: optionalString(record.url),
    userIdAttribute: optionalString(record.userIdAttribute),
    userSearchFilter: optionalString(record.userSearchFilter),
    workspaceGroupMap: stringMap(record.workspaceGroupMap),
    workspaceGroupPrefix: optionalString(record.workspaceGroupPrefix),
  });
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

export function ldapConnectionSummary(
  connection: StoredLdapProviderConnection | undefined,
): AuthProviderLdapConnectionSummary {
  const urlHost = safeLdapHost(connection?.url);
  return {
    adminGroupCount: connection?.adminGroups?.length ?? 0,
    baseDnConfigured: connection?.baseDn !== undefined,
    bindDnConfigured: connection?.bindDn !== undefined,
    groupMappingCount: Object.keys(connection?.groupMap ?? {}).length,
    groupSearchConfigured:
      connection?.groupSearchBaseDn !== undefined ||
      connection?.groupSearchFilter !== undefined,
    requiredGroupCount: connection?.requiredGroups?.length ?? 0,
    startTls: connection?.startTls === true,
    urlConfigured: connection?.url !== undefined,
    ...(urlHost === undefined ? {} : { urlHost }),
    userSearchFilterConfigured: connection?.userSearchFilter !== undefined,
    workspaceGroupMappingCount: Object.keys(connection?.workspaceGroupMap ?? {})
      .length,
    workspaceGroupPrefixConfigured:
      (connection?.workspaceGroupPrefix?.length ?? 0) > 0,
  };
}

export function ldapConfigFromProviderConnection(
  providerId: AuthProviderId,
  connection: StoredLdapProviderConnection,
): ResolvedLdapProviderConnection {
  return {
    adminGroups: connection.adminGroups ?? [],
    baseDn: connection.baseDn ?? "",
    bindDn: connection.bindDn ?? "",
    emailAttribute: connection.emailAttribute ?? defaultEmailAttribute(),
    groupMap: connection.groupMap ?? {},
    groupNameAttribute:
      connection.groupNameAttribute ?? defaultGroupNameAttribute(),
    groupSearchBaseDn: connection.groupSearchBaseDn ?? connection.baseDn ?? "",
    groupSearchFilter:
      connection.groupSearchFilter ?? defaultGroupSearchFilter(),
    nameAttribute: connection.nameAttribute ?? defaultNameAttribute(providerId),
    requiredGroups: connection.requiredGroups ?? [],
    startTls: connection.startTls ?? false,
    url: connection.url ?? "",
    userIdAttribute:
      connection.userIdAttribute ?? defaultUserIdAttribute(providerId),
    userSearchFilter:
      connection.userSearchFilter ?? defaultUserSearchFilter(providerId),
    workspaceGroupMap: connection.workspaceGroupMap ?? {},
    workspaceGroupPrefix: connection.workspaceGroupPrefix ?? "",
  };
}

export function hasLdapConnection(
  connection: StoredLdapProviderConnection | undefined,
): connection is StoredLdapProviderConnection {
  return connection !== undefined && Object.keys(connection).length > 0;
}

export function safeLdapHost(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function normalizeOptionalLdapUrl(
  patch: string | null | undefined,
  existing: string | undefined,
  startTls: boolean | undefined,
): string | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const trimmed = patch.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidLdapConfig("LDAP URL must be a valid ldap:// or ldaps:// URL.");
  }
  if (parsed.protocol !== "ldaps:" && parsed.protocol !== "ldap:") {
    throw invalidLdapConfig("LDAP URL must use ldap:// or ldaps://.");
  }
  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw invalidLdapConfig(
      "LDAP URL must not contain credentials, query, or fragment values.",
    );
  }
  if (parsed.protocol === "ldap:" && startTls !== true) {
    throw invalidLdapConfig("ldap:// requires StartTLS to be enabled.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function assertLdapUrlTlsPolicy(
  url: string | undefined,
  startTls: boolean | undefined,
): void {
  if (url === undefined) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ldap:" && startTls !== true) {
      throw invalidLdapConfig("ldap:// requires StartTLS to be enabled.");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidLdapConfig("LDAP URL must be a valid ldap:// or ldaps:// URL.");
  }
}

function normalizeOptionalDn(
  patch: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  return normalizeOptionalText(patch, existing, 500);
}

function normalizeOptionalAttribute(
  patch: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  const value = normalizeOptionalText(patch, existing, 80);
  if (value === undefined) return undefined;
  if (!/^[A-Za-z][A-Za-z0-9._;-]{0,79}$/u.test(value)) {
    throw invalidLdapConfig("LDAP attribute names must be bounded names.");
  }
  return value;
}

function normalizeOptionalFilter(
  patch: string | null | undefined,
  existing: string | undefined,
  requiredPlaceholders: string[],
): string | undefined {
  const value = normalizeOptionalText(patch, existing, 500);
  if (value === undefined) return undefined;
  if (!value.startsWith("(") || !value.endsWith(")")) {
    throw invalidLdapConfig("LDAP filters must be parenthesized.");
  }
  if (requiredPlaceholders.every((placeholder) => !value.includes(placeholder))) {
    throw invalidLdapConfig(
      `LDAP filters must include one of: ${requiredPlaceholders.join(", ")}.`,
    );
  }
  return value;
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
  if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw invalidLdapConfig("LDAP connection text fields must be bounded.");
  }
  return normalized;
}

function normalizeOptionalBoolean(
  patch: boolean | null | undefined,
  existing: boolean | undefined,
): boolean | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
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
    normalized.some(
      (item) => item.length > 240 || /[\u0000-\u001f\u007f]/u.test(item),
    )
  ) {
    throw invalidLdapConfig("LDAP group lists are limited to bounded entries.");
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
    entries.some(
      ([key, value]) =>
        key.length > 240 ||
        value.length > 200 ||
        /[\u0000-\u001f\u007f]/u.test(key) ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  ) {
    throw invalidLdapConfig(
      "LDAP mapping fields are limited to bounded entries.",
    );
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function defaultUserSearchFilter(providerId: AuthProviderId): string {
  if (providerId === "active-directory") {
    return "(|(userPrincipalName={identifier})(sAMAccountName={identifier})(mail={identifier}))";
  }
  return "(|(mail={identifier})(uid={identifier}))";
}

function defaultGroupSearchFilter(): string {
  return "(member={userDn})";
}

function defaultUserIdAttribute(providerId: AuthProviderId): string {
  return providerId === "active-directory" ? "sAMAccountName" : "uid";
}

function defaultNameAttribute(providerId: AuthProviderId): string {
  return providerId === "active-directory" ? "displayName" : "cn";
}

function defaultEmailAttribute(): string {
  return "mail";
}

function defaultGroupNameAttribute(): string {
  return "cn";
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

function compactConnection(
  input: Partial<Record<keyof StoredLdapProviderConnection, unknown>>,
): StoredLdapProviderConnection {
  const output: StoredLdapProviderConnection = {};
  for (const [key, value] of Object.entries(input) as Array<
    [keyof StoredLdapProviderConnection, unknown]
  >) {
    if (value !== undefined) {
      (output as Record<string, unknown>)[key] = value;
    }
  }
  return output;
}

function invalidLdapConfig(message: string): ApiError {
  return new ApiError("invalid_auth_provider_ldap_config", message, 400);
}
