import { type AuthSubject, type Scope } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type {
  AuthProviderSettingsService,
  SamlProviderLoginConfig,
} from "./auth-provider-settings-service";
import { createUserAuthSubject, localUserScopes } from "./auth-subject";
import { writeAuditLog } from "./audit-log";
import {
  provisionExternalUser,
  syncExternalGroupMemberships,
} from "./external-user-provisioning";
import {
  defaultSamlClientFactory,
  type SamlClientFactory,
  type SamlValidatedProfile,
} from "./saml-client";
import type { SecretResolver } from "./secret-resolver";
import type { CreatedUserSession, SessionService } from "./session-service";
import { ensureSystemAuditActor } from "./system-audit-actor";

export interface SamlStartResult {
  authorizationUrl: string;
  expiresAt: string;
  providerId: "saml";
  stateCookie: string;
}

export interface SamlCallbackResult extends CreatedUserSession {
  returnTo: string;
}

interface SamlStateCookie {
  entryPointHash: string;
  expiresAt: string;
  orgId: string;
  providerId: "saml";
  relayState: string;
  requestId: string;
  requestInstant: string;
  returnTo: string;
  spEntityIdHash: string;
  v: 1;
}

interface SamlRequestLedger {
  requests: Record<string, SamlRequestRecord>;
  version: 1;
}

interface SamlRequestRecord {
  consumedAt?: string;
  expiresAt: string;
  orgId: string;
  providerId: "saml";
  relayStateHash: string;
  requestInstant: string;
}

interface SamlIdentity {
  email: string;
  externalGroupIds: string[];
  groups: string[];
  isAdmin: boolean;
  name: string;
  subject: string;
}

const defaultOrgId = "org_default";
const defaultSessionTtlHours = 12;
const samlRequestLedgerKey = "auth_saml_request_state.v1";
const samlStateTtlMs = 10 * 60 * 1000;
const samlLoginScopes: Scope[] = localUserScopes;

export class SamlAuthService {
  private readonly appOrigin: string;
  private readonly clientFactory: SamlClientFactory;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly authProviderSettings: AuthProviderSettingsService,
    private readonly secretResolver: SecretResolver,
    private readonly env: RomeoEnv,
    options: { clientFactory?: SamlClientFactory } = {},
  ) {
    this.appOrigin = normalizeAppOrigin(env.APP_ORIGIN);
    this.clientFactory = options.clientFactory ?? defaultSamlClientFactory;
  }

  async start(input: {
    orgId?: string;
    providerId?: AuthProviderId;
    returnTo?: string;
  }): Promise<SamlStartResult> {
    const providerId = normalizeSamlProviderId(input.providerId ?? "saml");
    const orgId = normalizeOrgId(input.orgId);
    const config = await this.configuredForLogin(providerId, orgId);
    const idpCert = await this.idpCertificate(config.secretRef);
    const requestId = randomToken(24);
    const relayState = randomToken(24);
    const expiresAt = new Date(Date.now() + samlStateTtlMs).toISOString();
    const requestInstant = new Date().toISOString();
    const client = this.clientFactory({
      acceptedClockSkewMs: config.acceptedClockSkewMs,
      callbackUrl: this.callbackUrl(),
      entryPoint: config.entryPoint,
      idpCert,
      idpIssuer: config.idpIssuer,
      maxAssertionAgeMs: config.maxAssertionAgeMs,
      requestId,
      requestIdExpirationPeriodMs: samlStateTtlMs,
      requestInstant,
      spEntityId: config.spEntityId,
      wantAuthnResponseSigned: config.wantAuthnResponseSigned,
    });
    const authorizationUrl = await client.getAuthorizeUrl(relayState);
    await this.storeRequestState({
      expiresAt,
      orgId,
      providerId,
      relayState,
      requestId,
      requestInstant,
    });
    const stateCookie = this.signState({
      v: 1,
      entryPointHash: stableHash(config.entryPoint),
      expiresAt,
      orgId,
      providerId,
      relayState,
      requestId,
      requestInstant,
      returnTo: sanitizeReturnTo(input.returnTo),
      spEntityIdHash: stableHash(config.spEntityId),
    });
    return { authorizationUrl, expiresAt, providerId, stateCookie };
  }

  async complete(input: {
    relayState?: string;
    samlResponse: string;
    stateCookie?: string;
  }): Promise<SamlCallbackResult> {
    const stored = this.verifyState(input.stateCookie);
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(
        "saml_state_expired",
        "SAML login state has expired.",
        400,
      );
    }
    if (input.relayState !== stored.relayState) {
      await this.auditFailure({
        failureClass: "saml_relay_state_mismatch",
        orgId: stored.orgId,
        providerId: stored.providerId,
        requestId: stored.requestId,
      });
      throw new ApiError(
        "saml_relay_state_mismatch",
        "SAML RelayState did not match.",
        400,
      );
    }
    const config = await this.configuredForLogin(
      stored.providerId,
      stored.orgId,
    );
    if (
      stableHash(config.entryPoint) !== stored.entryPointHash ||
      stableHash(config.spEntityId) !== stored.spEntityIdHash
    ) {
      throw new ApiError(
        "saml_state_mismatch",
        "SAML login state did not match current provider settings.",
        400,
      );
    }
    const requestRecord = await this.consumeRequestState(stored).catch(
      async (error) => {
        const apiError =
          error instanceof ApiError
            ? error
            : invalidSamlLogin("saml_request_state_invalid");
        await this.auditFailure({
          failureClass: apiError.code,
          orgId: stored.orgId,
          providerId: stored.providerId,
          requestId: stored.requestId,
        });
        throw apiError;
      },
    );
    const idpCert = await this.idpCertificate(config.secretRef);
    try {
      const profile = await this.clientFactory({
        acceptedClockSkewMs: config.acceptedClockSkewMs,
        callbackUrl: this.callbackUrl(),
        entryPoint: config.entryPoint,
        idpCert,
        idpIssuer: config.idpIssuer,
        maxAssertionAgeMs: config.maxAssertionAgeMs,
        requestId: stored.requestId,
        requestIdExpirationPeriodMs: samlStateTtlMs,
        requestInstant: requestRecord.requestInstant,
        spEntityId: config.spEntityId,
        wantAuthnResponseSigned: config.wantAuthnResponseSigned,
      }).validatePostResponse({
        relayState: input.relayState,
        samlResponse: input.samlResponse,
      });
      const identity = mapSamlProfile(config, profile);
      const userId = samlUserId(config, identity.subject);
      const created = await this.repository.transaction(async (repository) => {
        const user = await provisionExternalUser(repository, {
          email: identity.email,
          name: identity.name,
          orgId: stored.orgId,
          providerLabel: "SAML",
          userId,
        }).catch(() => {
          throw samlLoginDenied();
        });
        await syncExternalGroupMemberships(repository, {
          groupIds: identity.externalGroupIds,
          orgId: stored.orgId,
          userId,
        });
        const subject = await createUserAuthSubject(repository, user, {
          externalGroupIds: identity.externalGroupIds,
          forceAdmin: identity.isAdmin,
          sessionScopes: samlLoginScopes,
        });
        await this.auditSuccess(
          subject,
          {
            config,
            groupCount: identity.groups.length,
            mappedGroupCount: identity.externalGroupIds.length,
            subject: identity.subject,
            userId,
          },
          repository,
        );
        return this.sessions.createInRepository(repository, {
          subject,
          name: "SAML browser login",
          ttlHours: defaultSessionTtlHours,
        });
      });
      return { ...created, returnTo: stored.returnTo };
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : invalidSamlLogin("saml_login_failed");
      await this.auditFailure({
        failureClass: apiError.code,
        orgId: stored.orgId,
        providerId: stored.providerId,
        requestId: stored.requestId,
      });
      if (apiError.status === 409) throw apiError;
      throw apiError.code === "saml_login_denied"
        ? samlLoginDenied()
        : invalidSamlLogin();
    }
  }

  async metadata(input: {
    orgId?: string;
    providerId?: AuthProviderId;
  }): Promise<string> {
    const providerId = normalizeSamlProviderId(input.providerId ?? "saml");
    const orgId = normalizeOrgId(input.orgId);
    const config = await this.configuredForLogin(providerId, orgId);
    const idpCert = await this.idpCertificate(config.secretRef);
    return this.clientFactory({
      acceptedClockSkewMs: config.acceptedClockSkewMs,
      callbackUrl: this.callbackUrl(),
      entryPoint: config.entryPoint,
      idpCert,
      idpIssuer: config.idpIssuer,
      maxAssertionAgeMs: config.maxAssertionAgeMs,
      requestId: randomToken(24),
      requestIdExpirationPeriodMs: samlStateTtlMs,
      requestInstant: new Date().toISOString(),
      spEntityId: config.spEntityId,
      wantAuthnResponseSigned: config.wantAuthnResponseSigned,
    }).generateServiceProviderMetadata();
  }

  private async configuredForLogin(
    providerId: "saml",
    orgId: string,
  ): Promise<SamlProviderLoginConfig> {
    const config = await this.authProviderSettings.samlConfigForProvider({
      orgId,
      providerId,
    });
    if (config === undefined) {
      throw new ApiError(
        "saml_login_not_configured",
        "SAML login is not configured for this authentication provider.",
        409,
        { providerId },
      );
    }
    return config;
  }

  private async idpCertificate(secretRef: string): Promise<string> {
    if (this.secretResolver.resolveValue === undefined) {
      throw new ApiError(
        "saml_idp_certificate_unavailable",
        "SAML IdP certificate resolution is not available.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "saml_idp_certificate_unavailable",
        "SAML IdP certificate is not available.",
        409,
        { failureCode: resolution.failureCode, scheme: resolution.scheme },
      );
    }
    return resolution.value;
  }

  private callbackUrl(): string {
    return new URL("/api/v1/auth/saml/callback", this.appOrigin).toString();
  }

  private async storeRequestState(input: {
    expiresAt: string;
    orgId: string;
    providerId: "saml";
    relayState: string;
    requestId: string;
    requestInstant: string;
  }): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const ledger = parseLedger(
        (await repository.getSystemSetting(samlRequestLedgerKey))?.value,
      );
      const pruned = pruneLedger(ledger);
      pruned.requests[requestKey(input.requestId)] = {
        expiresAt: input.expiresAt,
        orgId: input.orgId,
        providerId: input.providerId,
        relayStateHash: stableHash(input.relayState),
        requestInstant: input.requestInstant,
      };
      await repository.upsertSystemSetting({
        key: samlRequestLedgerKey,
        value: compactLedger(pruned),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  private async consumeRequestState(
    state: SamlStateCookie,
  ): Promise<SamlRequestRecord> {
    return this.repository.transaction(async (repository) => {
      const ledger = parseLedger(
        (await repository.getSystemSetting(samlRequestLedgerKey))?.value,
      );
      const pruned = pruneLedger(ledger);
      const key = requestKey(state.requestId);
      const record = pruned.requests[key];
      if (
        record === undefined ||
        record.consumedAt !== undefined ||
        record.orgId !== state.orgId ||
        record.providerId !== state.providerId ||
        record.relayStateHash !== stableHash(state.relayState) ||
        new Date(record.expiresAt).getTime() <= Date.now()
      ) {
        throw new ApiError(
          "saml_request_state_invalid",
          "SAML request state is invalid or already consumed.",
          400,
        );
      }
      const consumed = { ...record, consumedAt: new Date().toISOString() };
      pruned.requests[key] = consumed;
      await repository.upsertSystemSetting({
        key: samlRequestLedgerKey,
        value: compactLedger(pruned),
        updatedAt: consumed.consumedAt,
      });
      return record;
    });
  }

  private async auditSuccess(
    subject: AuthSubject,
    input: {
      config: SamlProviderLoginConfig;
      groupCount: number;
      mappedGroupCount: number;
      subject: string;
      userId: string;
    },
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action: "auth.saml.login.success",
      resourceType: "user",
      resourceId: input.userId,
      metadata: {
        adminGroupPolicyActive: input.config.adminGroups.length > 0,
        allowedDomainPolicyActive: input.config.allowedEmailDomains.length > 0,
        groupCount: input.groupCount,
        mappedGroupCount: input.mappedGroupCount,
        providerId: input.config.providerId,
        requiredGroupCount: input.config.requiredGroups.length,
        signedAssertionRequired: true,
        signedResponseRequired: input.config.wantAuthnResponseSigned,
        subjectHash: stableHash(input.subject),
      },
    });
  }

  private async auditFailure(input: {
    failureClass: string;
    orgId: string;
    providerId: "saml";
    requestId?: string;
  }): Promise<void> {
    const actor = await ensureSystemAuditActor(this.repository, {
      kind: "saml_auth",
      name: "SAML Auth Audit Actor",
      orgId: input.orgId,
    });
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: input.orgId,
      actorId: actor.id,
      action: "auth.saml.login.failure",
      resourceType: "auth_provider",
      resourceId: input.providerId,
      outcome: "failure",
      metadata: {
        failureClass: input.failureClass,
        providerId: input.providerId,
        ...(input.requestId === undefined
          ? {}
          : { requestIdHash: stableHash(input.requestId) }),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private signState(state: SamlStateCookie): string {
    const payload = base64Url(JSON.stringify(state));
    const signature = this.signPayload(payload);
    return `${payload}.${signature}`;
  }

  private verifyState(value: string | undefined): SamlStateCookie {
    if (value === undefined || value.length === 0) {
      throw new ApiError(
        "saml_state_missing",
        "SAML login state cookie is missing.",
        400,
      );
    }
    const [payload, signature, extra] = value.split(".");
    if (
      payload === undefined ||
      signature === undefined ||
      extra !== undefined ||
      !this.matchesSignature(payload, signature)
    ) {
      throw new ApiError(
        "saml_state_invalid",
        "SAML login state is invalid.",
        400,
      );
    }
    const decoded = parseJsonState(payload);
    if (!isSamlStateCookie(decoded)) {
      throw new ApiError(
        "saml_state_invalid",
        "SAML login state is invalid.",
        400,
      );
    }
    return decoded;
  }

  private signPayload(payload: string): string {
    return createHmac("sha256", this.env.SESSION_SECRET)
      .update(payload)
      .digest("base64url");
  }

  private matchesSignature(payload: string, signature: string): boolean {
    return (
      this.matchesSignatureWithSecret(
        payload,
        signature,
        this.env.SESSION_SECRET,
      ) ||
      (this.env.SESSION_SECRET_PREVIOUS.length > 0 &&
        this.matchesSignatureWithSecret(
          payload,
          signature,
          this.env.SESSION_SECRET_PREVIOUS,
        ))
    );
  }

  private matchesSignatureWithSecret(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    const expected = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}

export function samlUserId(
  config: Pick<SamlProviderLoginConfig, "spEntityId">,
  subject: string,
): string {
  return `user_saml_${createHash("sha256")
    .update(`${config.spEntityId}\0${subject}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function mapSamlProfile(
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

function normalizeSamlProviderId(providerId: AuthProviderId): "saml" {
  if (providerId === "saml") return providerId;
  throw new ApiError(
    "invalid_saml_provider",
    "SAML provider ID is not recognized.",
    400,
    { providerId },
  );
}

function normalizeOrgId(value: string | undefined): string {
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

function sanitizeReturnTo(value: string | undefined): string {
  if (value === undefined || value.length === 0) return "/";
  if (
    value.length > 500 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\r\n]/u.test(value)
  ) {
    throw new ApiError(
      "invalid_saml_return_to",
      "SAML return path must be a relative application path.",
      400,
    );
  }
  return value;
}

function normalizeAppOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function parseLedger(
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

function pruneLedger(ledger: SamlRequestLedger): SamlRequestLedger {
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

function compactLedger(ledger: SamlRequestLedger): Record<string, unknown> {
  return { version: 1, requests: ledger.requests };
}

function requestKey(requestId: string): string {
  return stableHash(`saml-request\0${requestId}`);
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function parseJsonState(payload: string): unknown {
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

function isSamlStateCookie(value: unknown): value is SamlStateCookie {
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

function invalidSamlLogin(code = "saml_login_invalid"): ApiError {
  return new ApiError(code, "SAML login failed.", 401);
}

function samlLoginDenied(): ApiError {
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
