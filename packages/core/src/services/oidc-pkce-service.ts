import type { RomeoEnv } from "@romeo/config";
import { authorizationCodeGrant } from "openid-client";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { authProviderIds, type AuthProviderId } from "../domain/auth-providers";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import type { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { OidcClient, type ResolvedOidcClientConfig } from "./oidc-client";
import { normalizeIssuer } from "./sso-config";
import type { CreatedUserSession, SessionService } from "./session-service";

export interface OidcPkceStartResult {
  authorizationUrl: string;
  expiresAt: string;
  orgId: string;
  providerId?: AuthProviderId;
  stateCookie: string;
}

export interface OidcPkceCallbackResult extends CreatedUserSession {
  returnTo: string;
}

interface OidcPkceState {
  codeVerifier: string;
  expiresAt: string;
  issuer: string;
  orgId: string;
  nonce: string;
  providerId?: AuthProviderId;
  redirectUri: string;
  returnTo: string;
  state: string;
  v: 1;
}

const pkceCookieTtlMs = 10 * 60 * 1000;
const defaultSessionTtlHours = 12;

export class OidcPkceService {
  private readonly appOrigin: string;
  private readonly oidcClient: OidcClient;

  constructor(
    repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly env: RomeoEnv,
    private readonly authProviderSettings: AuthProviderSettingsService,
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.appOrigin = normalizeAppOrigin(env.APP_ORIGIN);
    this.oidcClient = new OidcClient(repository, env, options);
  }

  async start(
    input: {
      orgId?: string;
      providerId?: AuthProviderId;
      returnTo?: string;
    } = {},
  ): Promise<OidcPkceStartResult> {
    const orgId = normalizeOrgId(input.orgId);
    const { config, discovery } = await this.configuredForLogin(
      input.providerId,
      orgId,
    );
    if (
      discovery.authorizationEndpoint === undefined ||
      discovery.tokenEndpoint === undefined
    ) {
      throw new ApiError(
        "oidc_pkce_not_supported",
        "OIDC discovery metadata must include authorization and token endpoints for PKCE login.",
        409,
      );
    }

    const state = randomToken(32);
    const codeVerifier = randomToken(32);
    const nonce = randomToken(24);
    const redirectUri = new URL(
      "/api/v1/auth/oidc/callback",
      this.appOrigin,
    ).toString();
    const expiresAt = new Date(Date.now() + pkceCookieTtlMs).toISOString();
    const stateCookie = this.signState({
      v: 1,
      state,
      codeVerifier,
      nonce,
      issuer: normalizeIssuer(config.issuerUrl),
      orgId,
      ...(input.providerId === undefined
        ? {}
        : { providerId: input.providerId }),
      redirectUri,
      returnTo: sanitizeReturnTo(input.returnTo),
      expiresAt,
    });

    const authorizationUrl = new URL(discovery.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", "openid profile email");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set(
      "code_challenge",
      codeChallenge(codeVerifier),
    );
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
      orgId,
      ...(input.providerId === undefined
        ? {}
        : { providerId: input.providerId }),
      stateCookie,
    };
  }

  async complete(input: {
    code: string;
    state: string;
    stateCookie?: string;
  }): Promise<OidcPkceCallbackResult> {
    const stored = this.verifyState(input.stateCookie);
    if (stored.state !== input.state)
      throw new ApiError(
        "oidc_state_mismatch",
        "OIDC login state did not match.",
        400,
      );
    if (new Date(stored.expiresAt).getTime() <= Date.now())
      throw new ApiError(
        "oidc_state_expired",
        "OIDC login state has expired.",
        400,
      );

    const { config, discovery, openidClientConfiguration, orgId } =
      await this.configuredForLogin(stored.providerId, stored.orgId);
    if (normalizeIssuer(config.issuerUrl) !== stored.issuer)
      throw new ApiError(
        "oidc_state_mismatch",
        "OIDC login state did not match current SSO settings.",
        400,
      );
    if (discovery.tokenEndpoint === undefined) {
      throw new ApiError(
        "oidc_pkce_not_supported",
        "OIDC discovery metadata must include a token endpoint for PKCE login.",
        409,
      );
    }

    const idToken = await this.exchangeCode({
      code: input.code,
      codeVerifier: stored.codeVerifier,
      expectedNonce: stored.nonce,
      expectedState: input.state,
      openidClientConfiguration,
      redirectUri: stored.redirectUri,
    });
    const subject = await this.oidcClient
      .authenticateJwtWithConfig(idToken, {
        config,
        expectedNonce: stored.nonce,
        orgId,
      })
      .catch(() => {
        throw new ApiError(
          "oidc_login_token_invalid",
          "OIDC login token is invalid.",
          403,
        );
      });
    const created = await this.sessions.create({
      subject,
      name: "OIDC browser login",
      ttlHours: defaultSessionTtlHours,
    });
    return { ...created, returnTo: stored.returnTo };
  }

  private async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
    expectedState: string;
    openidClientConfiguration: ResolvedOidcClientConfig["openidClientConfiguration"];
    redirectUri: string;
  }): Promise<string> {
    const callbackUrl = new URL(input.redirectUri);
    callbackUrl.searchParams.set("code", input.code);
    callbackUrl.searchParams.set("state", input.expectedState);
    const tokens = await authorizationCodeGrant(
      input.openidClientConfiguration,
      callbackUrl,
      {
        expectedNonce: input.expectedNonce,
        expectedState: input.expectedState,
        idTokenExpected: true,
        pkceCodeVerifier: input.codeVerifier,
      },
    ).catch(() => {
      throw new ApiError(
        "oidc_token_exchange_failed",
        "OIDC token exchange failed.",
        401,
      );
    });
    if (typeof tokens.id_token !== "string")
      throw new ApiError(
        "oidc_token_exchange_failed",
        "OIDC token exchange did not return an ID token.",
        401,
      );
    return tokens.id_token;
  }

  private async configuredForLogin(
    providerId: AuthProviderId | undefined,
    orgId: string,
  ): Promise<ResolvedOidcClientConfig> {
    try {
      if (providerId === undefined) {
        return await this.oidcClient.configured(orgId);
      }
      const config = await this.authProviderSettings.oidcConfigForProvider({
        orgId,
        providerId,
      });
      if (config === undefined) {
        throw new ApiError(
          "oidc_login_not_configured",
          "OIDC login is not configured for this authentication provider.",
          409,
          { providerId },
        );
      }
      return await this.oidcClient.configuredWithConfig(orgId, config);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const details = providerId === undefined ? {} : { providerId };
      throw new ApiError(
        "oidc_login_not_configured",
        providerId === undefined
          ? "OIDC login is not configured."
          : "OIDC login is not configured for this authentication provider.",
        409,
        details,
      );
    }
  }

  private signState(state: OidcPkceState): string {
    const payload = base64Url(JSON.stringify(state));
    const signature = this.signPayload(payload);
    return `${payload}.${signature}`;
  }

  private verifyState(value: string | undefined): OidcPkceState {
    if (value === undefined || value.length === 0)
      throw new ApiError(
        "oidc_state_missing",
        "OIDC login state cookie is missing.",
        400,
      );
    const [payload, signature, extra] = value.split(".");
    if (
      payload === undefined ||
      signature === undefined ||
      extra !== undefined ||
      !this.matchesSignature(payload, signature)
    ) {
      throw new ApiError(
        "oidc_state_invalid",
        "OIDC login state is invalid.",
        400,
      );
    }
    const decoded = parseJsonState(payload);
    if (!isOidcPkceState(decoded))
      throw new ApiError(
        "oidc_state_invalid",
        "OIDC login state is invalid.",
        400,
      );
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

function normalizeAppOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function normalizeOrgId(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return "org_default";
  if (normalized.length > 120) {
    throw new ApiError(
      "invalid_oidc_org_id",
      "OIDC login organization ID is too long.",
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
      "invalid_oidc_return_to",
      "OIDC return path must be a relative application path.",
      400,
    );
  }
  return value;
}

function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function codeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
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
      "oidc_state_invalid",
      "OIDC login state is invalid.",
      400,
    );
  }
}

function isOidcPkceState(value: unknown): value is OidcPkceState {
  const candidate = value as Partial<OidcPkceState>;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.v === 1 &&
    typeof candidate.state === "string" &&
    typeof candidate.codeVerifier === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.issuer === "string" &&
    typeof candidate.orgId === "string" &&
    (candidate.providerId === undefined ||
      authProviderIds.includes(candidate.providerId)) &&
    typeof candidate.redirectUri === "string" &&
    typeof candidate.returnTo === "string" &&
    typeof candidate.expiresAt === "string"
  );
}
