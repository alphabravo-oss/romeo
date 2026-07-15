import { type AuthSubject, type Scope } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as oauth from "oauth4webapi";

import type { AuthProviderId } from "../domain/auth-providers";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createUserAuthSubject } from "./auth-subject";
import { writeAuditLog } from "./audit-log";
import type {
  AuthProviderSettingsService,
  OAuth2ProviderLoginConfig,
} from "./auth-provider-settings-service";
import {
  provisionExternalUser,
  syncExternalGroupMemberships,
} from "./external-user-provisioning";
import {
  fetchGitHubOAuth2Identity,
  type GitHubOAuth2IdentityPolicy,
} from "./github-oauth2-auth-provider";
import type { SecretResolver } from "./secret-resolver";
import type { CreatedUserSession, SessionService } from "./session-service";

export interface OAuth2PkceStartResult {
  authorizationUrl: string;
  expiresAt: string;
  providerId: AuthProviderId;
  stateCookie: string;
}

export interface OAuth2PkceCallbackResult extends CreatedUserSession {
  returnTo: string;
}

interface OAuth2PkceState {
  clientId: string;
  codeVerifier: string;
  expiresAt: string;
  orgId: string;
  providerId: AuthProviderId;
  redirectUri: string;
  returnTo: string;
  state: string;
  v: 1;
}

const pkceCookieTtlMs = 10 * 60 * 1000;
const defaultSessionTtlHours = 12;
const githubAuthorizationEndpoint = "https://github.com/login/oauth/authorize";
const githubTokenEndpoint = "https://github.com/login/oauth/access_token";

export class OAuth2PkceService {
  private readonly appOrigin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly env: RomeoEnv,
    private readonly authProviderSettings: AuthProviderSettingsService,
    private readonly secretResolver: SecretResolver,
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.appOrigin = normalizeAppOrigin(env.APP_ORIGIN);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async start(input: {
    orgId?: string;
    providerId: AuthProviderId;
    returnTo?: string;
  }): Promise<OAuth2PkceStartResult> {
    const orgId = normalizeOrgId(input.orgId);
    const config = await this.configuredForLogin(input.providerId, orgId);
    const state = oauth.generateRandomState();
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    const redirectUri = new URL(
      "/api/v1/auth/oauth2/callback",
      this.appOrigin,
    ).toString();
    const expiresAt = new Date(Date.now() + pkceCookieTtlMs).toISOString();
    const stateCookie = this.signState({
      v: 1,
      state,
      codeVerifier,
      clientId: config.clientId,
      orgId,
      providerId: input.providerId,
      redirectUri,
      returnTo: sanitizeReturnTo(input.returnTo),
      expiresAt,
    });

    const authorizationUrl = new URL(authorizationEndpoint(input.providerId));
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", config.scopes.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
      providerId: input.providerId,
      stateCookie,
    };
  }

  async complete(input: {
    code: string;
    state: string;
    stateCookie?: string;
  }): Promise<OAuth2PkceCallbackResult> {
    const stored = this.verifyState(input.stateCookie);
    if (stored.state !== input.state) {
      throw new ApiError(
        "oauth2_state_mismatch",
        "OAuth2 login state did not match.",
        400,
      );
    }
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(
        "oauth2_state_expired",
        "OAuth2 login state has expired.",
        400,
      );
    }

    const config = await this.configuredForLogin(
      stored.providerId,
      stored.orgId,
    );
    if (config.clientId !== stored.clientId) {
      throw new ApiError(
        "oauth2_state_mismatch",
        "OAuth2 login state did not match current provider settings.",
        400,
      );
    }
    const clientSecret = await this.clientSecret(config.secretRef);
    const accessToken = await this.exchangeGitHubCode({
      clientId: config.clientId,
      clientSecret,
      code: input.code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri,
      state: stored.state,
    });
    const identity = await fetchGitHubOAuth2Identity(
      accessToken,
      githubPolicy(config),
      this.fetchImpl,
    );
    const userId = oauth2UserId(stored.providerId, identity.providerAccountId);
    const created = await this.repository.transaction(async (repository) => {
      const user = await provisionExternalUser(repository, {
        email: identity.email,
        name: identity.name,
        orgId: stored.orgId,
        providerLabel: "GitHub OAuth2",
        userId,
      }).catch(() => {
        throw new ApiError(
          "github_oauth_login_denied",
          "GitHub login is not allowed for this account.",
          403,
        );
      });
      await syncExternalGroupMemberships(repository, {
        groupIds: identity.externalGroupIds,
        orgId: stored.orgId,
        userId,
      });
      const subject = await createUserAuthSubject(repository, user, {
        externalGroupIds: identity.externalGroupIds,
        forceAdmin: identity.isAdmin,
        sessionScopes: defaultOAuth2Scopes,
      });
      await this.auditSuccess(
        subject,
        {
          config,
          identity,
          userId,
        },
        repository,
      );
      return this.sessions.createInRepository(repository, {
        subject,
        name: "GitHub browser login",
        ttlHours: defaultSessionTtlHours,
      });
    });
    return { ...created, returnTo: stored.returnTo };
  }

  private async configuredForLogin(
    providerId: AuthProviderId,
    orgId: string,
  ): Promise<OAuth2ProviderLoginConfig> {
    if (providerId !== "github") {
      throw new ApiError(
        "oauth2_login_not_configured",
        "OAuth2 login is not configured for this authentication provider.",
        409,
        { providerId },
      );
    }
    const config = await this.authProviderSettings.oauth2ConfigForProvider({
      orgId,
      providerId,
    });
    if (config === undefined) {
      throw new ApiError(
        "oauth2_login_not_configured",
        "OAuth2 login is not configured for this authentication provider.",
        409,
        { providerId },
      );
    }
    return config;
  }

  private async clientSecret(secretRef: string): Promise<string> {
    if (this.secretResolver.resolveValue === undefined) {
      throw new ApiError(
        "oauth2_client_secret_unavailable",
        "OAuth2 client secret resolution is not available.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "oauth2_client_secret_unavailable",
        "OAuth2 client secret is not available.",
        409,
        { failureCode: resolution.failureCode, scheme: resolution.scheme },
      );
    }
    return resolution.value;
  }

  private async exchangeGitHubCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    state: string;
  }): Promise<string> {
    const as: oauth.AuthorizationServer = {
      issuer: "https://github.com",
      authorization_endpoint: githubAuthorizationEndpoint,
      token_endpoint: githubTokenEndpoint,
    };
    const client: oauth.Client = { client_id: input.clientId };
    try {
      const callbackParameters = oauth.validateAuthResponse(
        as,
        client,
        new URLSearchParams({ code: input.code, state: input.state }),
        input.state,
      );
      const response = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        oauth.ClientSecretPost(input.clientSecret),
        callbackParameters,
        input.redirectUri,
        input.codeVerifier,
        { [oauth.customFetch]: this.fetchImpl },
      );
      const token = await oauth.processAuthorizationCodeResponse(
        as,
        client,
        response,
      );
      return token.access_token;
    } catch {
      throw new ApiError(
        "github_oauth_token_exchange_failed",
        "GitHub OAuth token exchange failed.",
        401,
      );
    }
  }

  private async auditSuccess(
    subject: AuthSubject,
    input: {
      config: OAuth2ProviderLoginConfig;
      identity: {
        externalGroupIds: string[];
        isAdmin: boolean;
        providerAccountId: string;
      };
      userId: string;
    },
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action: "auth.oauth2.login.success",
      resourceType: "user",
      resourceId: input.userId,
      metadata: {
        adminTeamMatched: input.identity.isAdmin,
        allowedDomainPolicyActive: input.config.allowedEmailDomains.length > 0,
        externalGroupCount: input.identity.externalGroupIds.length,
        providerAccountHash: hashProviderAccountId(
          input.config.providerId,
          input.identity.providerAccountId,
        ),
        providerId: input.config.providerId,
        requiredOrganizationCount: input.config.requiredOrganizations.length,
        requiredTeamCount: input.config.requiredTeams.length,
      },
    });
  }

  private signState(state: OAuth2PkceState): string {
    const payload = base64Url(JSON.stringify(state));
    const signature = this.signPayload(payload);
    return `${payload}.${signature}`;
  }

  private verifyState(value: string | undefined): OAuth2PkceState {
    if (value === undefined || value.length === 0) {
      throw new ApiError(
        "oauth2_state_missing",
        "OAuth2 login state cookie is missing.",
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
        "oauth2_state_invalid",
        "OAuth2 login state is invalid.",
        400,
      );
    }
    const decoded = parseJsonState(payload);
    if (!isOAuth2PkceState(decoded)) {
      throw new ApiError(
        "oauth2_state_invalid",
        "OAuth2 login state is invalid.",
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

const defaultOAuth2Scopes: Scope[] = [
  "me:read",
  "organizations:read",
  "workspaces:read",
];

export function oauth2UserId(
  providerId: AuthProviderId,
  providerAccountId: string,
): string {
  return `user_oauth2_${providerId}_${createHash("sha256")
    .update(`${providerId}\0${providerAccountId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function githubPolicy(
  config: OAuth2ProviderLoginConfig,
): GitHubOAuth2IdentityPolicy {
  return {
    adminTeams: config.adminTeams,
    allowedEmailDomains: config.allowedEmailDomains,
    groupMap: config.groupMap,
    requiredOrganizations: config.requiredOrganizations,
    requiredTeams: config.requiredTeams,
    workspaceTeamMap: config.workspaceTeamMap,
    workspaceTeamPrefix: config.workspaceTeamPrefix,
  };
}

function authorizationEndpoint(providerId: AuthProviderId): string {
  if (providerId === "github") return githubAuthorizationEndpoint;
  throw new ApiError(
    "oauth2_login_not_configured",
    "OAuth2 login is not configured for this authentication provider.",
    409,
    { providerId },
  );
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
      "invalid_oauth2_org_id",
      "OAuth2 login organization ID is too long.",
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
      "invalid_oauth2_return_to",
      "OAuth2 return path must be a relative application path.",
      400,
    );
  }
  return value;
}

function hashProviderAccountId(
  providerId: AuthProviderId,
  providerAccountId: string,
): string {
  return createHash("sha256")
    .update(`${providerId}\0${providerAccountId}`)
    .digest("hex");
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
      "oauth2_state_invalid",
      "OAuth2 login state is invalid.",
      400,
    );
  }
}

function isOAuth2PkceState(value: unknown): value is OAuth2PkceState {
  const candidate = value as Partial<OAuth2PkceState>;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.v === 1 &&
    typeof candidate.clientId === "string" &&
    typeof candidate.codeVerifier === "string" &&
    typeof candidate.orgId === "string" &&
    candidate.providerId === "github" &&
    typeof candidate.redirectUri === "string" &&
    typeof candidate.returnTo === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.expiresAt === "string"
  );
}
