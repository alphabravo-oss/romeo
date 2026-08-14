import { createHash } from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";
import { ApiError } from "../errors";
import { requirePublicApiErrorCode } from "../public-api-error-registry";
import type { LdapProviderLoginConfig } from "./auth-provider-settings-service";
import type { LdapDirectoryEntry } from "./ldap-directory-client";

export interface DirectoryGroups {
  dns: string[];
  names: string[];
}

const defaultOrgId = "org_default";

export function normalizeLdapProviderId(
  providerId: AuthProviderId,
): AuthProviderId {
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

export function normalizeLdapOrgId(value: string | undefined): string {
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

export function normalizeLdapIdentifier(value: string): string {
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

export function directorySubject(
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

export function entryDn(entry: LdapDirectoryEntry): string {
  const dn = entry.dn;
  if (typeof dn === "string" && dn.trim().length > 0) return dn.trim();
  throw new ApiError(
    "ldap_login_user_dn_missing",
    "LDAP user entry did not include a DN.",
    409,
  );
}

export function selectLdapEmail(
  config: LdapProviderLoginConfig,
  entry: LdapDirectoryEntry,
  directorySubjectValue: string,
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
    .update(`${config.providerId}\0${directorySubjectValue}`)
    .digest("hex")
    .slice(0, 24)}@ldap.local.invalid`;
}

export function needsGroupSearch(config: LdapProviderLoginConfig): boolean {
  return (
    config.adminGroups.length > 0 ||
    config.requiredGroups.length > 0 ||
    Object.keys(config.groupMap).length > 0 ||
    Object.keys(config.workspaceGroupMap).length > 0 ||
    config.workspaceGroupPrefix.length > 0
  );
}

export function assertRequiredGroups(
  config: LdapProviderLoginConfig,
  groups: DirectoryGroups,
): void {
  if (config.requiredGroups.length === 0) return;
  if (!matchesAnyGroup(config.requiredGroups, groups)) throw ldapLoginDenied();
}

export function matchesAnyGroup(
  policyGroups: string[],
  groups: DirectoryGroups,
): boolean {
  if (policyGroups.length === 0) return false;
  const keys = directoryGroupKeys(groups);
  return policyGroups.some((group) => keys.has(normalizeGroupKey(group)));
}

export function mappedGroupIds(
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

export function renderLdapFilter(
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

export function entryString(
  entry: LdapDirectoryEntry,
  attribute: string,
): string | undefined {
  return entryStrings(entry, attribute)[0];
}

export function entryStrings(
  entry: LdapDirectoryEntry,
  attribute: string,
): string[] {
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

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function emailDomain(value: string): string {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}

export function invalidLdapLogin(code = "ldap_login_invalid"): ApiError {
  return new ApiError(
    requirePublicApiErrorCode(code),
    "LDAP login is invalid.",
    401,
  );
}

export function ldapLoginDenied(): ApiError {
  return new ApiError(
    "ldap_login_denied",
    "LDAP login is not allowed for this account.",
    403,
  );
}

export function ldapProviderUnavailable(): ApiError {
  return new ApiError(
    "ldap_provider_unavailable",
    "LDAP provider is unavailable.",
    502,
  );
}
