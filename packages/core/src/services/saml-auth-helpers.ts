import { createHash, randomBytes } from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";
import { ApiError } from "../errors";
import type { SamlProviderLoginConfig } from "./auth-provider-settings-service";
import type { SamlValidatedProfile } from "./saml-client";
import type {
  SamlIdentity,
  SamlRequestLedger,
  SamlRequestRecord,
  SamlStateCookie,
} from "./saml-auth-types";
import { normalizeAppOrigin, sanitizeAuthReturnTo } from "./auth-navigation";

export { normalizeAppOrigin };

const defaultOrgId = "org_default";

export function samlUserId(
  config: Pick<SamlProviderLoginConfig, "spEntityId">,
  subject: string,
): string {
  return `user_saml_${createHash("sha256")
    .update(`${config.spEntityId}\0${subject}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function mapSamlProfile(
  config: SamlProviderLoginConfig,
  profile: SamlValidatedProfile,
): SamlIdentity {
  const subject = selectProfileString(profile, config.subjectAttribute);
  if (subject === undefined) {
    throw new ApiError(
      "saml_subject_missing",
      "SAML assertion did not include a usable subject.",
      403,
    );
  }
  const groups = selectProfileStrings(profile, config.groupsAttribute);
  assertRequiredGroups(config, groups);
  const email = selectSamlEmail(config, profile, subject);
  return {
    email,
    externalGroupIds: mappedGroupIds(config, groups),
    groups,
    isAdmin: matchesAnyGroup(config.adminGroups, groups),
    name: selectProfileString(profile, config.nameAttribute) ?? email,
    subject,
  };
}

function selectSamlEmail(
  config: SamlProviderLoginConfig,
  profile: SamlValidatedProfile,
  subject: string,
): string {
  const candidate =
    selectProfileString(profile, config.emailAttribute) ??
    selectProfileString(profile, "email") ??
    selectProfileString(profile, "mail") ??
    selectProfileString(profile, "urn:oid:0.9.2342.19200300.100.1.3");
  if (candidate !== undefined && candidate.includes("@")) {
    const normalized = candidate.trim().toLowerCase();
    if (
      config.allowedEmailDomains.length > 0 &&
      !config.allowedEmailDomains.includes(emailDomain(normalized))
    ) {
      throw samlLoginDenied();
    }
    return normalized;
  }
  if (config.allowedEmailDomains.length > 0) throw samlLoginDenied();
  return `saml-${createHash("sha256")
    .update(`${config.spEntityId}\0${subject}`)
    .digest("hex")
    .slice(0, 24)}@saml.local.invalid`;
}

function selectProfileString(
  profile: SamlValidatedProfile,
  attribute: string,
): string | undefined {
  if (attribute === "nameID") return nonEmptyString(profile.nameID);
  const value = profile.attributes[attribute];
  if (Array.isArray(value)) {
    return value.map(stringValue).find((item) => item !== undefined);
  }
  return stringValue(value);
}

function selectProfileStrings(
  profile: SamlValidatedProfile,
  attribute: string,
): string[] {
  const value = profile.attributes[attribute];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(stringValue).filter(isDefined))].sort();
}

function assertRequiredGroups(
  config: SamlProviderLoginConfig,
  groups: string[],
): void {
  if (config.requiredGroups.length === 0) return;
  if (!matchesAnyGroup(config.requiredGroups, groups)) throw samlLoginDenied();
}

function matchesAnyGroup(policyGroups: string[], groups: string[]): boolean {
  if (policyGroups.length === 0) return false;
  const keys = samlGroupKeys(groups);
  return policyGroups.some((group) => keys.has(normalizeGroupKey(group)));
}

function mappedGroupIds(
  config: SamlProviderLoginConfig,
  groups: string[],
): string[] {
  const keys = samlGroupKeys(groups);
  return [...keys]
    .map(
      (key) =>
        config.groupMap[key] ??
        config.groupMap[key.replace(/^saml:group:/u, "")],
    )
    .filter(isDefined)
    .sort();
}

function samlGroupKeys(groups: string[]): Set<string> {
  const keys = new Set<string>();
  for (const group of groups) {
    const normalized = normalizeGroupKey(group);
    keys.add(normalized);
    keys.add(`saml:group:${normalized}`);
  }
  return keys;
}

export function normalizeSamlProviderId(providerId: AuthProviderId): "saml" {
  if (providerId === "saml") return providerId;
  throw new ApiError(
    "invalid_saml_provider",
    "SAML provider ID is not recognized.",
    400,
    { providerId },
  );
}

export function normalizeOrgId(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return defaultOrgId;
  if (normalized.length > 120) {
    throw new ApiError(
      "invalid_saml_org_id",
      "SAML login organization ID is too long.",
      400,
    );
  }
  return normalized;
}

export function sanitizeReturnTo(value: string | undefined): string {
  return sanitizeAuthReturnTo(value, {
    errorCode: "invalid_saml_return_to",
    flowName: "SAML",
  });
}

export function parseLedger(
  value: Record<string, unknown> | undefined,
): SamlRequestLedger {
  if (value === undefined || value.version !== 1) {
    return { version: 1, requests: {} };
  }
  const requests: Record<string, SamlRequestRecord> = {};
  const record = value.requests;
  if (typeof record === "object" && record !== null && !Array.isArray(record)) {
    for (const [key, item] of Object.entries(record)) {
      const parsed = parseRequestRecord(item);
      if (parsed !== undefined) requests[key] = parsed;
    }
  }
  return { version: 1, requests };
}

function parseRequestRecord(value: unknown): SamlRequestRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.providerId !== "saml" ||
    typeof record.expiresAt !== "string" ||
    typeof record.orgId !== "string" ||
    typeof record.relayStateHash !== "string" ||
    typeof record.requestInstant !== "string"
  ) {
    return undefined;
  }
  return {
    expiresAt: record.expiresAt,
    orgId: record.orgId,
    providerId: "saml",
    relayStateHash: record.relayStateHash,
    requestInstant: record.requestInstant,
    ...(typeof record.consumedAt === "string"
      ? { consumedAt: record.consumedAt }
      : {}),
  };
}

export function pruneLedger(ledger: SamlRequestLedger): SamlRequestLedger {
  const now = Date.now();
  const entries = Object.entries(ledger.requests)
    .filter(([, record]) => new Date(record.expiresAt).getTime() > now)
    .sort((left, right) =>
      left[1].expiresAt === right[1].expiresAt
        ? left[0].localeCompare(right[0])
        : left[1].expiresAt.localeCompare(right[1].expiresAt),
    )
    .slice(-1_000);
  return { version: 1, requests: Object.fromEntries(entries) };
}

export function compactLedger(
  ledger: SamlRequestLedger,
): Record<string, unknown> {
  return { version: 1, requests: ledger.requests };
}

export function requestKey(requestId: string): string {
  return stableHash(`saml-request\0${requestId}`);
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

export function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function parseJsonState(payload: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    throw new ApiError(
      "saml_state_invalid",
      "SAML login state is invalid.",
      400,
    );
  }
}

export function isSamlStateCookie(value: unknown): value is SamlStateCookie {
  const candidate = value as Partial<SamlStateCookie>;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.v === 1 &&
    typeof candidate.entryPointHash === "string" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.orgId === "string" &&
    candidate.providerId === "saml" &&
    typeof candidate.relayState === "string" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.requestInstant === "string" &&
    typeof candidate.returnTo === "string" &&
    typeof candidate.spEntityIdHash === "string"
  );
}

export function invalidSamlLogin(code = "saml_login_invalid"): ApiError {
  return new ApiError(code, "SAML login failed.", 401);
}

export function samlLoginDenied(): ApiError {
  return new ApiError(
    "saml_login_denied",
    "SAML login is not allowed for this account.",
    403,
  );
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function normalizeGroupKey(value: string): string {
  return value.trim().toLowerCase();
}

function nonEmptyString(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? nonEmptyString(value) : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
