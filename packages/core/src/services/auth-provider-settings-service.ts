import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import { type AuthProviderId } from "../domain/auth-providers";
import type {
  AuthProviderConnectionTestReport,
  AuthProviderConnectionTestRequest,
  AuthProviderSettingsReport,
  UpdateAuthProviderSettingsRequest,
} from "../domain/auth-provider-settings";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import { AuthProviderConnectionTester } from "./auth-provider-connection-tester";
import {
  ldapConfigComplete,
  samlConfigComplete,
} from "./auth-provider-connection-test-helpers";

import {
  applyGlobalPatches,
  applyOrgPatches,
  catalogById,
  globalProviderSetting,
  mergeEffective,
  toReport,
} from "./auth-provider-settings-resolution";
import {
  assertGlobalAdmin,
  assertLocalFallbackPolicy,
  globalSettingsKey,
  orgSettingsKey,
  readAuthProviderGlobalSettings,
  readAuthProviderOrgSettings,
  sanitizedSettingsAuditMetadata,
  serializeGlobal,
  serializeOrg,
} from "./auth-provider-settings-storage";
import {
  hasOidcConnection,
  oidcConfigFromProviderConnection,
} from "./auth-provider-oidc-config";
import {
  hasLdapConnection,
  ldapConfigFromProviderConnection,
  type ResolvedLdapProviderConnection,
} from "./auth-provider-ldap-config";
import {
  hasOAuth2Connection,
  oauth2ConfigFromProviderConnection,
  type ResolvedOAuth2ProviderConnection,
} from "./auth-provider-oauth2-config";
import {
  hasSamlConnection,
  samlConfigFromProviderConnection,
  type ResolvedSamlProviderConnection,
} from "./auth-provider-saml-config";
import type { SecretResolver } from "./secret-resolver";
import type { LdapClientFactory } from "./ldap-directory-client";
import { type ResolvedSsoOidcConfig } from "./sso-config";

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
    const global = await readAuthProviderGlobalSettings(this.repository);
    const org = await readAuthProviderOrgSettings(
      this.repository,
      subject.orgId,
    );
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
    const global = await readAuthProviderGlobalSettings(this.repository);
    const org = await readAuthProviderOrgSettings(this.repository, input.orgId);
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
    const global = await readAuthProviderGlobalSettings(this.repository);
    const org = await readAuthProviderOrgSettings(this.repository, input.orgId);
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
    const global = await readAuthProviderGlobalSettings(this.repository);
    const org = await readAuthProviderOrgSettings(this.repository, input.orgId);
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
    const global = await readAuthProviderGlobalSettings(this.repository);
    const org = await readAuthProviderOrgSettings(this.repository, input.orgId);
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
    return new AuthProviderConnectionTester(
      this.repository,
      this.env,
      this.fetchImpl,
      this.secretResolver,
      this.ldapClientFactory,
    ).test(input);
  }

  async update(input: {
    subject: AuthSubject;
    settings: UpdateAuthProviderSettingsRequest;
  }): Promise<AuthProviderSettingsReport> {
    assertScope(input.subject, "admin:write");
    const orgId = input.settings.orgOverride?.orgId ?? input.subject.orgId;
    if (orgId !== input.subject.orgId) assertGlobalAdmin(input.subject);

    return this.repository.transaction(async (repository) => {
      let global = await readAuthProviderGlobalSettings(repository);
      let org = await readAuthProviderOrgSettings(repository, orgId);
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
}
