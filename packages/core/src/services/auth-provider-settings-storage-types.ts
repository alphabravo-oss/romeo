import type { AuthProviderId } from "../domain/auth-providers";
import type { StoredLdapProviderConnection } from "./auth-provider-ldap-config";
import type { StoredOAuth2ProviderConnection } from "./auth-provider-oauth2-config";
import type { StoredOidcProviderConnection } from "./auth-provider-oidc-config";
import type { StoredSamlProviderConnection } from "./auth-provider-saml-config";

export interface StoredAuthProviderGlobalSettings {
  version: 1;
  providers: Partial<Record<AuthProviderId, StoredGlobalProviderSetting>>;
  updatedAt?: string;
  updatedBy?: string;
}

export interface StoredAuthProviderOrgOverrides {
  version: 1;
  orgId: string;
  providers: Partial<Record<AuthProviderId, StoredOrgProviderOverride>>;
  updatedAt?: string;
  updatedBy?: string;
}

export interface StoredGlobalProviderSetting {
  enabled: boolean;
  displayName?: string;
  loginOrder: number;
  allowedEmailDomains: string[];
  orgOverridesAllowed: boolean;
  disabledReason?: string;
  ldap?: StoredLdapProviderConnection;
  oauth2?: StoredOAuth2ProviderConnection;
  oidc?: StoredOidcProviderConnection;
  saml?: StoredSamlProviderConnection;
  secretRef?: string;
}

export interface StoredOrgProviderOverride {
  enabled?: boolean;
  displayName?: string;
  loginOrder?: number;
  allowedEmailDomains?: string[];
  disabledReason?: string;
  ldap?: StoredLdapProviderConnection;
  oauth2?: StoredOAuth2ProviderConnection;
  oidc?: StoredOidcProviderConnection;
  saml?: StoredSamlProviderConnection;
  secretRef?: string;
}
