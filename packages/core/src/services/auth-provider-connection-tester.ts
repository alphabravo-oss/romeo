import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import { detectSsoOidcProviderPreset } from "../domain/sso-provider-presets";
import type { AuthProviderCatalogEntry } from "../domain/auth-providers";
import type {
  AuthProviderConnectionTestReport,
  AuthProviderConnectionTestRequest,
  EffectiveAuthProviderSetting,
} from "../domain/auth-provider-settings";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import {
  ldapConfigFromProviderConnection,
  ldapConnectionSummary,
  type ResolvedLdapProviderConnection,
} from "./auth-provider-ldap-config";
import { oauth2ConnectionSummary } from "./auth-provider-oauth2-config";
import { samlConnectionSummary } from "./auth-provider-saml-config";
import {
  connectionStatus,
  connectionTestOrgId,
  ldapConfigComplete,
  ldapConfigurationCheck,
  localConnectionTestReport,
  normalizeConnectionTestSecretRef,
  oauth2ConfigurationCheck,
  oidcConnectionTestConfig,
  samlConfigurationCheck,
  transientLdapConnection,
  transientOAuth2Connection,
  transientSamlConnection,
} from "./auth-provider-connection-test-helpers";
import {
  assertKnownProvider,
  catalogById,
  globalProviderSetting,
  mergeEffective,
  summarizeEffectiveProvider,
} from "./auth-provider-settings-resolution";
import {
  readAuthProviderGlobalSettings,
  readAuthProviderOrgSettings,
} from "./auth-provider-settings-storage";
import type { StoredGlobalProviderSetting } from "./auth-provider-settings-storage-types";
import {
  defaultLdapClientFactory,
  type LdapClientFactory,
} from "./ldap-directory-client";
import { testOidcConnection } from "./oidc-connection-test";
import type { SecretResolver } from "./secret-resolver";
import {
  checkGithubApi,
  checkLdapSecret,
  checkOAuth2Secret,
  checkSamlSecret,
} from "./auth-provider-connection-probes";
import { resolveSsoOidcConfig } from "./sso-config";

export class AuthProviderConnectionTester {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly secretResolver?: SecretResolver,
    private readonly ldapClientFactory?: LdapClientFactory,
  ) {}

  async test(input: {
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

    const global = await readAuthProviderGlobalSettings(this.repository);
    const org = await readAuthProviderOrgSettings(this.repository, orgId);
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
      await checkSamlSecret(
        input.effective.enabled,
        secretRef,
        this.secretResolver,
      ),
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
      await checkOAuth2Secret(
        input.effective.enabled,
        secretRef,
        this.secretResolver,
      ),
      {
        id: "oauth2_endpoints",
        status: input.effective.enabled ? "pass" : "skip",
        code: input.effective.enabled
          ? "github_oauth2_known_endpoints"
          : "auth_provider_disabled",
      },
      await checkGithubApi(input.effective.enabled, this.fetchImpl),
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
    const secretCheck = await checkLdapSecret(
      input.effective.enabled,
      secretRef,
      this.secretResolver,
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
}
