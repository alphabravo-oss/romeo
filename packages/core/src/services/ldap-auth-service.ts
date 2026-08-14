import { type AuthSubject, type Scope } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { createHash, createHmac } from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type { LdapProviderLoginConfig } from "./auth-provider-settings-service";
import type { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { createUserAuthSubject, localUserScopes } from "./auth-subject";
import {
  defaultLdapClientFactory,
  type LdapClientFactory,
  type LdapDirectoryClient,
  type LdapDirectoryEntry,
} from "./ldap-directory-client";
import {
  provisionExternalUser,
  syncExternalGroupMemberships,
} from "./external-user-provisioning";
import type { SecretResolver } from "./secret-resolver";
import type { CreatedUserSession, SessionService } from "./session-service";
import { writeAuditLog } from "./audit-log";
import { ensureSystemAuditActor } from "./system-audit-actor";
import {
  createLdapLoginAttemptStore,
  type LdapLoginAttemptStore,
} from "./ldap-login-attempt-store";

export interface LdapLoginResult extends CreatedUserSession {
  status: "authenticated";
}

interface LdapIdentity {
  directorySubject: string;
  email: string;
  externalGroupIds: string[];
  groupCount: number;
  isAdmin: boolean;
  name: string;
}

const defaultSessionTtlHours = 12;
const ldapLoginScopes: Scope[] = localUserScopes;
const maxFailedAttempts = 10;
const lockoutMs = 15 * 60 * 1000;

import {
  assertRequiredGroups,
  directorySubject,
  entryDn,
  entryString,
  entryStrings,
  invalidLdapLogin,
  ldapLoginDenied,
  ldapProviderUnavailable,
  mappedGroupIds,
  matchesAnyGroup,
  needsGroupSearch,
  normalizeLdapIdentifier,
  normalizeLdapOrgId,
  normalizeLdapProviderId,
  renderLdapFilter,
  selectLdapEmail,
  uniqueStrings,
  type DirectoryGroups,
} from "./ldap-auth-helpers";

export class LdapAuthService {
  private readonly clientFactory: LdapClientFactory;
  private readonly attemptStore: LdapLoginAttemptStore;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly authProviderSettings: AuthProviderSettingsService,
    private readonly secretResolver: SecretResolver,
    private readonly env: RomeoEnv,
    options: {
      attemptStore?: LdapLoginAttemptStore;
      clientFactory?: LdapClientFactory;
    } = {},
  ) {
    this.clientFactory = options.clientFactory ?? defaultLdapClientFactory;
    this.attemptStore =
      options.attemptStore ??
      createLdapLoginAttemptStore(env, { lockoutMs, maxFailedAttempts });
  }

  async login(input: {
    identifier: string;
    orgId?: string;
    password: string;
    providerId: AuthProviderId;
  }): Promise<LdapLoginResult> {
    const providerId = normalizeLdapProviderId(input.providerId);
    const orgId = normalizeLdapOrgId(input.orgId);
    const identifier = normalizeLdapIdentifier(input.identifier);
    const identifierHash = this.identifierHash(orgId, providerId, identifier);
    const lockoutKey = `${orgId}:${providerId}:${identifierHash}`;
    if (await this.attemptStore.isLocked(lockoutKey)) {
      await this.auditFailure({
        failureClass: "credential_locked",
        identifierHash,
        orgId,
        providerId,
      });
      throw invalidLdapLogin();
    }

    const config = await this.configuredForLogin(providerId, orgId);
    const bindPassword = await this.bindSecret(config.secretRef);
    try {
      const identity = await this.lookupAndVerifyIdentity({
        bindPassword,
        config,
        identifier,
        password: input.password,
      });
      await this.attemptStore.clear(lockoutKey);
      const userId = ldapUserId(config, identity.directorySubject);
      const created = await this.repository.transaction(async (repository) => {
        const user = await provisionExternalUser(repository, {
          email: identity.email,
          name: identity.name,
          orgId,
          providerLabel: "LDAP",
          userId,
        }).catch(() => {
          throw ldapLoginDenied();
        });
        await syncExternalGroupMemberships(repository, {
          groupIds: identity.externalGroupIds,
          orgId,
          userId,
        });
        const subject = await createUserAuthSubject(repository, user, {
          externalGroupIds: identity.externalGroupIds,
          forceAdmin: identity.isAdmin,
          sessionScopes: ldapLoginScopes,
        });
        await this.auditSuccess(
          subject,
          {
            config,
            groupCount: identity.groupCount,
            mappedGroupCount: identity.externalGroupIds.length,
            userId,
          },
          repository,
        );
        return this.sessions.createInRepository(repository, {
          subject,
          name: `${config.providerId === "active-directory" ? "Active Directory" : "LDAP"} login`,
          ttlHours: defaultSessionTtlHours,
        });
      });
      return { status: "authenticated", ...created };
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : invalidLdapLogin("ldap_login_failed");
      const recordFailure = apiError.status === 401 || apiError.status === 403;
      const locked = recordFailure
        ? await this.attemptStore.recordFailure(lockoutKey)
        : false;
      await this.auditFailure({
        failureClass: apiError.code,
        identifierHash,
        locked,
        orgId,
        providerId,
      });
      if (apiError.status === 409 || apiError.status === 502) throw apiError;
      throw apiError.code === "ldap_login_denied"
        ? ldapLoginDenied()
        : invalidLdapLogin();
    }
  }

  private async configuredForLogin(
    providerId: AuthProviderId,
    orgId: string,
  ): Promise<LdapProviderLoginConfig> {
    const config = await this.authProviderSettings.ldapConfigForProvider({
      orgId,
      providerId,
    });
    if (config === undefined) {
      throw new ApiError(
        "ldap_login_not_configured",
        "LDAP login is not configured for this authentication provider.",
        409,
        { providerId },
      );
    }
    return config;
  }

  private async bindSecret(secretRef: string): Promise<string> {
    if (this.secretResolver.resolveValue === undefined) {
      throw new ApiError(
        "ldap_bind_secret_unavailable",
        "LDAP bind secret resolution is not available.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "ldap_bind_secret_unavailable",
        "LDAP bind secret is not available.",
        409,
        { failureCode: resolution.failureCode, scheme: resolution.scheme },
      );
    }
    return resolution.value;
  }

  private async lookupAndVerifyIdentity(input: {
    bindPassword: string;
    config: LdapProviderLoginConfig;
    identifier: string;
    password: string;
  }): Promise<LdapIdentity> {
    const client = this.clientFactory(input.config);
    try {
      await connectAndBindService(client, input.config, input.bindPassword);
      const userEntry = await this.findUser(
        client,
        input.config,
        input.identifier,
      );
      const userDn = entryDn(userEntry);
      await this.verifyUserBind(input.config, userDn, input.password);
      const groups = await this.findGroups(client, input.config, {
        identifier: input.identifier,
        userDn,
        userId: directorySubject(input.config, userEntry, input.identifier),
      });
      assertRequiredGroups(input.config, groups);
      const directorySubjectValue = directorySubject(
        input.config,
        userEntry,
        input.identifier,
      );
      const email = selectLdapEmail(
        input.config,
        userEntry,
        directorySubjectValue,
      );
      return {
        directorySubject: directorySubjectValue,
        email,
        externalGroupIds: mappedGroupIds(input.config, groups),
        groupCount: groups.names.length + groups.dns.length,
        isAdmin: matchesAnyGroup(input.config.adminGroups, groups),
        name: entryString(userEntry, input.config.nameAttribute) ?? email,
      };
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  private async findUser(
    client: LdapDirectoryClient,
    config: LdapProviderLoginConfig,
    identifier: string,
  ): Promise<LdapDirectoryEntry> {
    try {
      const entries = await client.search(config.baseDn, {
        attributes: uniqueStrings([
          config.emailAttribute,
          config.nameAttribute,
          config.userIdAttribute,
        ]),
        filter: renderLdapFilter(config.userSearchFilter, {
          identifier,
        }),
        scope: "sub",
        sizeLimit: 2,
        timeLimit: 10,
      });
      if (entries.length === 1) return entries[0]!;
      if (entries.length > 1) {
        throw new ApiError(
          "ldap_login_ambiguous_user",
          "LDAP login matched multiple directory users.",
          409,
        );
      }
      throw invalidLdapLogin();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ldapProviderUnavailable();
    }
  }

  private async verifyUserBind(
    config: LdapProviderLoginConfig,
    userDn: string,
    password: string,
  ): Promise<void> {
    const client = this.clientFactory(config);
    try {
      if (config.startTls) await client.startTls();
      await client.bind(userDn, password);
    } catch {
      throw invalidLdapLogin();
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  private async findGroups(
    client: LdapDirectoryClient,
    config: LdapProviderLoginConfig,
    values: { identifier: string; userDn: string; userId: string },
  ): Promise<DirectoryGroups> {
    if (!needsGroupSearch(config)) return { dns: [], names: [] };
    try {
      const entries = await client.search(config.groupSearchBaseDn, {
        attributes: uniqueStrings([config.groupNameAttribute]),
        filter: renderLdapFilter(config.groupSearchFilter, values),
        scope: "sub",
        sizeLimit: 200,
        timeLimit: 10,
      });
      return {
        dns: uniqueStrings(entries.map(entryDn).filter(Boolean)).sort(),
        names: uniqueStrings(
          entries.flatMap((entry) =>
            entryStrings(entry, config.groupNameAttribute),
          ),
        )
          .map((value) => value.trim())
          .filter(Boolean)
          .sort(),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ldapProviderUnavailable();
    }
  }

  private identifierHash(
    orgId: string,
    providerId: AuthProviderId,
    identifier: string,
  ): string {
    return createHmac("sha256", this.env.SESSION_SECRET)
      .update(`${orgId}\0${providerId}\0${identifier.toLowerCase()}`)
      .digest("hex");
  }

  private async auditSuccess(
    subject: AuthSubject,
    input: {
      config: LdapProviderLoginConfig;
      groupCount: number;
      mappedGroupCount: number;
      userId: string;
    },
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action: "auth.ldap.login.success",
      resourceType: "user",
      resourceId: input.userId,
      metadata: {
        adminGroupPolicyActive: input.config.adminGroups.length > 0,
        allowedDomainPolicyActive: input.config.allowedEmailDomains.length > 0,
        groupCount: input.groupCount,
        mappedGroupCount: input.mappedGroupCount,
        providerId: input.config.providerId,
        requiredGroupCount: input.config.requiredGroups.length,
      },
    });
  }

  private async auditFailure(input: {
    failureClass: string;
    identifierHash: string;
    locked?: boolean;
    orgId: string;
    providerId: AuthProviderId;
  }): Promise<void> {
    const actor = await ensureSystemAuditActor(this.repository, {
      kind: "ldap_auth",
      name: "LDAP Auth Audit Actor",
      orgId: input.orgId,
    });
    await writeAuditLog(this.repository, {
      id: createId("audit"),
      orgId: input.orgId,
      actorId: actor.id,
      action: "auth.ldap.login.failure",
      resourceType: "auth_provider",
      resourceId: input.providerId,
      outcome: "failure",
      metadata: {
        failureClass: input.failureClass,
        identifierHash: input.identifierHash,
        locked: input.locked === true,
        providerId: input.providerId,
      },
      createdAt: new Date().toISOString(),
    });
  }
}

export function ldapUserId(
  config: Pick<LdapProviderLoginConfig, "baseDn" | "providerId" | "url">,
  directorySubject: string,
): string {
  return `user_ldap_${config.providerId}_${createHash("sha256")
    .update(
      `${config.providerId}\0${config.url}\0${config.baseDn}\0${directorySubject}`,
    )
    .digest("hex")
    .slice(0, 24)}`;
}

async function connectAndBindService(
  client: LdapDirectoryClient,
  config: LdapProviderLoginConfig,
  bindPassword: string,
): Promise<void> {
  try {
    if (config.startTls) await client.startTls();
    await client.bind(config.bindDn, bindPassword);
  } catch {
    throw ldapProviderUnavailable();
  }
}
