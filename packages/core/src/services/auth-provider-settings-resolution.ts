import {
  authProviderCatalog,
  type AuthProviderCatalogEntry,
  type AuthProviderId,
} from "../domain/auth-providers";
import type {
  AuthProviderGlobalPatch,
  AuthProviderOrgOverridePatch,
  AuthProviderOrgOverrideSummary,
  AuthProviderSettingsReport,
  AuthProviderSettingSummary,
  EffectiveAuthProviderSetting,
} from "../domain/auth-provider-settings";
import { ApiError } from "../errors";
import {
  applyLdapConnectionPatch,
  ldapConnectionSummary,
  mergeLdapConnection,
} from "./auth-provider-ldap-config";
import {
  applyOAuth2ConnectionPatch,
  mergeOAuth2Connection,
  oauth2ConnectionSummary,
} from "./auth-provider-oauth2-config";
import {
  applyOidcConnectionPatch,
  mergeOidcConnection,
  oidcConnectionSummary,
} from "./auth-provider-oidc-config";
import {
  applySamlConnectionPatch,
  mergeSamlConnection,
  samlConnectionSummary,
} from "./auth-provider-saml-config";
import {
  normalizeDomainPatch,
  normalizeOptionalDomainPatch,
  normalizeOptionalInteger,
  normalizeOptionalText,
  normalizeSecretRefPatch,
  parseSecretRef,
} from "./auth-provider-settings-normalization";
import type {
  StoredAuthProviderGlobalSettings,
  StoredAuthProviderOrgOverrides,
  StoredGlobalProviderSetting,
  StoredOrgProviderOverride,
} from "./auth-provider-settings-storage-types";
import {
  isAuthProviderEntry,
  settingsNotes,
  stripUndefined,
} from "./auth-provider-settings-support";

export function applyGlobalPatches(
  current: StoredAuthProviderGlobalSettings,
  patches: AuthProviderGlobalPatch[],
): StoredAuthProviderGlobalSettings {
  const next: StoredAuthProviderGlobalSettings = {
    version: 1,
    providers: { ...current.providers },
  };
  for (const patch of patches) {
    assertKnownProvider(patch.providerId);
    const catalogEntry = catalogById(patch.providerId);
    if (patch.clear === true) {
      delete next.providers[patch.providerId];
      continue;
    }
    const defaults = defaultGlobalSetting(catalogEntry);
    const base = next.providers[patch.providerId] ?? defaults;
    const enabled = patch.enabled ?? base.enabled;
    if (enabled && catalogEntry.status !== "implemented") {
      throw new ApiError(
        "auth_provider_not_implemented",
        "Planned authentication providers cannot be enabled yet.",
        400,
        { providerId: patch.providerId },
      );
    }
    const disabledReason = normalizeOptionalText(
      patch.disabledReason,
      base.disabledReason,
      undefined,
      200,
    );
    const secretRef = normalizeSecretRefPatch(patch.secretRef, base.secretRef);
    const ldap = applyLdapConnectionPatch(catalogEntry, base.ldap, patch.ldap);
    const oidc = applyOidcConnectionPatch(catalogEntry, base.oidc, patch.oidc);
    const oauth2 = applyOAuth2ConnectionPatch(
      catalogEntry,
      base.oauth2,
      patch.oauth2,
    );
    const saml = applySamlConnectionPatch(catalogEntry, base.saml, patch.saml);
    next.providers[patch.providerId] = {
      enabled,
      displayName:
        normalizeOptionalText(
          patch.displayName,
          base.displayName,
          catalogEntry.name,
          100,
        ) ?? catalogEntry.name,
      loginOrder:
        normalizeOptionalInteger(
          patch.loginOrder,
          base.loginOrder,
          0,
          1_000,
          "login order",
        ) ?? defaults.loginOrder,
      allowedEmailDomains: normalizeDomainPatch(
        patch.allowedEmailDomains,
        base.allowedEmailDomains,
      ),
      orgOverridesAllowed:
        patch.orgOverridesAllowed ?? base.orgOverridesAllowed,
      ...(disabledReason === undefined ? {} : { disabledReason }),
      ...(ldap === undefined ? {} : { ldap }),
      ...(oauth2 === undefined ? {} : { oauth2 }),
      ...(oidc === undefined ? {} : { oidc }),
      ...(saml === undefined ? {} : { saml }),
      ...(secretRef === undefined ? {} : { secretRef }),
    };
  }
  return next;
}

export function applyOrgPatches(
  global: StoredAuthProviderGlobalSettings,
  current: StoredAuthProviderOrgOverrides,
  patches: AuthProviderOrgOverridePatch[],
): StoredAuthProviderOrgOverrides {
  const next: StoredAuthProviderOrgOverrides = {
    version: 1,
    orgId: current.orgId,
    providers: { ...current.providers },
  };
  for (const patch of patches) {
    assertKnownProvider(patch.providerId);
    const globalSetting = globalProviderSetting(global, patch.providerId);
    if (!globalSetting.orgOverridesAllowed) {
      throw new ApiError(
        "auth_provider_org_overrides_disabled",
        "Organization overrides are disabled for this authentication provider.",
        403,
        { providerId: patch.providerId },
      );
    }
    if (patch.clear === true) {
      delete next.providers[patch.providerId];
      continue;
    }
    const catalogEntry = catalogById(patch.providerId);
    const existing = next.providers[patch.providerId] ?? {};
    const enabled = patch.enabled ?? existing.enabled;
    if (enabled === true && catalogEntry.status !== "implemented") {
      throw new ApiError(
        "auth_provider_not_implemented",
        "Planned authentication providers cannot be enabled yet.",
        400,
        { providerId: patch.providerId },
      );
    }
    const updated = stripUndefined({
      ...existing,
      enabled: patch.enabled === null ? undefined : enabled,
      displayName: normalizeOptionalText(
        patch.displayName,
        existing.displayName,
        undefined,
        100,
      ),
      loginOrder: normalizeOptionalInteger(
        patch.loginOrder,
        existing.loginOrder,
        0,
        1_000,
        "login order",
      ),
      allowedEmailDomains: normalizeOptionalDomainPatch(
        patch.allowedEmailDomains,
        existing.allowedEmailDomains,
      ),
      disabledReason: normalizeOptionalText(
        patch.disabledReason,
        existing.disabledReason,
        undefined,
        200,
      ),
      ldap: applyLdapConnectionPatch(catalogEntry, existing.ldap, patch.ldap),
      oauth2: applyOAuth2ConnectionPatch(
        catalogEntry,
        existing.oauth2,
        patch.oauth2,
      ),
      oidc: applyOidcConnectionPatch(catalogEntry, existing.oidc, patch.oidc),
      saml: applySamlConnectionPatch(catalogEntry, existing.saml, patch.saml),
      secretRef: normalizeSecretRefPatch(patch.secretRef, existing.secretRef),
    }) as StoredOrgProviderOverride;
    next.providers[patch.providerId] = updated;
  }
  return next;
}

export function toReport(
  orgId: string,
  global: StoredAuthProviderGlobalSettings,
  org: StoredAuthProviderOrgOverrides,
): AuthProviderSettingsReport {
  const globalProviders = authProviderCatalog.map((entry) =>
    summarizeGlobalProvider(
      entry,
      globalProviderSetting(global, entry.id),
      global.providers[entry.id] === undefined ? "default" : "global",
    ),
  );
  const orgProviders = Object.entries(org.providers)
    .filter(isAuthProviderEntry)
    .map(([providerId, override]) => summarizeOrgOverride(providerId, override))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
  const effectiveProviders = authProviderCatalog
    .map((entry) =>
      summarizeEffectiveProvider(
        entry,
        globalProviderSetting(global, entry.id),
        org.providers[entry.id],
        global.providers[entry.id] === undefined,
      ),
    )
    .sort(
      (left, right) =>
        left.loginOrder - right.loginOrder ||
        left.displayName.localeCompare(right.displayName),
    );
  return {
    generatedAt: new Date().toISOString(),
    global: { providers: globalProviders },
    orgOverride: { orgId, providers: orgProviders },
    effective: { orgId, providers: effectiveProviders },
    notes: settingsNotes(effectiveProviders),
  };
}

function summarizeGlobalProvider(
  entry: AuthProviderCatalogEntry,
  setting: StoredGlobalProviderSetting,
  source: "default" | "global",
): AuthProviderSettingSummary {
  const parsedSecret = parseSecretRef(setting.secretRef);
  return {
    providerId: entry.id,
    enabled: setting.enabled,
    displayName: setting.displayName ?? entry.name,
    loginOrder: setting.loginOrder,
    allowedEmailDomains: setting.allowedEmailDomains,
    orgOverridesAllowed: setting.orgOverridesAllowed,
    ...(setting.disabledReason === undefined
      ? {}
      : { disabledReason: setting.disabledReason }),
    ...(entry.protocol === "oidc"
      ? { oidc: oidcConnectionSummary(entry.id, setting.oidc) }
      : {}),
    ...(entry.protocol === "ldap"
      ? { ldap: ldapConnectionSummary(setting.ldap) }
      : {}),
    ...(entry.protocol === "oauth2"
      ? { oauth2: oauth2ConnectionSummary(entry.id, setting.oauth2) }
      : {}),
    ...(entry.protocol === "saml"
      ? { saml: samlConnectionSummary(setting.saml) }
      : {}),
    secretRefConfigured: setting.secretRef !== undefined,
    ...(parsedSecret === undefined ? {} : { secretRefScheme: parsedSecret }),
    source,
  };
}

function summarizeOrgOverride(
  providerId: AuthProviderId,
  override: StoredOrgProviderOverride,
): AuthProviderOrgOverrideSummary {
  const parsedSecret = parseSecretRef(override.secretRef);
  return {
    providerId,
    ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
    ...(override.displayName === undefined
      ? {}
      : { displayName: override.displayName }),
    ...(override.loginOrder === undefined
      ? {}
      : { loginOrder: override.loginOrder }),
    ...(override.allowedEmailDomains === undefined
      ? {}
      : { allowedEmailDomains: override.allowedEmailDomains }),
    ...(override.disabledReason === undefined
      ? {}
      : { disabledReason: override.disabledReason }),
    ...(catalogById(providerId).protocol === "oidc"
      ? { oidc: oidcConnectionSummary(providerId, override.oidc) }
      : {}),
    ...(catalogById(providerId).protocol === "ldap"
      ? { ldap: ldapConnectionSummary(override.ldap) }
      : {}),
    ...(catalogById(providerId).protocol === "oauth2"
      ? { oauth2: oauth2ConnectionSummary(providerId, override.oauth2) }
      : {}),
    ...(catalogById(providerId).protocol === "saml"
      ? { saml: samlConnectionSummary(override.saml) }
      : {}),
    secretRefConfigured: override.secretRef !== undefined,
    ...(parsedSecret === undefined ? {} : { secretRefScheme: parsedSecret }),
    source: "org",
  };
}

export function summarizeEffectiveProvider(
  entry: AuthProviderCatalogEntry,
  global: StoredGlobalProviderSetting,
  override: StoredOrgProviderOverride | undefined,
  globalIsDefault: boolean,
): EffectiveAuthProviderSetting {
  const merged = mergeEffective(global, override);
  const parsedSecret = parseSecretRef(merged.secretRef);
  return {
    providerId: entry.id,
    catalogStatus: entry.status,
    protocol: entry.protocol,
    runtimePackage: entry.runtimePackage,
    enabled: merged.enabled,
    displayName: merged.displayName ?? entry.name,
    loginOrder: merged.loginOrder,
    allowedEmailDomains: merged.allowedEmailDomains,
    orgOverridesAllowed: global.orgOverridesAllowed,
    ...(merged.disabledReason === undefined
      ? {}
      : { disabledReason: merged.disabledReason }),
    ...(entry.protocol === "oidc"
      ? { oidc: oidcConnectionSummary(entry.id, merged.oidc) }
      : {}),
    ...(entry.protocol === "ldap"
      ? { ldap: ldapConnectionSummary(merged.ldap) }
      : {}),
    ...(entry.protocol === "oauth2"
      ? { oauth2: oauth2ConnectionSummary(entry.id, merged.oauth2) }
      : {}),
    ...(entry.protocol === "saml"
      ? { saml: samlConnectionSummary(merged.saml) }
      : {}),
    secretRefConfigured: merged.secretRef !== undefined,
    ...(parsedSecret === undefined ? {} : { secretRefScheme: parsedSecret }),
    source:
      override === undefined ? (globalIsDefault ? "default" : "global") : "org",
  };
}

export function mergeEffective(
  global: StoredGlobalProviderSetting,
  override: StoredOrgProviderOverride | undefined,
): StoredGlobalProviderSetting {
  if (override === undefined) return global;
  const displayName = override.displayName ?? global.displayName;
  const disabledReason = override.disabledReason ?? global.disabledReason;
  const ldap = mergeLdapConnection(global.ldap, override.ldap);
  const oauth2 = mergeOAuth2Connection(global.oauth2, override.oauth2);
  const oidc = mergeOidcConnection(global.oidc, override.oidc);
  const saml = mergeSamlConnection(global.saml, override.saml);
  const secretRef = override.secretRef ?? global.secretRef;
  return {
    enabled: override.enabled ?? global.enabled,
    ...(displayName === undefined ? {} : { displayName }),
    loginOrder: override.loginOrder ?? global.loginOrder,
    allowedEmailDomains:
      override.allowedEmailDomains ?? global.allowedEmailDomains,
    orgOverridesAllowed: global.orgOverridesAllowed,
    ...(disabledReason === undefined ? {} : { disabledReason }),
    ...(ldap === undefined ? {} : { ldap }),
    ...(oauth2 === undefined ? {} : { oauth2 }),
    ...(oidc === undefined ? {} : { oidc }),
    ...(saml === undefined ? {} : { saml }),
    ...(secretRef === undefined ? {} : { secretRef }),
  };
}

export function defaultGlobalSetting(
  entry: AuthProviderCatalogEntry,
): StoredGlobalProviderSetting {
  return {
    enabled: entry.id === "local",
    displayName: entry.name,
    loginOrder:
      authProviderCatalog.findIndex((item) => item.id === entry.id) * 10,
    allowedEmailDomains: [],
    orgOverridesAllowed: entry.status === "implemented",
    ...(entry.status === "planned"
      ? { disabledReason: "Provider adapter is planned but not implemented." }
      : {}),
  };
}

export function globalProviderSetting(
  global: StoredAuthProviderGlobalSettings,
  providerId: AuthProviderId,
): StoredGlobalProviderSetting {
  return (
    global.providers[providerId] ??
    defaultGlobalSetting(catalogById(providerId))
  );
}

export function catalogById(
  providerId: AuthProviderId,
): AuthProviderCatalogEntry {
  const entry = authProviderCatalog.find((item) => item.id === providerId);
  if (entry === undefined) {
    throw new ApiError(
      "auth_provider_unknown",
      "Authentication provider is not supported.",
      400,
      { providerId },
    );
  }
  return entry;
}

export function assertKnownProvider(providerId: AuthProviderId): void {
  void catalogById(providerId);
}
