import type { AuthSubject } from "@romeo/auth";

import {
  authProviderCatalog,
  authProviderIds,
  type AuthProviderId,
} from "../domain/auth-providers";
import type { AuthProviderAuditSettingsMap } from "./auth-provider-settings-audit";
import { authProviderSettingsChangeSummary } from "./auth-provider-settings-audit";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { parseStoredLdapConnection } from "./auth-provider-ldap-config";
import { parseStoredOAuth2Connection } from "./auth-provider-oauth2-config";
import { parseStoredOidcConnection } from "./auth-provider-oidc-config";
import { parseStoredSamlConnection } from "./auth-provider-saml-config";
import {
  defaultGlobalSetting,
  globalProviderSetting,
  mergeEffective,
  summarizeEffectiveProvider,
  catalogById,
} from "./auth-provider-settings-resolution";
import type {
  StoredAuthProviderGlobalSettings,
  StoredAuthProviderOrgOverrides,
  StoredGlobalProviderSetting,
  StoredOrgProviderOverride,
} from "./auth-provider-settings-storage-types";
import { stripUndefined } from "./auth-provider-settings-support";

export const globalSettingsKey = "auth_provider_settings.global.v1";
const orgSettingsKeyPrefix = "auth_provider_settings.org.v1:";

export async function readAuthProviderGlobalSettings(
  repository: RomeoRepository,
): Promise<StoredAuthProviderGlobalSettings> {
  const setting = await repository.getSystemSetting(globalSettingsKey);
  return parseGlobalSettings(setting?.value);
}

export async function readAuthProviderOrgSettings(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredAuthProviderOrgOverrides> {
  const setting = await repository.getSystemSetting(orgSettingsKey(orgId));
  return parseOrgSettings(orgId, setting?.value);
}

export function assertLocalFallbackPolicy(
  global: StoredAuthProviderGlobalSettings,
  org: StoredAuthProviderOrgOverrides,
  confirmed: boolean,
): void {
  const local = mergeEffective(
    globalProviderSetting(global, "local"),
    org.providers.local,
  );
  if (local.enabled) return;
  if (!local.enabled && !confirmed) {
    throw new ApiError(
      "local_auth_fallback_confirmation_required",
      "Disabling local auth fallback requires explicit confirmation.",
      400,
    );
  }
  const enabledImplemented = authProviderCatalog.filter((entry) => {
    if (entry.status !== "implemented") return false;
    return mergeEffective(
      globalProviderSetting(global, entry.id),
      org.providers[entry.id],
    ).enabled;
  });
  if (enabledImplemented.length === 0) {
    throw new ApiError(
      "auth_provider_last_admin_path",
      "At least one implemented authentication provider must remain enabled.",
      400,
    );
  }
}

export function sanitizedSettingsAuditMetadata(
  beforeGlobal: StoredAuthProviderGlobalSettings,
  beforeOrg: StoredAuthProviderOrgOverrides,
  global: StoredAuthProviderGlobalSettings,
  org: StoredAuthProviderOrgOverrides,
  changedScopes: string[],
): Record<string, unknown> {
  const effective = authProviderCatalog.map((entry) =>
    summarizeEffectiveProvider(
      entry,
      globalProviderSetting(global, entry.id),
      org.providers[entry.id],
      global.providers[entry.id] === undefined,
    ),
  );
  return {
    changedScopes,
    orgId: org.orgId,
    changeSummary: {
      ...(changedScopes.includes("global")
        ? {
            global: authProviderSettingsChangeSummary(
              globalAuditMap(beforeGlobal),
              globalAuditMap(global),
            ),
          }
        : {}),
      ...(changedScopes.includes("org")
        ? {
            org: authProviderSettingsChangeSummary(
              beforeOrg.providers,
              org.providers,
            ),
          }
        : {}),
    },
    globalProviderCount: Object.keys(global.providers).length,
    orgOverrideProviderCount: Object.keys(org.providers).length,
    enabledProviderIds: effective
      .filter((provider) => provider.enabled)
      .map((provider) => provider.providerId)
      .sort(),
    secretRefConfiguredCount: effective.filter(
      (provider) => provider.secretRefConfigured,
    ).length,
    ldapConfiguredProviderIds: effective
      .filter(
        (provider) =>
          provider.ldap?.urlConfigured === true ||
          provider.ldap?.baseDnConfigured === true ||
          provider.secretRefConfigured,
      )
      .map((provider) => provider.providerId)
      .sort(),
    oauth2ConfiguredProviderIds: effective
      .filter(
        (provider) =>
          provider.oauth2?.clientIdConfigured === true ||
          provider.secretRefConfigured,
      )
      .map((provider) => provider.providerId)
      .sort(),
    oidcConfiguredProviderIds: effective
      .filter(
        (provider) =>
          provider.oidc?.issuerConfigured === true ||
          provider.oidc?.clientIdConfigured === true,
      )
      .map((provider) => provider.providerId)
      .sort(),
    samlConfiguredProviderIds: effective
      .filter(
        (provider) =>
          provider.saml?.entryPointConfigured === true ||
          provider.saml?.spEntityIdConfigured === true ||
          provider.secretRefConfigured,
      )
      .map((provider) => provider.providerId)
      .sort(),
    localFallbackEnabled:
      effective.find((provider) => provider.providerId === "local")?.enabled ??
      false,
  };
}

function globalAuditMap(
  global: StoredAuthProviderGlobalSettings,
): AuthProviderAuditSettingsMap {
  return Object.fromEntries(
    authProviderIds.map((providerId) => [
      providerId,
      globalProviderSetting(global, providerId),
    ]),
  ) as AuthProviderAuditSettingsMap;
}

export function parseGlobalSettings(
  value: Record<string, unknown> | undefined,
): StoredAuthProviderGlobalSettings {
  if (value === undefined || value.version !== 1) {
    return { version: 1, providers: {} };
  }
  return stripUndefined({
    version: 1,
    providers: parseProviderMap(value.providers, parseGlobalProviderSetting),
    updatedAt: optionalString(value.updatedAt),
    updatedBy: optionalString(value.updatedBy),
  }) as StoredAuthProviderGlobalSettings;
}

export function parseOrgSettings(
  orgId: string,
  value: Record<string, unknown> | undefined,
): StoredAuthProviderOrgOverrides {
  if (value === undefined || value.version !== 1) {
    return { version: 1, orgId, providers: {} };
  }
  return stripUndefined({
    version: 1,
    orgId,
    providers: parseProviderMap(value.providers, parseOrgProviderOverride),
    updatedAt: optionalString(value.updatedAt),
    updatedBy: optionalString(value.updatedBy),
  }) as StoredAuthProviderOrgOverrides;
}

function parseProviderMap<T>(
  value: unknown,
  parse: (value: unknown, providerId: AuthProviderId) => T | undefined,
): Partial<Record<AuthProviderId, T>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const providers: Partial<Record<AuthProviderId, T>> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isAuthProviderId(key)) continue;
    const parsed = parse(item, key);
    if (parsed !== undefined) providers[key] = parsed;
  }
  return providers;
}

function parseGlobalProviderSetting(
  value: unknown,
  providerId: AuthProviderId,
): StoredGlobalProviderSetting | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const defaults = defaultGlobalSetting(catalogById(providerId));
  const displayName = optionalString(record.displayName);
  const disabledReason = optionalString(record.disabledReason);
  const ldap = parseStoredLdapConnection(record.ldap);
  const oauth2 = parseStoredOAuth2Connection(record.oauth2);
  const oidc = parseStoredOidcConnection(record.oidc);
  const saml = parseStoredSamlConnection(record.saml);
  const secretRef = optionalString(record.secretRef);
  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
    ...(displayName === undefined ? {} : { displayName }),
    loginOrder:
      typeof record.loginOrder === "number"
        ? record.loginOrder
        : defaults.loginOrder,
    allowedEmailDomains: stringArray(record.allowedEmailDomains),
    orgOverridesAllowed:
      typeof record.orgOverridesAllowed === "boolean"
        ? record.orgOverridesAllowed
        : defaults.orgOverridesAllowed,
    ...(disabledReason === undefined ? {} : { disabledReason }),
    ...(ldap === undefined ? {} : { ldap }),
    ...(oauth2 === undefined ? {} : { oauth2 }),
    ...(oidc === undefined ? {} : { oidc }),
    ...(saml === undefined ? {} : { saml }),
    ...(secretRef === undefined ? {} : { secretRef }),
  };
}

function parseOrgProviderOverride(
  value: unknown,
): StoredOrgProviderOverride | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return stripUndefined({
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    displayName: optionalString(record.displayName),
    loginOrder:
      typeof record.loginOrder === "number" ? record.loginOrder : undefined,
    allowedEmailDomains:
      record.allowedEmailDomains === undefined
        ? undefined
        : stringArray(record.allowedEmailDomains),
    disabledReason: optionalString(record.disabledReason),
    ldap: parseStoredLdapConnection(record.ldap),
    oauth2: parseStoredOAuth2Connection(record.oauth2),
    oidc: parseStoredOidcConnection(record.oidc),
    saml: parseStoredSamlConnection(record.saml),
    secretRef: optionalString(record.secretRef),
  }) as StoredOrgProviderOverride;
}

export function serializeGlobal(
  global: StoredAuthProviderGlobalSettings,
  updatedAt: string,
  updatedBy: string,
): Record<string, unknown> {
  return {
    version: 1,
    providers: global.providers,
    updatedAt,
    updatedBy,
  };
}

export function serializeOrg(
  org: StoredAuthProviderOrgOverrides,
  updatedAt: string,
  updatedBy: string,
): Record<string, unknown> {
  return {
    version: 1,
    orgId: org.orgId,
    providers: org.providers,
    updatedAt,
    updatedBy,
  };
}

export function assertGlobalAdmin(subject: AuthSubject): void {
  if (subject.adminRole === "global_admin") return;
  throw new ApiError(
    "global_admin_required",
    "Global admin role is required for this operation.",
    403,
  );
}

export function orgSettingsKey(orgId: string): string {
  return `${orgSettingsKeyPrefix}${orgId}`;
}

function isAuthProviderId(value: string): value is AuthProviderId {
  return authProviderIds.includes(value as AuthProviderId);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
