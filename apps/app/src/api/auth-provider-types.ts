// Mirrors packages/core/src/domain/auth-providers.ts + auth-provider-settings.ts

export type AuthProviderId =
  | "local"
  | "generic-oidc"
  | "keycloak"
  | "google"
  | "github"
  | "azure-ad"
  | "okta"
  | "auth0"
  | "ldap"
  | "active-directory"
  | "saml";

export type AuthProviderProtocol =
  | "ldap"
  | "local"
  | "oauth2"
  | "oidc"
  | "saml";

export interface AuthProviderCatalogEntry {
  id: AuthProviderId;
  name: string;
  protocol: AuthProviderProtocol;
  configurationScopes: Array<"global" | "org">;
  runtimePackage: string | null;
  status: "implemented" | "planned";
  supportsJitProvisioning: boolean;
  supportsLocalFallback: boolean;
  supportsMfaDelegation: boolean;
  notes: string[];
}

export type AuthProviderConfigurationSource = "default" | "global" | "org";

export interface AuthProviderOidcConnectionSummary {
  issuerConfigured: boolean;
  issuerHost?: string;
  clientIdConfigured: boolean;
  groupClaim: string;
  adminGroupCount: number;
  groupMappingCount: number;
  workspaceGroupMappingCount: number;
  workspaceGroupPrefixConfigured: boolean;
}

export interface AuthProviderLdapConnectionSummary {
  adminGroupCount: number;
  baseDnConfigured: boolean;
  bindDnConfigured: boolean;
  groupMappingCount: number;
  groupSearchConfigured: boolean;
  requiredGroupCount: number;
  startTls: boolean;
  urlConfigured: boolean;
  urlHost?: string;
  userSearchFilterConfigured: boolean;
  workspaceGroupMappingCount: number;
  workspaceGroupPrefixConfigured: boolean;
}

export interface AuthProviderLdapConnectionPatch {
  adminGroups?: string[] | null;
  baseDn?: string | null;
  bindDn?: string | null;
  emailAttribute?: string | null;
  groupMap?: Record<string, string> | null;
  groupNameAttribute?: string | null;
  groupSearchBaseDn?: string | null;
  groupSearchFilter?: string | null;
  nameAttribute?: string | null;
  requiredGroups?: string[] | null;
  startTls?: boolean | null;
  url?: string | null;
  userIdAttribute?: string | null;
  userSearchFilter?: string | null;
  workspaceGroupMap?: Record<string, string> | null;
  workspaceGroupPrefix?: string | null;
}

export interface AuthProviderSamlConnectionSummary {
  acceptedClockSkewMs: number;
  adminGroupCount: number;
  emailAttribute: string;
  entryPointConfigured: boolean;
  entryPointHost?: string;
  groupMappingCount: number;
  groupsAttribute: string;
  idpIssuerConfigured: boolean;
  maxAssertionAgeMs: number;
  nameAttribute: string;
  requiredGroupCount: number;
  signedResponseRequired: boolean;
  spEntityIdConfigured: boolean;
}

export interface AuthProviderSamlConnectionPatch {
  acceptedClockSkewMs?: number | null;
  adminGroups?: string[] | null;
  emailAttribute?: string | null;
  entryPoint?: string | null;
  groupMap?: Record<string, string> | null;
  groupsAttribute?: string | null;
  idpIssuer?: string | null;
  maxAssertionAgeMs?: number | null;
  nameAttribute?: string | null;
  requiredGroups?: string[] | null;
  spEntityId?: string | null;
  subjectAttribute?: string | null;
  wantAuthnResponseSigned?: boolean | null;
  workspaceGroupMap?: Record<string, string> | null;
  workspaceGroupPrefix?: string | null;
}

export interface AuthProviderSettingSummary {
  providerId: AuthProviderId;
  enabled: boolean;
  displayName: string;
  loginOrder: number;
  allowedEmailDomains: string[];
  orgOverridesAllowed: boolean;
  disabledReason?: string;
  ldap?: AuthProviderLdapConnectionSummary;
  oidc?: AuthProviderOidcConnectionSummary;
  saml?: AuthProviderSamlConnectionSummary;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
  source: AuthProviderConfigurationSource;
}

export interface EffectiveAuthProviderSetting extends AuthProviderSettingSummary {
  catalogStatus: "implemented" | "planned";
  protocol: AuthProviderProtocol;
  runtimePackage: string | null;
}

export interface AuthProviderOrgOverrideSummary {
  providerId: AuthProviderId;
  enabled?: boolean;
  displayName?: string;
  loginOrder?: number;
  allowedEmailDomains?: string[];
  disabledReason?: string;
  oidc?: AuthProviderOidcConnectionSummary;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
  source: "org";
}

export interface AuthProviderSettingsReport {
  generatedAt: string;
  global: { providers: AuthProviderSettingSummary[] };
  orgOverride: { orgId: string; providers: AuthProviderOrgOverrideSummary[] };
  effective: { orgId: string; providers: EffectiveAuthProviderSetting[] };
  notes: string[];
}

export interface AuthProviderOidcConnectionPatch {
  issuerUrl?: string | null;
  clientId?: string | null;
  groupClaim?: string | null;
  adminGroups?: string[] | null;
  groupMap?: Record<string, string> | null;
  workspaceGroupMap?: Record<string, string> | null;
  workspaceGroupPrefix?: string | null;
}

export interface AuthProviderGlobalPatch {
  providerId: AuthProviderId;
  clear?: boolean;
  enabled?: boolean;
  displayName?: string | null;
  loginOrder?: number | null;
  allowedEmailDomains?: string[] | null;
  orgOverridesAllowed?: boolean;
  disabledReason?: string | null;
  ldap?: AuthProviderLdapConnectionPatch | null;
  oidc?: AuthProviderOidcConnectionPatch | null;
  saml?: AuthProviderSamlConnectionPatch | null;
  secretRef?: string | null;
}

export interface AuthProviderOrgOverridePatch {
  providerId: AuthProviderId;
  clear?: boolean;
  enabled?: boolean | null;
  displayName?: string | null;
  loginOrder?: number | null;
  allowedEmailDomains?: string[] | null;
  disabledReason?: string | null;
  ldap?: AuthProviderLdapConnectionPatch | null;
  oidc?: AuthProviderOidcConnectionPatch | null;
  saml?: AuthProviderSamlConnectionPatch | null;
  secretRef?: string | null;
}

export interface UpdateAuthProviderSettingsRequest {
  confirmDisableLocalFallback?: boolean;
  global?: { providers: AuthProviderGlobalPatch[] };
  orgOverride?: { orgId?: string; providers: AuthProviderOrgOverridePatch[] };
}

export interface AuthProviderConnectionTestRequest {
  providerId: AuthProviderId;
  orgId?: string;
  oidc?: { issuerUrl?: string; clientId?: string };
  saml?: { entryPoint?: string; idpCertificateRef?: string; spEntityId?: string };
}

export interface AuthProviderConnectionTestCheck {
  id: "adapter" | "configuration" | "discovery" | "jwks";
  status: "fail" | "pass" | "skip";
  code: string;
}

export interface AuthProviderConnectionTestReport {
  generatedAt: string;
  providerId: AuthProviderId;
  catalogStatus: "implemented" | "planned";
  protocol: AuthProviderProtocol;
  runtimePackage: string | null;
  configurationSource: "active_sso" | "provider_settings" | "transient_request";
  status: "disabled" | "failed" | "partial" | "passed";
  enabled: boolean;
  issuerHost?: string;
  detectedProviderPreset?: string;
  checks: AuthProviderConnectionTestCheck[];
  notes: string[];
}

export type ManagedSecretPurpose =
  | "auth_provider_client_secret"
  | "data_connector_credential"
  | "model_provider_credential"
  | "tool_connector_credential";

export interface CreateManagedSecretRequest {
  name?: string;
  orgId?: string;
  purpose: ManagedSecretPurpose;
  scope?: "global" | "org";
  value: string;
}

export interface ManagedSecretReference {
  createdAt: string;
  nameConfigured: boolean;
  orgId?: string;
  purpose: ManagedSecretPurpose;
  scope: "global" | "org";
  secretRef: string;
  secretRefScheme: "romeo-secret";
  valueStored: true;
}

// Mirrors packages/core/src/domain/directory-sync.ts (directorySyncSchema).
export type DirectorySyncSource =
  | "active-directory"
  | "ldap"
  | "manual"
  | "oidc"
  | "saml"
  | "scim";

export interface DirectorySyncGroupInventory {
  groupId: string;
  presentUserIds: string[];
}

export interface DirectorySyncRequest {
  allowAdminUserDisable?: boolean;
  confirmApply?: "apply-directory-sync";
  disableMissingUsers?: boolean;
  dryRun?: boolean;
  groupMemberships?: DirectorySyncGroupInventory[];
  maxMembershipRemovals?: number;
  maxUserDisables?: number;
  presentUserEmails?: string[];
  presentUserIds?: string[];
  preserveAdminUsers?: boolean;
  reason?: string;
  removeMissingGroupMembers?: boolean;
  source: DirectorySyncSource;
}

export interface DirectorySyncUserDisablePlan {
  count: number;
  skippedAdminUserIds: string[];
  skippedSelfUserIds: string[];
  userIds: string[];
}

export interface DirectorySyncGroupRemovalPlan {
  count: number;
  groupId: string;
  userIds: string[];
}

export interface DirectorySyncMembershipRemovalPlan {
  count: number;
  groups: DirectorySyncGroupRemovalPlan[];
  skippedSelfUserIds: string[];
}

export interface DirectorySyncResult {
  changes: {
    membershipRemovals: DirectorySyncMembershipRemovalPlan;
    userDisables: DirectorySyncUserDisablePlan;
  };
  generatedAt: string;
  limits: {
    maxMembershipRemovals: number;
    maxUserDisables: number;
  };
  mode: "apply" | "preview";
  orgId: string;
  redaction: {
    externalGroupNamesReturned: false;
    externalSubjectIdsReturned: false;
    rawDirectoryPayloadReturned: false;
    userEmailsReturned: false;
    userNamesReturned: false;
  };
  requested: {
    disableMissingUsers: boolean;
    preserveAdminUsers: boolean;
    removeMissingGroupMembers: boolean;
  };
  schema: "romeo.directory-sync.v1";
  source: DirectorySyncSource;
  status: "applied" | "preview";
  warnings: string[];
}

// Mirrors packages/core/src/http/schemas.ts (deprovisionSsoOidcUserSchema) and
// SsoOidcDeprovisionResult in services/sso-settings-service.ts.
export interface DeprovisionSsoOidcUserRequest {
  oidcSubject: string;
  confirmOidcSubject: string;
  issuerUrl?: string;
}

export interface DeprovisionSsoOidcUserResult {
  status: "already_disabled" | "disabled";
  issuerHost?: string;
  user: DeprovisionSsoOidcUser;
}

export interface DeprovisionSsoOidcUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: "user" | "org_admin" | "global_admin";
  disabledAt?: string;
}
