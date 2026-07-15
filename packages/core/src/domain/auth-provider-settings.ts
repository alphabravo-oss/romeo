import type { AuthProviderId } from "./auth-providers";

export type AuthProviderConfigurationSource = "default" | "global" | "org";

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
  oauth2?: AuthProviderOAuth2ConnectionSummary;
  saml?: AuthProviderSamlConnectionSummary;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
  source: AuthProviderConfigurationSource;
}

export interface AuthProviderOrgOverrideSummary {
  providerId: AuthProviderId;
  enabled?: boolean;
  displayName?: string;
  loginOrder?: number;
  allowedEmailDomains?: string[];
  disabledReason?: string;
  ldap?: AuthProviderLdapConnectionSummary;
  oidc?: AuthProviderOidcConnectionSummary;
  oauth2?: AuthProviderOAuth2ConnectionSummary;
  saml?: AuthProviderSamlConnectionSummary;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
  source: "org";
}

export interface EffectiveAuthProviderSetting extends AuthProviderSettingSummary {
  catalogStatus: "implemented" | "planned";
  protocol: "ldap" | "local" | "oauth2" | "oidc" | "saml";
  runtimePackage: string | null;
}

export interface AuthProviderSettingsReport {
  generatedAt: string;
  global: {
    providers: AuthProviderSettingSummary[];
  };
  orgOverride: {
    orgId: string;
    providers: AuthProviderOrgOverrideSummary[];
  };
  effective: {
    orgId: string;
    providers: EffectiveAuthProviderSetting[];
  };
  notes: string[];
}

export interface AuthProviderConnectionTestRequest {
  providerId: AuthProviderId;
  orgId?: string | undefined;
  oidc?:
    | {
        issuerUrl?: string | undefined;
        clientId?: string | undefined;
      }
    | undefined;
  oauth2?:
    | {
        clientId?: string | undefined;
        secretRef?: string | undefined;
      }
    | undefined;
  ldap?:
    | {
        url?: string | undefined;
        startTls?: boolean | undefined;
        baseDn?: string | undefined;
        bindDn?: string | undefined;
        secretRef?: string | undefined;
        userSearchFilter?: string | undefined;
        groupSearchBaseDn?: string | undefined;
        groupSearchFilter?: string | undefined;
      }
    | undefined;
  saml?:
    | {
        entryPoint?: string | undefined;
        idpCertificateRef?: string | undefined;
        spEntityId?: string | undefined;
      }
    | undefined;
}

export interface AuthProviderConnectionTestReport {
  generatedAt: string;
  providerId: AuthProviderId;
  catalogStatus: "implemented" | "planned";
  protocol: "ldap" | "local" | "oauth2" | "oidc" | "saml";
  runtimePackage: string | null;
  configurationSource: "active_sso" | "provider_settings" | "transient_request";
  status: "disabled" | "failed" | "partial" | "passed";
  enabled: boolean;
  issuerHost?: string;
  detectedProviderPreset?: string;
  checks: AuthProviderConnectionTestCheck[];
  notes: string[];
}

export interface AuthProviderConnectionTestCheck {
  id:
    | "adapter"
    | "api"
    | "configuration"
    | "discovery"
    | "jwks"
    | "ldap_bind"
    | "ldap_search"
    | "oauth2_endpoints"
    | "saml_endpoints"
    | "secret";
  status: "fail" | "pass" | "skip";
  code: string;
}

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

export interface AuthProviderOidcConnectionPatch {
  issuerUrl?: string | null | undefined;
  clientId?: string | null | undefined;
  groupClaim?: string | null | undefined;
  adminGroups?: string[] | null | undefined;
  groupMap?: Record<string, string> | null | undefined;
  workspaceGroupMap?: Record<string, string> | null | undefined;
  workspaceGroupPrefix?: string | null | undefined;
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
  adminGroups?: string[] | null | undefined;
  baseDn?: string | null | undefined;
  bindDn?: string | null | undefined;
  emailAttribute?: string | null | undefined;
  groupMap?: Record<string, string> | null | undefined;
  groupNameAttribute?: string | null | undefined;
  groupSearchBaseDn?: string | null | undefined;
  groupSearchFilter?: string | null | undefined;
  nameAttribute?: string | null | undefined;
  requiredGroups?: string[] | null | undefined;
  startTls?: boolean | null | undefined;
  url?: string | null | undefined;
  userIdAttribute?: string | null | undefined;
  userSearchFilter?: string | null | undefined;
  workspaceGroupMap?: Record<string, string> | null | undefined;
  workspaceGroupPrefix?: string | null | undefined;
}

export interface AuthProviderOAuth2ConnectionSummary {
  adminTeamCount: number;
  clientIdConfigured: boolean;
  groupMappingCount: number;
  requiredOrganizationCount: number;
  requiredTeamCount: number;
  scopeCount: number;
  workspaceTeamMappingCount: number;
  workspaceTeamPrefixConfigured: boolean;
}

export interface AuthProviderOAuth2ConnectionPatch {
  adminTeams?: string[] | null | undefined;
  clientId?: string | null | undefined;
  groupMap?: Record<string, string> | null | undefined;
  requiredOrganizations?: string[] | null | undefined;
  requiredTeams?: string[] | null | undefined;
  scopes?: string[] | null | undefined;
  workspaceTeamMap?: Record<string, string> | null | undefined;
  workspaceTeamPrefix?: string | null | undefined;
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
  signedAssertionRequired: true;
  signedResponseRequired: boolean;
  spEntityIdConfigured: boolean;
  subjectAttribute: string;
  workspaceGroupMappingCount: number;
  workspaceGroupPrefixConfigured: boolean;
}

export interface AuthProviderSamlConnectionPatch {
  acceptedClockSkewMs?: number | null | undefined;
  adminGroups?: string[] | null | undefined;
  emailAttribute?: string | null | undefined;
  entryPoint?: string | null | undefined;
  groupMap?: Record<string, string> | null | undefined;
  groupsAttribute?: string | null | undefined;
  idpIssuer?: string | null | undefined;
  maxAssertionAgeMs?: number | null | undefined;
  nameAttribute?: string | null | undefined;
  requiredGroups?: string[] | null | undefined;
  spEntityId?: string | null | undefined;
  subjectAttribute?: string | null | undefined;
  wantAuthnResponseSigned?: boolean | null | undefined;
  workspaceGroupMap?: Record<string, string> | null | undefined;
  workspaceGroupPrefix?: string | null | undefined;
}

export interface AuthProviderGlobalPatch {
  providerId: AuthProviderId;
  clear?: boolean | undefined;
  enabled?: boolean | undefined;
  displayName?: string | null | undefined;
  loginOrder?: number | null | undefined;
  allowedEmailDomains?: string[] | null | undefined;
  orgOverridesAllowed?: boolean | undefined;
  disabledReason?: string | null | undefined;
  ldap?: AuthProviderLdapConnectionPatch | null | undefined;
  oidc?: AuthProviderOidcConnectionPatch | null | undefined;
  oauth2?: AuthProviderOAuth2ConnectionPatch | null | undefined;
  saml?: AuthProviderSamlConnectionPatch | null | undefined;
  secretRef?: string | null | undefined;
}

export interface AuthProviderOrgOverridePatch {
  providerId: AuthProviderId;
  clear?: boolean | undefined;
  enabled?: boolean | null | undefined;
  displayName?: string | null | undefined;
  loginOrder?: number | null | undefined;
  allowedEmailDomains?: string[] | null | undefined;
  disabledReason?: string | null | undefined;
  ldap?: AuthProviderLdapConnectionPatch | null | undefined;
  oidc?: AuthProviderOidcConnectionPatch | null | undefined;
  oauth2?: AuthProviderOAuth2ConnectionPatch | null | undefined;
  saml?: AuthProviderSamlConnectionPatch | null | undefined;
  secretRef?: string | null | undefined;
}

export interface UpdateAuthProviderSettingsRequest {
  confirmDisableLocalFallback?: boolean | undefined;
  global?:
    | {
        providers: AuthProviderGlobalPatch[];
      }
    | undefined;
  orgOverride?:
    | {
        orgId?: string | undefined;
        providers: AuthProviderOrgOverridePatch[];
      }
    | undefined;
}
