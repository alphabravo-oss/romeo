import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import {
  authProviderCatalog,
  authProviderIds,
  type AuthProviderCatalogEntry,
  type AuthProviderId,
} from "../domain/auth-providers";
import type {
  AuthProviderConnectionTestReport,
  AuthProviderConnectionTestRequest,
  AuthProviderGlobalPatch,
  AuthProviderLdapConnectionSummary,
  AuthProviderOAuth2ConnectionSummary,
  AuthProviderOrgOverridePatch,
  AuthProviderOrgOverrideSummary,
  AuthProviderSamlConnectionSummary,
  AuthProviderSettingsReport,
  AuthProviderSettingSummary,
  EffectiveAuthProviderSetting,
  UpdateAuthProviderSettingsRequest,
} from "../domain/auth-provider-settings";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import { detectSsoOidcProviderPreset } from "../domain/sso-provider-presets";
import {
  applyOidcConnectionPatch,
  hasOidcConnection,
  mergeOidcConnection,
  oidcConfigFromProviderConnection,
  oidcConnectionSummary,
  parseStoredOidcConnection,
  type StoredOidcProviderConnection,
} from "./auth-provider-oidc-config";
import {
  applyLdapConnectionPatch,
  hasLdapConnection,
  ldapConfigFromProviderConnection,
  ldapConnectionSummary,
  mergeLdapConnection,
  parseStoredLdapConnection,
  type ResolvedLdapProviderConnection,
  type StoredLdapProviderConnection,
} from "./auth-provider-ldap-config";
import {
  authProviderSettingsChangeSummary,
  type AuthProviderAuditSettingsMap,
} from "./auth-provider-settings-audit";
import {
  applyOAuth2ConnectionPatch,
  hasOAuth2Connection,
  mergeOAuth2Connection,
  oauth2ConfigFromProviderConnection,
  oauth2ConnectionSummary,
  parseStoredOAuth2Connection,
  type ResolvedOAuth2ProviderConnection,
  type StoredOAuth2ProviderConnection,
} from "./auth-provider-oauth2-config";
import {
  applySamlConnectionPatch,
  hasSamlConnection,
  mergeSamlConnection,
  parseStoredSamlConnection,
  samlConfigFromProviderConnection,
  samlConnectionSummary,
  type ResolvedSamlProviderConnection,
  type StoredSamlProviderConnection,
} from "./auth-provider-saml-config";
import { testOidcConnection } from "./oidc-connection-test";
import { parseManagedSecretRef } from "./secret-refs";
import type { SecretResolver } from "./secret-resolver";
import {
  defaultLdapClientFactory,
  type LdapClientFactory,
} from "./ldap-directory-client";
import {
  assertTrustedMetadataUrl,
  normalizeIssuer,
  resolveSsoOidcConfig,
  type ResolvedSsoOidcConfig,
} from "./sso-config";

const globalSettingsKey = "auth_provider_settings.global.v1";
const orgSettingsKeyPrefix = "auth_provider_settings.org.v1:";

interface StoredAuthProviderGlobalSettings {
  version: 1;
  providers: Partial<Record<AuthProviderId, StoredGlobalProviderSetting>>;
  updatedAt?: string;
  updatedBy?: string;
}

interface StoredAuthProviderOrgOverrides {
  version: 1;
  orgId: string;
  providers: Partial<Record<AuthProviderId, StoredOrgProviderOverride>>;
  updatedAt?: string;
  updatedBy?: string;
}

interface StoredGlobalProviderSetting {
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

interface StoredOrgProviderOverride {
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

export interface OAuth2ProviderLoginConfig extends ResolvedOAuth2ProviderConnection {
  allowedEmailDomains: string[];
  orgId: string;
  providerId: AuthProviderId;
  secretRef: string;
}

export interface LdapProviderLoginConfig extends ResolvedLdapProviderConnection {
  allowedEmailDomains: string[];
  orgId: string;
  providerId: AuthProviderId;
  secretRef: string;
}

export interface SamlProviderLoginConfig extends ResolvedSamlProviderConnection {
  allowedEmailDomains: string[];
  orgId: string;
  providerId: AuthProviderId;
  secretRef: string;
}

export class AuthProviderSettingsService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly secretResolver?: SecretResolver,
    private readonly ldapClientFactory?: LdapClientFactory,
  ) {}

  async report(subject: AuthSubject): Promise<AuthProviderSettingsReport> {
    assertScope(subject, "admin:read");
    const global = await this.readGlobal(this.repository);
    const org = await this.readOrg(this.repository, subject.orgId);
    return toReport(subject.orgId, global, org);
  }

  async oidcConfigForProvider(input: {
    providerId: AuthProviderId;
    orgId: string;
  }): Promise<ResolvedSsoOidcConfig | undefined> {
    const entry = catalogById(input.providerId);
    if (entry.status !== "implemented" || entry.protocol !== "oidc") {
      return undefined;
    }
    const global = await this.readGlobal(this.repository);
    const org = await this.readOrg(this.repository, input.orgId);
    const effective = mergeEffective(
      globalProviderSetting(global, entry.id),
      org.providers[entry.id],
    );
    if (!effective.enabled || !hasOidcConnection(effective.oidc)) {
      return undefined;
    }
    return oidcConfigFromProviderConnection(entry.id, effective.oidc);
  }

  async oauth2ConfigForProvider(input: {
    providerId: AuthProviderId;
    orgId: string;
  }): Promise<OAuth2ProviderLoginConfig | undefined> {
    const entry = catalogById(input.providerId);
    if (entry.status !== "implemented" || entry.protocol !== "oauth2") {
      return undefined;
    }
    const global = await this.readGlobal(this.repository);
    const org = await this.readOrg(this.repository, input.orgId);
    const effective = mergeEffective(
      globalProviderSetting(global, entry.id),
      org.providers[entry.id],
    );
    if (
      !effective.enabled ||
      !hasOAuth2Connection(effective.oauth2) ||
      effective.secretRef === undefined
    ) {
      return undefined;
    }
    const config = oauth2ConfigFromProviderConnection(
      entry.id,
      effective.oauth2,
    );
    if (config.clientId.length === 0) return undefined;
    return {
      ...config,
      allowedEmailDomains: effective.allowedEmailDomains,
      orgId: input.orgId,
      providerId: entry.id,
      secretRef: effective.secretRef,
    };
  }

  async ldapConfigForProvider(input: {
    providerId: AuthProviderId;
    orgId: string;
  }): Promise<LdapProviderLoginConfig | undefined> {
    const entry = catalogById(input.providerId);
    if (entry.status !== "implemented" || entry.protocol !== "ldap") {
      return undefined;
    }
    const global = await this.readGlobal(this.repository);
    const org = await this.readOrg(this.repository, input.orgId);
    const effective = mergeEffective(
      globalProviderSetting(global, entry.id),
      org.providers[entry.id],
    );
    if (
      !effective.enabled ||
      !hasLdapConnection(effective.ldap) ||
      effective.secretRef === undefined
    ) {
      return undefined;
    }
    const config = ldapConfigFromProviderConnection(entry.id, effective.ldap);
    if (!ldapConfigComplete(config)) return undefined;
    return {
      ...config,
      allowedEmailDomains: effective.allowedEmailDomains,
      orgId: input.orgId,
      providerId: entry.id,
      secretRef: effective.secretRef,
    };
  }

  async samlConfigForProvider(input: {
    providerId: AuthProviderId;
    orgId: string;
  }): Promise<SamlProviderLoginConfig | undefined> {
    const entry = catalogById(input.providerId);
    if (entry.status !== "implemented" || entry.protocol !== "saml") {
      return undefined;
    }
    const global = await this.readGlobal(this.repository);
    const org = await this.readOrg(this.repository, input.orgId);
    const effective = mergeEffective(
      globalProviderSetting(global, entry.id),
      org.providers[entry.id],
    );
    if (
      !effective.enabled ||
      !hasSamlConnection(effective.saml) ||
      effective.secretRef === undefined
    ) {
      return undefined;
    }
    const config = samlConfigFromProviderConnection(effective.saml);
    if (!samlConfigComplete(config)) return undefined;
    return {
      ...config,
      allowedEmailDomains: effective.allowedEmailDomains,
      orgId: input.orgId,
      providerId: entry.id,
      secretRef: effective.secretRef,
    };
  }

  async connectionTest(input: {
    subject: AuthSubject;
    test: AuthProviderConnectionTestRequest;
  }): Promise<AuthProviderConnectionTestReport> {
    assertScope(input.subject, "admin:read");
    assertKnownProvider(input.test.providerId);
    const orgId = connectionTestOrgId(input.subject, input.test.orgId);
    const entry = catalogById(input.test.providerId);
    if (entry.status !== "implemented") {
      throw new ApiError(
        "auth_provider_not_implemented",
        "Authentication provider adapter is not implemented yet.",
        400,
        { providerId: input.test.providerId },
      );
    }

    const global = await this.readGlobal(this.repository);
    const org = await this.readOrg(this.repository, orgId);
    const globalSetting = globalProviderSetting(global, entry.id);
    const effectiveSetting = mergeEffective(
      globalSetting,
      org.providers[entry.id],
    );
    const effective = summarizeEffectiveProvider(
      entry,
      globalSetting,
      org.providers[entry.id],
      global.providers[entry.id] === undefined,
    );

    if (entry.protocol === "local") {
      return localConnectionTestReport(entry, effective.enabled);
    }
    if (entry.protocol === "oauth2") {
      return this.oauth2ConnectionTestReport({
        effective,
        effectiveSetting,
        entry,
        request: input.test,
      });
    }
    if (entry.protocol === "ldap") {
      return this.ldapConnectionTestReport({
        effective,
        effectiveSetting,
        entry,
        request: input.test,
      });
    }
    if (entry.protocol === "saml") {
      return this.samlConnectionTestReport({
        effective,
        effectiveSetting,
        entry,
        request: input.test,
      });
    }
    if (entry.protocol !== "oidc") {
      throw new ApiError(
        "auth_provider_connection_test_unavailable",
        "Connection testing is not available for this provider protocol yet.",
        400,
        { providerId: input.test.providerId, protocol: entry.protocol },
      );
    }

    const activeConfig = await resolveSsoOidcConfig(
      this.repository,
      this.env,
      orgId,
    );
    const resolved = oidcConnectionTestConfig(
      entry.id,
      activeConfig,
      effectiveSetting.oidc,
      input.test.oidc,
    );
    const test = await testOidcConnection({
      config: resolved.config,
      fetchImpl: this.fetchImpl,
    });
    return {
      ...test,
      providerId: entry.id,
      catalogStatus: entry.status,
      protocol: entry.protocol,
      runtimePackage: entry.runtimePackage,
      configurationSource: resolved.source,
      enabled: effective.enabled,
      detectedProviderPreset: detectSsoOidcProviderPreset(
        resolved.config.issuerUrl,
      ),
      checks: [
        {
          id: "adapter",
          status: "pass",
          code: "auth_provider_adapter_available",
        },
        ...test.checks,
      ],
      notes: [
        "Auth provider connection tests return metadata only; client IDs, issuer paths, secret refs, and JWKS URLs are not returned.",
        ...test.notes,
      ],
    };
  }

  private async samlConnectionTestReport(input: {
    effective: EffectiveAuthProviderSetting;
    effectiveSetting: StoredGlobalProviderSetting;
    entry: AuthProviderCatalogEntry;
    request: AuthProviderConnectionTestRequest;
  }): Promise<AuthProviderConnectionTestReport> {
    const transientConfig = transientSamlConnection(
      input.entry.id,
      input.effectiveSetting.saml,
      input.request.saml,
    );
    const secretRef =
      input.request.saml?.idpCertificateRef === undefined
        ? input.effectiveSetting.secretRef
        : normalizeConnectionTestSecretRef(
            input.request.saml.idpCertificateRef,
          );
    const summary = samlConnectionSummary(transientConfig);
    const checks: AuthProviderConnectionTestReport["checks"] = [
      {
        id: "adapter",
        status: "pass",
        code: "auth_provider_adapter_available",
      },
      samlConfigurationCheck(input.effective.enabled, summary, secretRef),
      await this.samlSecretCheck(input.effective.enabled, secretRef),
      {
        id: "saml_endpoints",
        status:
          input.effective.enabled &&
          summary.entryPointConfigured &&
          summary.spEntityIdConfigured
            ? "pass"
            : "skip",
        code:
          input.effective.enabled &&
          summary.entryPointConfigured &&
          summary.spEntityIdConfigured
            ? "saml_sp_initiated_login_ready"
            : "saml_config_incomplete",
      },
    ];
    return {
      generatedAt: new Date().toISOString(),
      providerId: input.entry.id,
      catalogStatus: input.entry.status,
      protocol: input.entry.protocol,
      runtimePackage: input.entry.runtimePackage,
      configurationSource:
        input.request.saml === undefined
          ? "provider_settings"
          : "transient_request",
      status: connectionStatus(input.effective.enabled, checks),
      enabled: input.effective.enabled,
      checks,
      notes: [
        "SAML tests validate configuration and certificate-ref availability without fetching IdP metadata or returning assertion data.",
        "SAML entry points, entity IDs, certificate refs, attributes, groups, and provider responses are not returned.",
      ],
    };
  }

  private async oauth2ConnectionTestReport(input: {
    effective: EffectiveAuthProviderSetting;
    effectiveSetting: StoredGlobalProviderSetting;
    entry: AuthProviderCatalogEntry;
    request: AuthProviderConnectionTestRequest;
  }): Promise<AuthProviderConnectionTestReport> {
    if (input.entry.id !== "github") {
      throw new ApiError(
        "auth_provider_connection_test_unavailable",
        "Connection testing is not available for this provider protocol yet.",
        400,
        { providerId: input.entry.id, protocol: input.entry.protocol },
      );
    }
    const transientConfig = transientOAuth2Connection(
      input.entry.id,
      input.effectiveSetting.oauth2,
      input.request.oauth2,
    );
    const secretRef =
      input.request.oauth2?.secretRef === undefined
        ? input.effectiveSetting.secretRef
        : normalizeConnectionTestSecretRef(input.request.oauth2.secretRef);
    const summary = oauth2ConnectionSummary(input.entry.id, transientConfig);
    const checks: AuthProviderConnectionTestReport["checks"] = [
      {
        id: "adapter",
        status: "pass",
        code: "auth_provider_adapter_available",
      },
      oauth2ConfigurationCheck(input.effective.enabled, summary, secretRef),
      await this.oauth2SecretCheck(input.effective.enabled, secretRef),
      {
        id: "oauth2_endpoints",
        status: input.effective.enabled ? "pass" : "skip",
        code: input.effective.enabled
          ? "github_oauth2_known_endpoints"
          : "auth_provider_disabled",
      },
      await this.githubApiCheck(input.effective.enabled),
    ];
    return {
      generatedAt: new Date().toISOString(),
      providerId: input.entry.id,
      catalogStatus: input.entry.status,
      protocol: input.entry.protocol,
      runtimePackage: input.entry.runtimePackage,
      configurationSource:
        input.request.oauth2 === undefined
          ? "provider_settings"
          : "transient_request",
      status: connectionStatus(input.effective.enabled, checks),
      enabled: input.effective.enabled,
      checks,
      notes: [
        "GitHub direct login uses OAuth2 authorization code with PKCE and stores only provider account metadata in Romeo.",
        "Auth provider connection tests return metadata only; client IDs, secret refs, tokens, GitHub orgs, and GitHub team names are not returned.",
      ],
    };
  }

  private async ldapConnectionTestReport(input: {
    effective: EffectiveAuthProviderSetting;
    effectiveSetting: StoredGlobalProviderSetting;
    entry: AuthProviderCatalogEntry;
    request: AuthProviderConnectionTestRequest;
  }): Promise<AuthProviderConnectionTestReport> {
    const transientConfig = transientLdapConnection(
      input.entry.id,
      input.effectiveSetting.ldap,
      input.request.ldap,
    );
    const secretRef =
      input.request.ldap?.secretRef === undefined
        ? input.effectiveSetting.secretRef
        : normalizeConnectionTestSecretRef(input.request.ldap.secretRef);
    const summary = ldapConnectionSummary(transientConfig);
    const config = ldapConfigFromProviderConnection(
      input.entry.id,
      transientConfig ?? {},
    );
    const secretCheck = await this.ldapSecretCheck(
      input.effective.enabled,
      secretRef,
    );
    const checks: AuthProviderConnectionTestReport["checks"] = [
      {
        id: "adapter",
        status: "pass",
        code: "auth_provider_adapter_available",
      },
      ldapConfigurationCheck(input.effective.enabled, summary, secretRef),
      secretCheck,
      await this.ldapBindCheck({
        config,
        enabled: input.effective.enabled,
        secretCheck,
        secretRef,
      }),
    ];
    return {
      generatedAt: new Date().toISOString(),
      providerId: input.entry.id,
      catalogStatus: input.entry.status,
      protocol: input.entry.protocol,
      runtimePackage: input.entry.runtimePackage,
      configurationSource:
        input.request.ldap === undefined
          ? "provider_settings"
          : "transient_request",
      status: connectionStatus(input.effective.enabled, checks),
      enabled: input.effective.enabled,
      checks,
      notes: [
        "LDAP and Active Directory connection tests use the service bind account only and return metadata-only check codes.",
        "Bind DNs, base DNs, LDAP URLs, secret refs, directory entries, and credentials are not returned.",
      ],
    };
  }

  private async ldapSecretCheck(
    enabled: boolean,
    secretRef: string | undefined,
  ): Promise<AuthProviderConnectionTestReport["checks"][number]> {
    if (!enabled) {
      return { id: "secret", status: "skip", code: "auth_provider_disabled" };
    }
    if (secretRef === undefined) {
      return {
        id: "secret",
        status: "fail",
        code: "ldap_bind_secret_ref_missing",
      };
    }
    if (this.secretResolver === undefined) {
      return {
        id: "secret",
        status: "skip",
        code: "secret_resolver_not_available",
      };
    }
    const check = await this.secretResolver.check(secretRef);
    return {
      id: "secret",
      status: check.available ? "pass" : "fail",
      code: check.available
        ? "ldap_bind_secret_available"
        : (check.failureCode ?? "ldap_bind_secret_unavailable"),
    };
  }

  private async samlSecretCheck(
    enabled: boolean,
    secretRef: string | undefined,
  ): Promise<AuthProviderConnectionTestReport["checks"][number]> {
    if (!enabled) {
      return { id: "secret", status: "skip", code: "auth_provider_disabled" };
    }
    if (secretRef === undefined) {
      return {
        id: "secret",
        status: "fail",
        code: "saml_idp_certificate_ref_missing",
      };
    }
    if (this.secretResolver === undefined) {
      return {
        id: "secret",
        status: "skip",
        code: "secret_resolver_not_available",
      };
    }
    const check = await this.secretResolver.check(secretRef);
    return {
      id: "secret",
      status: check.available ? "pass" : "fail",
      code: check.available
        ? "saml_idp_certificate_available"
        : (check.failureCode ?? "saml_idp_certificate_unavailable"),
    };
  }

  private async ldapBindCheck(input: {
    config: ResolvedLdapProviderConnection;
    enabled: boolean;
    secretCheck: AuthProviderConnectionTestReport["checks"][number];
    secretRef: string | undefined;
  }): Promise<AuthProviderConnectionTestReport["checks"][number]> {
    if (!input.enabled) {
      return {
        id: "ldap_bind",
        status: "skip",
        code: "auth_provider_disabled",
      };
    }
    if (!ldapConfigComplete(input.config)) {
      return {
        id: "ldap_bind",
        status: "skip",
        code: "ldap_config_incomplete",
      };
    }
    if (input.secretRef === undefined || input.secretCheck.status !== "pass") {
      return {
        id: "ldap_bind",
        status: "skip",
        code: "ldap_bind_secret_unavailable",
      };
    }
    if (this.secretResolver?.resolveValue === undefined) {
      return {
        id: "ldap_bind",
        status: "fail",
        code: "secret_value_resolution_unavailable",
      };
    }
    const resolution = await this.secretResolver.resolveValue(input.secretRef);
    if (!resolution.available || resolution.value === undefined) {
      return {
        id: "ldap_bind",
        status: "fail",
        code: resolution.failureCode ?? "ldap_bind_secret_unavailable",
      };
    }
    const factory = this.ldapClientFactory ?? defaultLdapClientFactory;
    const client = factory(input.config);
    try {
      if (input.config.startTls) await client.startTls();
      await client.bind(input.config.bindDn, resolution.value);
      await client.search(input.config.baseDn, {
        attributes: ["dn"],
        filter: "(objectClass=*)",
        scope: "base",
        sizeLimit: 1,
        timeLimit: 5,
      });
      return {
        id: "ldap_bind",
        status: "pass",
        code: "ldap_bind_and_base_search_passed",
      };
    } catch {
      return {
        id: "ldap_bind",
        status: "fail",
        code: "ldap_bind_or_search_failed",
      };
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  private async oauth2SecretCheck(
    enabled: boolean,
    secretRef: string | undefined,
  ): Promise<AuthProviderConnectionTestReport["checks"][number]> {
    if (!enabled) {
      return { id: "secret", status: "skip", code: "auth_provider_disabled" };
    }
    if (secretRef === undefined) {
      return {
        id: "secret",
        status: "fail",
        code: "oauth2_client_secret_ref_missing",
      };
    }
    if (this.secretResolver === undefined) {
      return {
        id: "secret",
        status: "skip",
        code: "secret_resolver_not_available",
      };
    }
    const check = await this.secretResolver.check(secretRef);
    return {
      id: "secret",
      status: check.available ? "pass" : "fail",
      code: check.available
        ? "oauth2_client_secret_available"
        : (check.failureCode ?? "oauth2_client_secret_unavailable"),
    };
  }

  private async githubApiCheck(
    enabled: boolean,
  ): Promise<AuthProviderConnectionTestReport["checks"][number]> {
    if (!enabled) {
      return { id: "api", status: "skip", code: "auth_provider_disabled" };
    }
    try {
      const response = await this.fetchImpl("https://api.github.com/meta", {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "Romeo",
          "x-github-api-version": "2022-11-28",
        },
      });
      return {
        id: "api",
        status: response.ok ? "pass" : "fail",
        code: response.ok ? "github_api_reachable" : "github_api_unreachable",
      };
    } catch {
      return { id: "api", status: "fail", code: "github_api_unreachable" };
    }
  }

  async update(input: {
    subject: AuthSubject;
    settings: UpdateAuthProviderSettingsRequest;
  }): Promise<AuthProviderSettingsReport> {
    assertScope(input.subject, "admin:write");
    const orgId = input.settings.orgOverride?.orgId ?? input.subject.orgId;
    if (orgId !== input.subject.orgId) assertGlobalAdmin(input.subject);

    return this.repository.transaction(async (repository) => {
      let global = await this.readGlobal(repository);
      let org = await this.readOrg(repository, orgId);
      const beforeGlobal = global;
      const beforeOrg = org;
      const now = new Date().toISOString();
      const changedScopes: string[] = [];

      if (input.settings.global !== undefined) {
        assertGlobalAdmin(input.subject);
        global = applyGlobalPatches(global, input.settings.global.providers);
        assertLocalFallbackPolicy(
          global,
          org,
          input.settings.confirmDisableLocalFallback === true,
        );
        await repository.upsertSystemSetting({
          key: globalSettingsKey,
          value: serializeGlobal(global, now, input.subject.id),
          updatedAt: now,
        });
        changedScopes.push("global");
      }

      if (input.settings.orgOverride !== undefined) {
        org = applyOrgPatches(
          global,
          org,
          input.settings.orgOverride.providers,
        );
        assertLocalFallbackPolicy(
          global,
          org,
          input.settings.confirmDisableLocalFallback === true,
        );
        await repository.upsertSystemSetting({
          key: orgSettingsKey(orgId),
          value: serializeOrg(org, now, input.subject.id),
          updatedAt: now,
        });
        changedScopes.push("org");
      }

      if (changedScopes.length === 0) {
        throw new ApiError(
          "auth_provider_settings_empty_update",
          "Auth provider settings update must include global settings or an org override.",
          400,
        );
      }

      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.auth_provider_settings.update",
        resourceType: "auth_provider_settings",
        resourceId: orgId,
        metadata: sanitizedSettingsAuditMetadata(
          beforeGlobal,
          beforeOrg,
          global,
          org,
          changedScopes,
        ),
      });

      return toReport(orgId, global, org);
    });
  }

  private async readGlobal(
    repository: RomeoRepository,
  ): Promise<StoredAuthProviderGlobalSettings> {
    const setting = await repository.getSystemSetting(globalSettingsKey);
    return parseGlobalSettings(setting?.value);
  }

  private async readOrg(
    repository: RomeoRepository,
    orgId: string,
  ): Promise<StoredAuthProviderOrgOverrides> {
    const setting = await repository.getSystemSetting(orgSettingsKey(orgId));
    return parseOrgSettings(orgId, setting?.value);
  }
}

function applyGlobalPatches(
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

function applyOrgPatches(
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

function toReport(
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

function summarizeEffectiveProvider(
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

function mergeEffective(
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

function localConnectionTestReport(
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

function transientOAuth2Connection(
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
    ...(existing ?? {}),
    clientId,
    scopes:
      existing?.scopes ??
      oauth2ConfigFromProviderConnection(providerId, existing ?? {}).scopes,
  }) as StoredOAuth2ProviderConnection;
}

function transientLdapConnection(
  providerId: AuthProviderId,
  existing: StoredLdapProviderConnection | undefined,
  ldap: AuthProviderConnectionTestRequest["ldap"],
): StoredLdapProviderConnection | undefined {
  if (ldap === undefined) return existing;
  return applyLdapConnectionPatch(catalogById(providerId), existing, ldap);
}

function transientSamlConnection(
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

function ldapConfigComplete(config: ResolvedLdapProviderConnection): boolean {
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

function samlConfigComplete(config: ResolvedSamlProviderConnection): boolean {
  return config.entryPoint.length > 0 && config.spEntityId.length > 0;
}

function samlConfigurationCheck(
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

function ldapConfigurationCheck(
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

function oauth2ConfigurationCheck(
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

function connectionStatus(
  enabled: boolean,
  checks: AuthProviderConnectionTestReport["checks"],
): AuthProviderConnectionTestReport["status"] {
  if (!enabled) return "disabled";
  if (checks.some((check) => check.status === "fail")) return "failed";
  if (checks.some((check) => check.status === "skip")) return "partial";
  return "passed";
}

function oidcConnectionTestConfig(
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

function normalizeConnectionTestSecretRef(value: string): string | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  parseManagedSecretRef(normalized);
  return normalized;
}

function connectionTestOrgId(
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

function assertLocalFallbackPolicy(
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

function sanitizedSettingsAuditMetadata(
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

function parseGlobalSettings(
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

function parseOrgSettings(
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

function serializeGlobal(
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

function serializeOrg(
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

function defaultGlobalSetting(
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

function globalProviderSetting(
  global: StoredAuthProviderGlobalSettings,
  providerId: AuthProviderId,
): StoredGlobalProviderSetting {
  return (
    global.providers[providerId] ??
    defaultGlobalSetting(catalogById(providerId))
  );
}

function catalogById(providerId: AuthProviderId): AuthProviderCatalogEntry {
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

function assertKnownProvider(providerId: AuthProviderId): void {
  void catalogById(providerId);
}

function assertGlobalAdmin(subject: AuthSubject): void {
  if (subject.adminRole === "global_admin") return;
  throw new ApiError(
    "global_admin_required",
    "Global admin role is required for this operation.",
    403,
  );
}

function normalizeOptionalText(
  patch: string | null | undefined,
  existing: string | undefined,
  fallback: string | undefined,
  maxLength: number,
): string | undefined {
  if (patch === undefined) return existing ?? fallback;
  if (patch === null) return fallback;
  const normalized = patch.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ApiError(
      "invalid_auth_provider_settings",
      "Authentication provider text fields must be non-empty and bounded.",
      400,
    );
  }
  return normalized;
}

function normalizeOptionalInteger(
  patch: number | null | undefined,
  existing: number | undefined,
  min: number,
  max: number,
  label: string,
): number | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  if (!Number.isInteger(patch) || patch < min || patch > max) {
    throw new ApiError(
      "invalid_auth_provider_settings",
      `Authentication provider ${label} is out of range.`,
      400,
    );
  }
  return patch;
}

function normalizeDomainPatch(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] {
  if (patch === undefined) return existing ?? [];
  if (patch === null) return [];
  const normalized = [
    ...new Set(
      patch.map((domain) => normalizeEmailDomain(domain)).filter(Boolean),
    ),
  ].sort();
  if (normalized.length > 100) {
    throw new ApiError(
      "invalid_auth_provider_settings",
      "Authentication provider allowed-domain lists are limited to 100 entries.",
      400,
    );
  }
  return normalized;
}

function normalizeOptionalDomainPatch(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  return normalizeDomainPatch(patch, undefined);
}

function normalizeEmailDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const pattern = new RegExp(`^${label}(?:\\.${label})+$`, "u");
  if (!pattern.test(normalized)) {
    throw new ApiError(
      "invalid_auth_provider_allowed_domain",
      "Allowed email domains must be exact DNS domains.",
      400,
    );
  }
  return normalized;
}

function normalizeSecretRefPatch(
  patch: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = patch.trim();
  parseManagedSecretRef(normalized);
  return normalized;
}

function parseSecretRef(secretRef: string | undefined): string | undefined {
  if (secretRef === undefined) return undefined;
  try {
    return parseManagedSecretRef(secretRef).scheme;
  } catch {
    return "invalid";
  }
}

function settingsNotes(providers: EffectiveAuthProviderSetting[]): string[] {
  const notes = [
    "Auth provider settings expose managed secret posture only; raw secret refs are not returned.",
  ];
  if (
    !providers.some(
      (provider) => provider.providerId === "local" && provider.enabled,
    )
  ) {
    notes.push(
      "Local auth fallback is disabled for this effective provider policy.",
    );
  }
  if (providers.some((provider) => provider.catalogStatus === "planned")) {
    notes.push(
      "Planned providers appear in the catalog but cannot be enabled until their adapters are implemented.",
    );
  }
  return notes;
}

function orgSettingsKey(orgId: string): string {
  return `${orgSettingsKeyPrefix}${orgId}`;
}

function isAuthProviderId(value: string): value is AuthProviderId {
  return authProviderIds.includes(value as AuthProviderId);
}

function isAuthProviderEntry(
  entry: [string, StoredOrgProviderOverride | undefined],
): entry is [AuthProviderId, StoredOrgProviderOverride] {
  return isAuthProviderId(entry[0]) && entry[1] !== undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
