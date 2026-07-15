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

interface DirectoryGroups {
  dns: string[];
  names: string[];
}

const defaultOrgId = "org_default";
const defaultSessionTtlHours = 12;
const ldapLoginScopes: Scope[] = localUserScopes;
const maxFailedAttempts = 10;
const lockoutMs = 15 * 60 * 1000;

export class LdapAuthService {
  private readonly clientFactory: LdapClientFactory;
  private readonly failedAttempts = new Map<
    string,
    { count: number; lockedUntil?: number }
  >();

  constructor(
    private readonly repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly authProviderSettings: AuthProviderSettingsService,
    private readonly secretResolver: SecretResolver,
    private readonly env: RomeoEnv,
    options: { clientFactory?: LdapClientFactory } = {},
  ) {
    this.clientFactory = options.clientFactory ?? defaultLdapClientFactory;
  }

  async login(input: {
    identifier: string;
    orgId?: string;
    password: string;
    providerId: AuthProviderId;
  }): Promise<LdapLoginResult> {
    const providerId = normalizeLdapProviderId(input.providerId);
    const orgId = normalizeOrgId(input.orgId);
    const identifier = normalizeIdentifier(input.identifier);
    const identifierHash = this.identifierHash(orgId, providerId, identifier);
    const lockoutKey = `${orgId}:${providerId}:${identifierHash}`;
    if (this.isLocked(lockoutKey)) {
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
      this.clearFailedAttempt(lockoutKey);
      return { status: "authenticated", ...created };
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : invalidLdapLogin("ldap_login_failed");
      const recordFailure = apiError.status === 401 || apiError.status === 403;
      const locked = recordFailure
        ? this.recordFailedAttempt(lockoutKey)
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

  private isLocked(key: string): boolean {
    const state = this.failedAttempts.get(key);
    if (state?.lockedUntil === undefined) return false;
    if (state.lockedUntil > Date.now()) return true;
    this.failedAttempts.delete(key);
    return false;
  }

  private recordFailedAttempt(key: string): boolean {
    const current = this.failedAttempts.get(key);
    const nextCount = (current?.count ?? 0) + 1;
    const locked = nextCount >= maxFailedAttempts;
    this.failedAttempts.set(key, {
      count: nextCount,
      ...(locked ? { lockedUntil: Date.now() + lockoutMs } : {}),
    });
    if (this.failedAttempts.size > 5_000) this.pruneFailedAttempts();
    return locked;
  }

  private clearFailedAttempt(key: string): void {
    this.failedAttempts.delete(key);
  }

  private pruneFailedAttempts(): void {
    const now = Date.now();
    for (const [key, value] of this.failedAttempts.entries()) {
      if (value.lockedUntil !== undefined && value.lockedUntil <= now) {
        this.failedAttempts.delete(key);
      }
    }
    while (this.failedAttempts.size > 5_000) {
      const first = this.failedAttempts.keys().next().value;
      if (first === undefined) break;
      this.failedAttempts.delete(first);
    }
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
    await this.repository.createAuditLog({
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

function normalizeLdapProviderId(providerId: AuthProviderId): AuthProviderId {
  if (providerId === "ldap" || providerId === "active-directory") {
    return providerId;
  }
  throw new ApiError(
    "ldap_login_not_configured",
    "LDAP login is not configured for this authentication provider.",
    409,
    { providerId },
  );
}

function normalizeOrgId(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return defaultOrgId;
  if (normalized.length > 120) {
    throw new ApiError(
      "invalid_ldap_org_id",
      "LDAP login organization ID is too long.",
      400,
    );
  }
  return normalized;
}

function normalizeIdentifier(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new ApiError(
      "invalid_ldap_identifier",
      "LDAP login identifier must be bounded text.",
      400,
    );
  }
  return normalized;
}

function directorySubject(
  config: LdapProviderLoginConfig,
  entry: LdapDirectoryEntry,
  identifier: string,
): string {
  return (
    entryString(entry, config.userIdAttribute) ??
    entryString(entry, config.emailAttribute) ??
    entryDn(entry) ??
    identifier
  );
}

function entryDn(entry: LdapDirectoryEntry): string {
  const dn = entry.dn;
  if (typeof dn === "string" && dn.trim().length > 0) return dn.trim();
  throw new ApiError(
    "ldap_login_user_dn_missing",
    "LDAP user entry did not include a DN.",
    409,
  );
}

function selectLdapEmail(
  config: LdapProviderLoginConfig,
  entry: LdapDirectoryEntry,
  directorySubject: string,
): string {
  const candidate = entryString(entry, config.emailAttribute);
  if (candidate !== undefined && candidate.includes("@")) {
    const normalized = candidate.trim().toLowerCase();
    if (
      config.allowedEmailDomains.length > 0 &&
      !config.allowedEmailDomains.includes(emailDomain(normalized))
    ) {
      throw ldapLoginDenied();
    }
    return normalized;
  }
  if (config.allowedEmailDomains.length > 0) throw ldapLoginDenied();
  return `ldap-${createHash("sha256")
    .update(`${config.providerId}\0${directorySubject}`)
    .digest("hex")
    .slice(0, 24)}@ldap.local.invalid`;
}

function needsGroupSearch(config: LdapProviderLoginConfig): boolean {
  return (
    config.adminGroups.length > 0 ||
    config.requiredGroups.length > 0 ||
    Object.keys(config.groupMap).length > 0 ||
    Object.keys(config.workspaceGroupMap).length > 0 ||
    config.workspaceGroupPrefix.length > 0
  );
}

function assertRequiredGroups(
  config: LdapProviderLoginConfig,
  groups: DirectoryGroups,
): void {
  if (config.requiredGroups.length === 0) return;
  if (!matchesAnyGroup(config.requiredGroups, groups)) throw ldapLoginDenied();
}

function matchesAnyGroup(
  policyGroups: string[],
  groups: DirectoryGroups,
): boolean {
  if (policyGroups.length === 0) return false;
  const keys = directoryGroupKeys(groups);
  return policyGroups.some((group) => keys.has(normalizeGroupKey(group)));
}

function mappedGroupIds(
  config: LdapProviderLoginConfig,
  groups: DirectoryGroups,
): string[] {
  const keys = directoryGroupKeys(groups);
  return uniqueStrings(
    [...keys]
      .map((key) => config.groupMap[key])
      .filter((value): value is string => value !== undefined),
  ).sort();
}

function directoryGroupKeys(groups: DirectoryGroups): Set<string> {
  const keys = new Set<string>();
  for (const name of groups.names) {
    const normalized = normalizeGroupKey(name);
    keys.add(normalized);
    keys.add(`ldap:group:${normalized}`);
  }
  for (const dn of groups.dns) {
    const normalized = normalizeGroupKey(dn);
    keys.add(normalized);
    keys.add(`ldap:dn:${normalized}`);
  }
  return keys;
}

function normalizeGroupKey(value: string): string {
  return value.trim().toLowerCase();
}

function renderLdapFilter(
  template: string,
  values: { identifier?: string; userDn?: string; userId?: string },
): string {
  return template
    .replaceAll("{identifier}", escapeLdapFilterValue(values.identifier ?? ""))
    .replaceAll("{userDn}", escapeLdapFilterValue(values.userDn ?? ""))
    .replaceAll("{userId}", escapeLdapFilterValue(values.userId ?? ""));
}

function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\u0000()*\\]/gu, (character) => {
    switch (character) {
      case "\u0000":
        return "\\00";
      case "(":
        return "\\28";
      case ")":
        return "\\29";
      case "*":
        return "\\2a";
      case "\\":
        return "\\5c";
      default:
        return character;
    }
  });
}

function entryString(
  entry: LdapDirectoryEntry,
  attribute: string,
): string | undefined {
  return entryStrings(entry, attribute)[0];
}

function entryStrings(entry: LdapDirectoryEntry, attribute: string): string[] {
  const actualKey = Object.keys(entry).find(
    (key) => key.toLowerCase() === attribute.toLowerCase(),
  );
  if (actualKey === undefined) return [];
  return valueStrings(entry[actualKey]);
}

function valueStrings(value: unknown): string[] {
  if (typeof value === "string") return [value].filter(Boolean);
  if (Buffer.isBuffer(value)) return [value.toString("utf8")].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.flatMap(valueStrings).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function emailDomain(value: string): string {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}

function invalidLdapLogin(code = "ldap_login_invalid"): ApiError {
  return new ApiError(code, "LDAP login is invalid.", 401);
}

function ldapLoginDenied(): ApiError {
  return new ApiError(
    "ldap_login_denied",
    "LDAP login is not allowed for this account.",
    403,
  );
}

function ldapProviderUnavailable(): ApiError {
  return new ApiError(
    "ldap_provider_unavailable",
    "LDAP provider is unavailable.",
    502,
  );
}
