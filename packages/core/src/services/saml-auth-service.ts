import { type AuthSubject, type Scope } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import type {
  AuthProviderSettingsService,
  SamlProviderLoginConfig,
} from "./auth-provider-settings-service";
import { createUserAuthSubject, localUserScopes } from "./auth-subject";
import {
  provisionExternalUser,
  syncExternalGroupMemberships,
} from "./external-user-provisioning";
import {
  defaultSamlClientFactory,
  type SamlClientFactory,
} from "./saml-client";
import type { SecretResolver } from "./secret-resolver";
import type { SessionService } from "./session-service";
import { auditSamlFailure, auditSamlSuccess } from "./saml-auth-audit";
import {
  base64Url,
  compactLedger,
  invalidSamlLogin,
  isSamlStateCookie,
  mapSamlProfile,
  normalizeAppOrigin,
  normalizeOrgId,
  normalizeSamlProviderId,
  parseJsonState,
  parseLedger,
  pruneLedger,
  randomToken,
  requestKey,
  samlLoginDenied,
  samlUserId,
  sanitizeReturnTo,
  stableHash,
} from "./saml-auth-helpers";
import type {
  SamlCallbackResult,
  SamlRequestRecord,
  SamlStartResult,
  SamlStateCookie,
} from "./saml-auth-types";

export * from "./saml-auth-types";
export { samlUserId };

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
      await auditSamlFailure(this.repository, {
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
        await auditSamlFailure(this.repository, {
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
        await auditSamlSuccess(repository, subject, {
          config,
          groupCount: identity.groups.length,
          mappedGroupCount: identity.externalGroupIds.length,
          subject: identity.subject,
          userId,
        });
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
      await auditSamlFailure(this.repository, {
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
