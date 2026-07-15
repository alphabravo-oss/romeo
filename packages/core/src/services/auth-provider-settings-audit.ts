import type { AuthProviderId } from "../domain/auth-providers";
import type { StoredLdapProviderConnection } from "./auth-provider-ldap-config";
import type { StoredOAuth2ProviderConnection } from "./auth-provider-oauth2-config";
import type { StoredOidcProviderConnection } from "./auth-provider-oidc-config";
import type { StoredSamlProviderConnection } from "./auth-provider-saml-config";

export interface AuthProviderAuditSetting {
  enabled?: boolean;
  displayName?: string;
  loginOrder?: number;
  allowedEmailDomains?: string[];
  orgOverridesAllowed?: boolean;
  disabledReason?: string;
  ldap?: StoredLdapProviderConnection;
  oauth2?: StoredOAuth2ProviderConnection;
  oidc?: StoredOidcProviderConnection;
  saml?: StoredSamlProviderConnection;
  secretRef?: string;
}

export type AuthProviderAuditSettingsMap = Partial<
  Record<AuthProviderId, AuthProviderAuditSetting>
>;

export interface AuthProviderSettingsChangeSummary {
  providerIds: AuthProviderId[];
  enabledProviderIds: AuthProviderId[];
  disabledProviderIds: AuthProviderId[];
  clearedProviderIds: AuthProviderId[];
  displayChangedProviderIds: AuthProviderId[];
  loginOrderChangedProviderIds: AuthProviderId[];
  allowedDomainsChangedProviderIds: AuthProviderId[];
  orgOverridePolicyChangedProviderIds: AuthProviderId[];
  disabledReasonChangedProviderIds: AuthProviderId[];
  ldapConnectionChangedProviderIds: AuthProviderId[];
  ldapMappingChangedProviderIds: AuthProviderId[];
  oauth2ConnectionChangedProviderIds: AuthProviderId[];
  oauth2MappingChangedProviderIds: AuthProviderId[];
  oidcConnectionChangedProviderIds: AuthProviderId[];
  oidcMappingChangedProviderIds: AuthProviderId[];
  samlConnectionChangedProviderIds: AuthProviderId[];
  samlMappingChangedProviderIds: AuthProviderId[];
  secretRefChangedProviderIds: AuthProviderId[];
}

export function authProviderSettingsChangeSummary(
  before: AuthProviderAuditSettingsMap,
  after: AuthProviderAuditSettingsMap,
): AuthProviderSettingsChangeSummary {
  const providerIds = allProviderIds(before, after).filter(
    (providerId) =>
      stableStringify(before[providerId]) !==
      stableStringify(after[providerId]),
  );

  return {
    providerIds,
    enabledProviderIds: providerIds.filter(
      (providerId) =>
        before[providerId]?.enabled !== true &&
        after[providerId]?.enabled === true,
    ),
    disabledProviderIds: providerIds.filter(
      (providerId) =>
        before[providerId]?.enabled === true &&
        after[providerId]?.enabled === false,
    ),
    clearedProviderIds: providerIds.filter(
      (providerId) =>
        before[providerId] !== undefined && after[providerId] === undefined,
    ),
    displayChangedProviderIds: changedFieldIds(
      providerIds,
      before,
      after,
      "displayName",
    ),
    loginOrderChangedProviderIds: changedFieldIds(
      providerIds,
      before,
      after,
      "loginOrder",
    ),
    allowedDomainsChangedProviderIds: changedFieldIds(
      providerIds,
      before,
      after,
      "allowedEmailDomains",
    ),
    orgOverridePolicyChangedProviderIds: changedFieldIds(
      providerIds,
      before,
      after,
      "orgOverridesAllowed",
    ),
    disabledReasonChangedProviderIds: changedFieldIds(
      providerIds,
      before,
      after,
      "disabledReason",
    ),
    ldapConnectionChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(ldapConnectionPosture(before[providerId]?.ldap)) !==
        stableStringify(ldapConnectionPosture(after[providerId]?.ldap)),
    ),
    ldapMappingChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(ldapMappingPosture(before[providerId]?.ldap)) !==
        stableStringify(ldapMappingPosture(after[providerId]?.ldap)),
    ),
    oauth2ConnectionChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(oauth2ConnectionPosture(before[providerId]?.oauth2)) !==
        stableStringify(oauth2ConnectionPosture(after[providerId]?.oauth2)),
    ),
    oauth2MappingChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(oauth2MappingPosture(before[providerId]?.oauth2)) !==
        stableStringify(oauth2MappingPosture(after[providerId]?.oauth2)),
    ),
    oidcConnectionChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(oidcConnectionPosture(before[providerId]?.oidc)) !==
        stableStringify(oidcConnectionPosture(after[providerId]?.oidc)),
    ),
    oidcMappingChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(oidcMappingPosture(before[providerId]?.oidc)) !==
        stableStringify(oidcMappingPosture(after[providerId]?.oidc)),
    ),
    samlConnectionChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(samlConnectionPosture(before[providerId]?.saml)) !==
        stableStringify(samlConnectionPosture(after[providerId]?.saml)),
    ),
    samlMappingChangedProviderIds: providerIds.filter(
      (providerId) =>
        stableStringify(samlMappingPosture(before[providerId]?.saml)) !==
        stableStringify(samlMappingPosture(after[providerId]?.saml)),
    ),
    secretRefChangedProviderIds: changedFieldIds(
      providerIds,
      before,
      after,
      "secretRef",
    ),
  };
}

function allProviderIds(
  before: AuthProviderAuditSettingsMap,
  after: AuthProviderAuditSettingsMap,
): AuthProviderId[] {
  return Array.from(
    new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ] as AuthProviderId[]),
  ).sort();
}

function changedFieldIds<K extends keyof AuthProviderAuditSetting>(
  providerIds: AuthProviderId[],
  before: AuthProviderAuditSettingsMap,
  after: AuthProviderAuditSettingsMap,
  field: K,
): AuthProviderId[] {
  return providerIds.filter(
    (providerId) =>
      stableStringify(before[providerId]?.[field]) !==
      stableStringify(after[providerId]?.[field]),
  );
}

function oidcConnectionPosture(
  oidc: StoredOidcProviderConnection | undefined,
): Record<string, boolean> {
  return {
    issuerConfigured: oidc?.issuerUrl !== undefined,
    clientIdConfigured: oidc?.clientId !== undefined,
  };
}

function oauth2ConnectionPosture(
  oauth2: StoredOAuth2ProviderConnection | undefined,
): Record<string, boolean | number> {
  return {
    clientIdConfigured: oauth2?.clientId !== undefined,
    requiredOrganizationCount: oauth2?.requiredOrganizations?.length ?? 0,
    requiredTeamCount: oauth2?.requiredTeams?.length ?? 0,
    scopeCount: oauth2?.scopes?.length ?? 0,
  };
}

function ldapConnectionPosture(
  ldap: StoredLdapProviderConnection | undefined,
): Record<string, boolean | number> {
  return {
    baseDnConfigured: ldap?.baseDn !== undefined,
    bindDnConfigured: ldap?.bindDn !== undefined,
    groupSearchConfigured:
      ldap?.groupSearchBaseDn !== undefined ||
      ldap?.groupSearchFilter !== undefined,
    requiredGroupCount: ldap?.requiredGroups?.length ?? 0,
    startTls: ldap?.startTls === true,
    urlConfigured: ldap?.url !== undefined,
    userSearchFilterConfigured: ldap?.userSearchFilter !== undefined,
  };
}

function ldapMappingPosture(
  ldap: StoredLdapProviderConnection | undefined,
): Record<string, boolean | number> {
  return {
    adminGroupCount: ldap?.adminGroups?.length ?? 0,
    groupMappingCount: Object.keys(ldap?.groupMap ?? {}).length,
    workspaceGroupMappingCount: Object.keys(ldap?.workspaceGroupMap ?? {})
      .length,
    workspaceGroupPrefixConfigured:
      (ldap?.workspaceGroupPrefix?.length ?? 0) > 0,
  };
}

function oauth2MappingPosture(
  oauth2: StoredOAuth2ProviderConnection | undefined,
): Record<string, boolean | number> {
  return {
    adminTeamCount: oauth2?.adminTeams?.length ?? 0,
    groupMappingCount: Object.keys(oauth2?.groupMap ?? {}).length,
    workspaceTeamMappingCount: Object.keys(oauth2?.workspaceTeamMap ?? {})
      .length,
    workspaceTeamPrefixConfigured:
      (oauth2?.workspaceTeamPrefix?.length ?? 0) > 0,
  };
}

function oidcMappingPosture(
  oidc: StoredOidcProviderConnection | undefined,
): Record<string, boolean | number | string | undefined> {
  return {
    groupClaim: oidc?.groupClaim,
    adminGroupCount: oidc?.adminGroups?.length ?? 0,
    groupMappingCount: Object.keys(oidc?.groupMap ?? {}).length,
    workspaceGroupMappingCount: Object.keys(oidc?.workspaceGroupMap ?? {})
      .length,
    workspaceGroupPrefixConfigured:
      (oidc?.workspaceGroupPrefix?.length ?? 0) > 0,
  };
}

function samlConnectionPosture(
  saml: StoredSamlProviderConnection | undefined,
): Record<string, boolean | number> {
  return {
    entryPointConfigured: saml?.entryPoint !== undefined,
    idpIssuerConfigured: saml?.idpIssuer !== undefined,
    signedAssertionRequired: true,
    signedResponseRequired: saml?.wantAuthnResponseSigned === true,
    spEntityIdConfigured: saml?.spEntityId !== undefined,
  };
}

function samlMappingPosture(
  saml: StoredSamlProviderConnection | undefined,
): Record<string, boolean | number | string | undefined> {
  return {
    adminGroupCount: saml?.adminGroups?.length ?? 0,
    emailAttribute: saml?.emailAttribute,
    groupMappingCount: Object.keys(saml?.groupMap ?? {}).length,
    groupsAttribute: saml?.groupsAttribute,
    nameAttribute: saml?.nameAttribute,
    requiredGroupCount: saml?.requiredGroups?.length ?? 0,
    subjectAttribute: saml?.subjectAttribute,
    workspaceGroupMappingCount: Object.keys(saml?.workspaceGroupMap ?? {})
      .length,
    workspaceGroupPrefixConfigured:
      (saml?.workspaceGroupPrefix?.length ?? 0) > 0,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}
