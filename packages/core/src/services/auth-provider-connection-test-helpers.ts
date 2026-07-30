import type { AuthSubject } from "@romeo/auth";

import type {
  AuthProviderCatalogEntry,
  AuthProviderId,
} from "../domain/auth-providers";
import type {
  AuthProviderConnectionTestReport,
  AuthProviderConnectionTestRequest,
  AuthProviderLdapConnectionSummary,
  AuthProviderOAuth2ConnectionSummary,
  AuthProviderSamlConnectionSummary,
} from "../domain/auth-provider-settings";
import { ApiError } from "../errors";
import {
  applyLdapConnectionPatch,
  type ResolvedLdapProviderConnection,
  type StoredLdapProviderConnection,
} from "./auth-provider-ldap-config";
import {
  oauth2ConfigFromProviderConnection,
  type StoredOAuth2ProviderConnection,
} from "./auth-provider-oauth2-config";
import {
  applySamlConnectionPatch,
  type ResolvedSamlProviderConnection,
  type StoredSamlProviderConnection,
} from "./auth-provider-saml-config";
import {
  hasOidcConnection,
  oidcConfigFromProviderConnection,
  type StoredOidcProviderConnection,
} from "./auth-provider-oidc-config";
import { catalogById } from "./auth-provider-settings-resolution";
import { assertGlobalAdmin } from "./auth-provider-settings-storage";
import { stripUndefined } from "./auth-provider-settings-support";
import type { ResolvedSsoOidcConfig } from "./sso-config";
import { assertTrustedMetadataUrl, normalizeIssuer } from "./sso-config";
import { parseManagedSecretRef } from "./secret-refs";

export function localConnectionTestReport(
  entry: AuthProviderCatalogEntry,
  enabled: boolean,
): AuthProviderConnectionTestReport {
  return {
    generatedAt: new Date().toISOString(),
    providerId: entry.id,
    catalogStatus: entry.status,
    protocol: entry.protocol,
    runtimePackage: entry.runtimePackage,
    configurationSource: "provider_settings",
    status: enabled ? "passed" : "disabled",
    enabled,
    checks: [
      {
        id: "adapter",
        status: enabled ? "pass" : "skip",
        code: enabled ? "local_auth_adapter_available" : "local_auth_disabled",
      },
    ],
    notes: enabled
      ? [
          "Local email/password authentication and local TOTP MFA are available for this effective policy.",
        ]
      : ["Local authentication is disabled for this effective policy."],
  };
}

export function transientOAuth2Connection(
  providerId: AuthProviderId,
  existing: StoredOAuth2ProviderConnection | undefined,
  oauth2: AuthProviderConnectionTestRequest["oauth2"],
): StoredOAuth2ProviderConnection | undefined {
  if (oauth2 === undefined) return existing;
  const clientId =
    oauth2.clientId === undefined
      ? existing?.clientId
      : normalizeConnectionTestClientId(oauth2.clientId);
  return stripUndefined({
    ...existing,
    clientId,
    scopes:
      existing?.scopes ??
      oauth2ConfigFromProviderConnection(providerId, existing ?? {}).scopes,
  }) as StoredOAuth2ProviderConnection;
}

export function transientLdapConnection(
  providerId: AuthProviderId,
  existing: StoredLdapProviderConnection | undefined,
  ldap: AuthProviderConnectionTestRequest["ldap"],
): StoredLdapProviderConnection | undefined {
  if (ldap === undefined) return existing;
  return applyLdapConnectionPatch(catalogById(providerId), existing, ldap);
}

export function transientSamlConnection(
  providerId: AuthProviderId,
  existing: StoredSamlProviderConnection | undefined,
  saml: AuthProviderConnectionTestRequest["saml"],
): StoredSamlProviderConnection | undefined {
  if (saml === undefined) return existing;
  return applySamlConnectionPatch(catalogById(providerId), existing, {
    entryPoint: saml.entryPoint,
    spEntityId: saml.spEntityId,
  });
}

export function ldapConfigComplete(
  config: ResolvedLdapProviderConnection,
): boolean {
  return (
    config.url.length > 0 &&
    config.baseDn.length > 0 &&
    config.bindDn.length > 0 &&
    config.userSearchFilter.length > 0 &&
    config.userIdAttribute.length > 0 &&
    config.emailAttribute.length > 0 &&
    config.groupNameAttribute.length > 0
  );
}

export function samlConfigComplete(
  config: ResolvedSamlProviderConnection,
): boolean {
  return config.entryPoint.length > 0 && config.spEntityId.length > 0;
}

export function samlConfigurationCheck(
  enabled: boolean,
  summary: AuthProviderSamlConnectionSummary,
  secretRef: string | undefined,
): AuthProviderConnectionTestReport["checks"][number] {
  if (!enabled) {
    return {
      id: "configuration",
      status: "skip",
      code: "auth_provider_disabled",
    };
  }
  if (!summary.entryPointConfigured) {
    return {
      id: "configuration",
      status: "fail",
      code: "saml_entry_point_missing",
    };
  }
  if (!summary.spEntityIdConfigured) {
    return {
      id: "configuration",
      status: "fail",
      code: "saml_sp_entity_id_missing",
    };
  }
  if (secretRef === undefined) {
    return {
      id: "configuration",
      status: "fail",
      code: "saml_idp_certificate_ref_missing",
    };
  }
  return {
    id: "configuration",
    status: "pass",
    code: "saml_config_complete",
  };
}

export function ldapConfigurationCheck(
  enabled: boolean,
  summary: AuthProviderLdapConnectionSummary,
  secretRef: string | undefined,
): AuthProviderConnectionTestReport["checks"][number] {
  if (!enabled) {
    return {
      id: "configuration",
      status: "skip",
      code: "auth_provider_disabled",
    };
  }
  if (!summary.urlConfigured) {
    return {
      id: "configuration",
      status: "fail",
      code: "ldap_url_missing",
    };
  }
  if (!summary.baseDnConfigured) {
    return {
      id: "configuration",
      status: "fail",
      code: "ldap_base_dn_missing",
    };
  }
  if (!summary.bindDnConfigured) {
    return {
      id: "configuration",
      status: "fail",
      code: "ldap_bind_dn_missing",
    };
  }
  if (secretRef === undefined) {
    return {
      id: "configuration",
      status: "fail",
      code: "ldap_bind_secret_ref_missing",
    };
  }
  return {
    id: "configuration",
    status: "pass",
    code: "ldap_config_complete",
  };
}

export function oauth2ConfigurationCheck(
  enabled: boolean,
  summary: AuthProviderOAuth2ConnectionSummary,
  secretRef: string | undefined,
): AuthProviderConnectionTestReport["checks"][number] {
  if (!enabled) {
    return {
      id: "configuration",
      status: "skip",
      code: "auth_provider_disabled",
    };
  }
  if (!summary.clientIdConfigured) {
    return {
      id: "configuration",
      status: "fail",
      code: "oauth2_client_id_missing",
    };
  }
  if (secretRef === undefined) {
    return {
      id: "configuration",
      status: "fail",
      code: "oauth2_client_secret_ref_missing",
    };
  }
  return {
    id: "configuration",
    status: "pass",
    code: "oauth2_config_complete",
  };
}

export function connectionStatus(
  enabled: boolean,
  checks: AuthProviderConnectionTestReport["checks"],
): AuthProviderConnectionTestReport["status"] {
  if (!enabled) return "disabled";
  if (checks.some((check) => check.status === "fail")) return "failed";
  if (checks.some((check) => check.status === "skip")) return "partial";
  return "passed";
}

export function oidcConnectionTestConfig(
  providerId: AuthProviderId,
  activeConfig: ResolvedSsoOidcConfig,
  providerConnection: StoredOidcProviderConnection | undefined,
  oidc: AuthProviderConnectionTestRequest["oidc"],
): {
  config: ResolvedSsoOidcConfig;
  source: AuthProviderConnectionTestReport["configurationSource"];
} {
  const hasTransientInput =
    oidc !== undefined &&
    (oidc.issuerUrl !== undefined || oidc.clientId !== undefined);
  if (!hasTransientInput) {
    if (hasOidcConnection(providerConnection)) {
      return {
        config: oidcConfigFromProviderConnection(
          providerId,
          providerConnection,
        ),
        source: "provider_settings",
      };
    }
    return { config: activeConfig, source: "active_sso" };
  }
  const issuerUrl =
    oidc?.issuerUrl === undefined
      ? activeConfig.issuerUrl
      : normalizeConnectionTestIssuer(oidc.issuerUrl);
  const clientId =
    oidc?.clientId === undefined
      ? activeConfig.clientId
      : normalizeConnectionTestClientId(oidc.clientId);
  return {
    config: {
      ...activeConfig,
      enabled: issuerUrl.length > 0 && clientId.length > 0,
      issuerUrl,
      clientId,
    },
    source: "transient_request",
  };
}

function normalizeConnectionTestIssuer(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const issuer = normalizeIssuer(trimmed);
  try {
    assertTrustedMetadataUrl(issuer);
    return issuer;
  } catch {
    throw new ApiError(
      "invalid_auth_provider_connection_test",
      "OIDC issuer URL must use HTTPS outside localhost.",
      400,
    );
  }
}

function normalizeConnectionTestClientId(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new ApiError(
      "invalid_auth_provider_connection_test",
      "OIDC client ID must be at most 200 characters.",
      400,
    );
  }
  return normalized;
}

export function normalizeConnectionTestSecretRef(
  value: string,
): string | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  parseManagedSecretRef(normalized);
  return normalized;
}

export function connectionTestOrgId(
  subject: AuthSubject,
  orgId: string | undefined,
): string {
  const normalized = orgId?.trim();
  if (normalized !== undefined && normalized.length === 0) {
    throw new ApiError(
      "invalid_auth_provider_connection_test",
      "Organization ID cannot be empty.",
      400,
    );
  }
  const targetOrgId = normalized ?? subject.orgId;
  if (targetOrgId !== subject.orgId) assertGlobalAdmin(subject);
  return targetOrgId;
}
