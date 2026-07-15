import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { DataConnectorType } from "../domain/data-connectors";
import type {
  DelegatedOAuthCallbackResult,
  DelegatedOAuthConnection,
  DelegatedOAuthConnectionPostureCounts,
  DelegatedOAuthConnectionSummary,
  DelegatedOAuthConnectorTypePosture,
  DelegatedOAuthPostureReport,
  DelegatedOAuthProvider,
  DelegatedOAuthProviderId,
  DelegatedOAuthProviderPosture,
  DelegatedOAuthStartResult,
} from "../domain/delegated-oauth";
import type { BackgroundJob, DataConnector } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  exchangeGitHubDelegatedOAuth,
  refreshGitHubDelegatedOAuth,
  revokeGitHubDelegatedOAuth,
  type DelegatedOAuthProviderRefreshedToken,
  type DelegatedOAuthProviderToken,
} from "./delegated-oauth-github-provider";
import {
  DelegatedOAuthTokenVault,
  type DelegatedOAuthStoredToken,
} from "./delegated-oauth-token-vault";

interface DelegatedOAuthProviderDefinition {
  authorizationUrl: string;
  connectorTypes: DataConnectorType[];
  displayName: string;
  id: DelegatedOAuthProviderId;
  tokenUrl: string;
}

interface DelegatedOAuthState {
  codeVerifier: string;
  connectorType: DataConnectorType;
  expiresAt: string;
  nonce: string;
  orgId: string;
  providerId: DelegatedOAuthProviderId;
  redirectUri: string;
  returnTo: string;
  scopes: string[];
  state: string;
  userId: string;
  v: 1;
  workspaceId: string;
}

const stateTtlMs = 10 * 60 * 1000;
const callbackStateJobType = "delegated_oauth.callback_state";

const providerDefinitions: DelegatedOAuthProviderDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    connectorTypes: ["github"],
  },
];

interface DelegatedOAuthUsableToken {
  connection: DelegatedOAuthConnection;
  token: DelegatedOAuthStoredToken;
}

interface ProviderRevocationResult {
  errorCode?: string;
  status: "failed" | "skipped" | "succeeded";
}

export class DelegatedOAuthService {
  private readonly appOrigin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshLocks = new Map<
    string,
    Promise<DelegatedOAuthUsableToken>
  >();

  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.appOrigin = normalizeAppOrigin(env.APP_ORIGIN);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  listProviders(subject: AuthSubject): DelegatedOAuthProvider[] {
    assertScope(subject, "knowledge:read");
    return providerDefinitions.map((definition) =>
      this.toPublicProvider(definition),
    );
  }

  async adminPosture(
    subject: AuthSubject,
  ): Promise<DelegatedOAuthPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const nowMs = Date.now();
    const connections = await this.repository.listDelegatedOAuthConnections(
      subject.orgId,
    );
    const warnings = new Set<string>();
    const providers = providerDefinitions.map((definition) => {
      const provider = this.toPublicProvider(definition);
      const scopedConnections = connections.filter(
        (connection) => connection.providerId === definition.id,
      );
      const connectionCounts = delegatedOAuthConnectionPostureCounts(
        scopedConnections,
        nowMs,
      );
      if (!provider.configured) {
        warnings.add(`delegated_oauth_provider_not_configured:${provider.id}`);
      }
      addConnectionPostureWarnings(warnings, provider.id, connectionCounts);
      return {
        authorizationHost: provider.authorizationHost,
        configured: provider.configured,
        connectorTypes: provider.connectorTypes,
        connectionCounts,
        defaultScopeCount: provider.defaultScopes.length,
        displayName: provider.displayName,
        id: provider.id,
        pkceRequired: true,
        tokenHost: provider.tokenHost,
      } satisfies DelegatedOAuthProviderPosture;
    });
    const connectorTypes = providerDefinitions
      .flatMap((definition) => definition.connectorTypes)
      .filter((item, index, all) => all.indexOf(item) === index)
      .sort()
      .map((connectorType) => {
        const connectionCounts = delegatedOAuthConnectionPostureCounts(
          connections.filter(
            (connection) => connection.connectorType === connectorType,
          ),
          nowMs,
        );
        addConnectionPostureWarnings(warnings, connectorType, connectionCounts);
        return {
          connectorType,
          connectionCounts,
        } satisfies DelegatedOAuthConnectorTypePosture;
      });
    const warningList = [...warnings].sort();
    return {
      connectorTypes,
      generatedAt,
      orgId: subject.orgId,
      providers,
      redaction: {
        rawAccessTokensReturned: false,
        rawClientSecretsReturned: false,
        rawProviderAccountIdsReturned: false,
        rawProviderAccountLoginsReturned: false,
        rawProviderUrlsReturned: false,
        rawRefreshTokensReturned: false,
      },
      schema: "romeo.delegated-oauth-posture.v1",
      status: warningList.length === 0 ? "healthy" : "attention_required",
      warnings: warningList,
    };
  }

  start(input: {
    connectorType: DataConnectorType;
    providerId: DelegatedOAuthProviderId;
    returnTo?: string;
    scopes?: string[];
    subject: AuthSubject;
    workspaceId: string;
  }): DelegatedOAuthStartResult {
    assertScope(input.subject, "knowledge:write");
    if (input.subject.type !== "user") {
      throw new ApiError(
        "delegated_oauth_user_required",
        "Delegated OAuth connections require a user subject.",
        403,
      );
    }
    if (!hasWorkspaceAccess(input.subject, input.workspaceId)) {
      throw new ApiError(
        "forbidden",
        "The workspace is outside the caller access.",
        403,
      );
    }

    const definition = this.providerDefinition(input.providerId);
    if (!definition.connectorTypes.includes(input.connectorType)) {
      throw new ApiError(
        "delegated_oauth_connector_unsupported",
        "Delegated OAuth provider does not support the requested connector type.",
        400,
      );
    }
    const clientId = this.clientId(definition.id);
    this.assertProviderReady(definition.id, clientId);

    const scopes = this.normalizeScopes(input.scopes);
    const state = randomToken(32);
    const codeVerifier = randomToken(32);
    const nonce = randomToken(24);
    const expiresAt = new Date(Date.now() + stateTtlMs).toISOString();
    const redirectUri = new URL(
      "/api/v1/delegated-oauth/callback",
      this.appOrigin,
    ).toString();
    const stateCookie = this.signState({
      v: 1,
      state,
      codeVerifier,
      nonce,
      orgId: input.subject.orgId,
      userId: input.subject.id,
      workspaceId: input.workspaceId,
      providerId: definition.id,
      connectorType: input.connectorType,
      redirectUri,
      returnTo: sanitizeReturnTo(input.returnTo),
      scopes,
      expiresAt,
    });

    const authorizationUrl = new URL(definition.authorizationUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", scopes.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set(
      "code_challenge",
      codeChallenge(codeVerifier),
    );
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return {
      authorizationUrl: authorizationUrl.toString(),
      connectorType: input.connectorType,
      expiresAt,
      provider: this.toPublicProvider(definition),
      scopes,
      stateCookie,
      workspaceId: input.workspaceId,
    };
  }

  async complete(input: {
    code: string;
    state: string;
    stateCookie?: string;
  }): Promise<DelegatedOAuthCallbackResult> {
    const stored = this.verifyState(input.stateCookie);
    if (stored.state !== input.state) {
      throw new ApiError(
        "delegated_oauth_state_mismatch",
        "Delegated OAuth state did not match.",
        400,
      );
    }
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(
        "delegated_oauth_state_expired",
        "Delegated OAuth state has expired.",
        400,
      );
    }

    const definition = this.providerDefinition(stored.providerId);
    const clientId = this.clientId(definition.id);
    this.assertProviderReady(definition.id, clientId);
    await this.consumeCallbackState(stored);

    const providerToken = await this.exchangeProviderToken(definition, {
      clientId,
      code: input.code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri,
      scopes: stored.scopes,
    });
    const now = new Date().toISOString();
    const tokenVault = new DelegatedOAuthTokenVault(
      this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
    );
    const token = tokenVault.encrypt(storedToken(providerToken, now));
    const actor = stateSubject(stored);
    const connection = await this.repository.transaction(async (repository) => {
      const existing =
        await repository.getDelegatedOAuthConnectionByProviderAccount({
          orgId: stored.orgId,
          workspaceId: stored.workspaceId,
          userId: stored.userId,
          providerId: stored.providerId,
          connectorType: stored.connectorType,
          providerAccountId: providerToken.providerAccountId,
        });
      const next = connectionRecord({
        existing,
        now,
        providerToken,
        state: stored,
        token,
      });
      const saved =
        existing === undefined
          ? await repository.createDelegatedOAuthConnection(next)
          : await repository.updateDelegatedOAuthConnection(next);
      await this.audit(
        actor,
        "delegated_oauth.connect",
        saved.id,
        "success",
        {
          connectorType: saved.connectorType,
          providerId: saved.providerId,
          providerAccountHash: stableHash(saved.providerAccountId),
          scopeCount: saved.scopes.length,
          workspaceId: saved.workspaceId,
        },
        repository,
      );
      return saved;
    });

    return {
      connection: toConnectionSummary(connection),
      returnTo: stored.returnTo,
    };
  }

  async listConnections(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<DelegatedOAuthConnectionSummary[]> {
    assertScope(subject, "knowledge:read");
    if (!subject.isAdmin && subject.type !== "user") {
      throw new ApiError(
        "delegated_oauth_user_required",
        "Delegated OAuth connections require a user subject.",
        403,
      );
    }
    if (
      workspaceId !== undefined &&
      !hasWorkspaceAccess(subject, workspaceId)
    ) {
      throw new ApiError(
        "forbidden",
        "The workspace is outside the caller access.",
        403,
      );
    }
    const connections = await this.repository.listDelegatedOAuthConnections(
      subject.orgId,
      workspaceId,
      subject.isAdmin ? undefined : subject.id,
    );
    return connections
      .filter(
        (connection) =>
          subject.isAdmin ||
          hasWorkspaceAccess(subject, connection.workspaceId),
      )
      .map(toConnectionSummary);
  }

  async revoke(input: {
    connectionId: string;
    subject: AuthSubject;
  }): Promise<DelegatedOAuthConnectionSummary> {
    assertScope(input.subject, "knowledge:write");
    const connection = await this.repository.getDelegatedOAuthConnection(
      input.connectionId,
    );
    if (connection === undefined || connection.orgId !== input.subject.orgId) {
      throw new ApiError(
        "delegated_oauth_connection_not_found",
        "Delegated OAuth connection was not found.",
        404,
      );
    }
    if (!hasWorkspaceAccess(input.subject, connection.workspaceId)) {
      throw new ApiError(
        "forbidden",
        "The workspace is outside the caller access.",
        403,
      );
    }
    if (!input.subject.isAdmin && connection.userId !== input.subject.id) {
      throw new ApiError(
        "delegated_oauth_connection_forbidden",
        "Delegated OAuth connection is outside the caller access.",
        403,
      );
    }

    const providerRevocation: ProviderRevocationResult =
      connection.status === "revoked"
        ? { status: "skipped" }
        : await this.revokeProviderConnection(connection);
    const now = new Date().toISOString();
    const updated = await this.repository.transaction(async (repository) => {
      const saved = await repository.updateDelegatedOAuthConnection({
        ...connection,
        status: "revoked",
        revokedAt: connection.revokedAt ?? now,
        updatedAt: now,
      });
      await this.audit(
        input.subject,
        "delegated_oauth.revoke",
        saved.id,
        "success",
        {
          connectorType: saved.connectorType,
          providerId: saved.providerId,
          providerAccountHash: stableHash(saved.providerAccountId),
          providerRevocationStatus: providerRevocation.status,
          ...(providerRevocation.errorCode === undefined
            ? {}
            : { providerRevocationErrorCode: providerRevocation.errorCode }),
          workspaceId: saved.workspaceId,
        },
        repository,
      );
      return saved;
    });
    const summary = toConnectionSummary(updated);
    summary.providerRevocationStatus = providerRevocation.status;
    if (providerRevocation.errorCode !== undefined) {
      summary.providerRevocationErrorCode = providerRevocation.errorCode;
    }
    return summary;
  }

  async getConnectorAccessToken(input: {
    connectionId: string;
    connector: DataConnector;
  }): Promise<string> {
    const connection = await this.repository.getDelegatedOAuthConnection(
      input.connectionId,
    );
    if (
      connection === undefined ||
      connection.orgId !== input.connector.orgId ||
      connection.workspaceId !== input.connector.workspaceId ||
      connection.userId !== input.connector.createdBy ||
      connection.connectorType !== input.connector.type
    ) {
      throw new ApiError(
        "connector_delegated_oauth_not_found",
        "Delegated OAuth connection is unavailable for this connector.",
        409,
      );
    }
    if (connection.status === "revoked") {
      throw new ApiError(
        "connector_delegated_oauth_revoked",
        "Delegated OAuth connection has been revoked.",
        409,
      );
    }
    if (connection.status === "reauthorization_required") {
      throw new ApiError(
        "connector_delegated_oauth_reauthorization_required",
        "Delegated OAuth connection requires reauthorization.",
        409,
      );
    }

    const tokenVault = new DelegatedOAuthTokenVault(
      this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
    );
    const token = tokenVault.decrypt(connection.token);
    const usable = isExpiredOrNearExpiry(token)
      ? await this.refreshUsableToken(connection, tokenVault)
      : await this.markConnectionUsed(connection, token);
    return usable.token.accessToken;
  }

  private async exchangeProviderToken(
    definition: DelegatedOAuthProviderDefinition,
    input: {
      clientId: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
      scopes: string[];
    },
  ): Promise<DelegatedOAuthProviderToken> {
    switch (definition.id) {
      case "github":
        return exchangeGitHubDelegatedOAuth(
          {
            clientId: input.clientId,
            clientSecret: this.clientSecret(definition.id),
            code: input.code,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
            requestedScopes: input.scopes,
            tokenUrl: definition.tokenUrl,
          },
          this.fetchImpl,
        );
    }
  }

  private async consumeCallbackState(
    state: DelegatedOAuthState,
  ): Promise<void> {
    const now = new Date().toISOString();
    const job = callbackStateJob(state, now);
    try {
      await this.repository.transaction(async (repository) => {
        const existing = (
          await repository.listBackgroundJobs(state.orgId)
        ).find((item) => item.id === job.id);
        if (existing !== undefined) throw callbackStateReplayError();
        await repository.createBackgroundJob(job);
      });
    } catch (error) {
      if (isCallbackStateReplayError(error)) throw error;
      if (isUniqueConstraintError(error)) throw callbackStateReplayError();
      throw error;
    }
  }

  private async revokeProviderConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<ProviderRevocationResult> {
    try {
      const tokenVault = new DelegatedOAuthTokenVault(
        this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
      );
      const token = tokenVault.decrypt(connection.token);
      const definition = this.providerDefinition(connection.providerId);
      await this.revokeProviderGrant(definition, token.accessToken);
      return { status: "succeeded" };
    } catch (error) {
      return { status: "failed", errorCode: apiErrorCode(error) };
    }
  }

  private async revokeProviderGrant(
    definition: DelegatedOAuthProviderDefinition,
    accessToken: string,
  ): Promise<void> {
    this.assertProviderReady(definition.id);
    switch (definition.id) {
      case "github":
        await revokeGitHubDelegatedOAuth(
          {
            accessToken,
            clientId: this.clientId(definition.id),
            clientSecret: this.clientSecret(definition.id),
          },
          this.fetchImpl,
        );
    }
  }

  private async refreshUsableToken(
    connection: DelegatedOAuthConnection,
    tokenVault: DelegatedOAuthTokenVault,
  ): Promise<DelegatedOAuthUsableToken> {
    const locked = this.refreshLocks.get(connection.id);
    if (locked !== undefined) return locked;
    const pending = this.repository
      .withDelegatedOAuthConnectionRefreshLock(
        connection.id,
        async (repository) => {
          const latest = await repository.getDelegatedOAuthConnection(
            connection.id,
          );
          if (latest === undefined) {
            throw new ApiError(
              "connector_delegated_oauth_not_found",
              "Delegated OAuth connection is unavailable for this connector.",
              409,
            );
          }
          if (latest.status === "revoked") {
            throw new ApiError(
              "connector_delegated_oauth_revoked",
              "Delegated OAuth connection has been revoked.",
              409,
            );
          }
          if (latest.status === "reauthorization_required") {
            throw new ApiError(
              "connector_delegated_oauth_reauthorization_required",
              "Delegated OAuth connection requires reauthorization.",
              409,
            );
          }
          const latestToken = tokenVault.decrypt(latest.token);
          if (!isExpiredOrNearExpiry(latestToken)) {
            return this.markConnectionUsed(latest, latestToken, repository);
          }
          return this.refreshConnectionToken(
            latest,
            latestToken,
            tokenVault,
            repository,
          );
        },
      )
      .finally(() => this.refreshLocks.delete(connection.id));
    this.refreshLocks.set(connection.id, pending);
    return pending;
  }

  private async refreshConnectionToken(
    connection: DelegatedOAuthConnection,
    token: DelegatedOAuthStoredToken,
    tokenVault: DelegatedOAuthTokenVault,
    repository: RomeoRepository = this.repository,
  ): Promise<DelegatedOAuthUsableToken> {
    if (token.refreshToken === undefined || token.refreshToken.length === 0) {
      await this.markConnectionReauthorizationRequired(
        connection,
        "delegated_oauth_refresh_token_missing",
        repository,
      );
      throw new ApiError(
        "connector_delegated_oauth_expired",
        "Delegated OAuth connection has expired and requires reauthorization.",
        409,
      );
    }
    try {
      const definition = this.providerDefinition(connection.providerId);
      const refreshed = await this.refreshProviderToken(definition, {
        refreshToken: token.refreshToken,
        scopes: connection.scopes,
      });
      const now = new Date().toISOString();
      const nextToken = refreshedStoredToken(refreshed, token, now);
      const nextConnection = refreshedConnectionRecord({
        connection,
        now,
        refreshed,
        token: tokenVault.encrypt(nextToken),
      });
      const saved =
        await repository.updateDelegatedOAuthConnection(nextConnection);
      await this.audit(
        stateSubjectFromConnection(saved),
        "delegated_oauth.refresh",
        saved.id,
        "success",
        {
          connectorType: saved.connectorType,
          providerId: saved.providerId,
          providerAccountHash: stableHash(saved.providerAccountId),
          scopeCount: saved.scopes.length,
          workspaceId: saved.workspaceId,
        },
        repository,
      );
      return { connection: saved, token: nextToken };
    } catch (error) {
      await this.markConnectionReauthorizationRequired(
        connection,
        error instanceof ApiError
          ? error.code
          : "delegated_oauth_token_refresh_failed",
        repository,
      );
      throw new ApiError(
        "connector_delegated_oauth_refresh_failed",
        "Delegated OAuth connection refresh failed and requires reauthorization.",
        409,
      );
    }
  }

  private async refreshProviderToken(
    definition: DelegatedOAuthProviderDefinition,
    input: { refreshToken: string; scopes: string[] },
  ): Promise<DelegatedOAuthProviderRefreshedToken> {
    this.assertProviderReady(definition.id);
    switch (definition.id) {
      case "github":
        return refreshGitHubDelegatedOAuth(
          {
            clientId: this.clientId(definition.id),
            clientSecret: this.clientSecret(definition.id),
            refreshToken: input.refreshToken,
            requestedScopes: input.scopes,
            tokenUrl: definition.tokenUrl,
          },
          this.fetchImpl,
        );
    }
  }

  private async markConnectionUsed(
    connection: DelegatedOAuthConnection,
    token: DelegatedOAuthStoredToken,
    repository: RomeoRepository = this.repository,
  ): Promise<DelegatedOAuthUsableToken> {
    const now = new Date().toISOString();
    const updated = await repository.updateDelegatedOAuthConnection({
      ...connection,
      lastUsedAt: now,
      updatedAt: now,
    });
    return { connection: updated, token };
  }

  private async markConnectionReauthorizationRequired(
    connection: DelegatedOAuthConnection,
    errorCode: string,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updated = await repository.updateDelegatedOAuthConnection({
      ...connection,
      status: "reauthorization_required",
      updatedAt: now,
    });
    await this.audit(
      stateSubjectFromConnection(updated),
      "delegated_oauth.refresh",
      updated.id,
      "failure",
      {
        connectorType: updated.connectorType,
        errorCode,
        providerId: updated.providerId,
        providerAccountHash: stableHash(updated.providerAccountId),
        workspaceId: updated.workspaceId,
      },
      repository,
    );
  }

  private providerDefinition(
    providerId: DelegatedOAuthProviderId,
  ): DelegatedOAuthProviderDefinition {
    const definition = providerDefinitions.find(
      (item) => item.id === providerId,
    );
    if (definition === undefined) {
      throw new ApiError(
        "delegated_oauth_provider_unknown",
        "Delegated OAuth provider is not supported.",
        404,
      );
    }
    return definition;
  }

  private toPublicProvider(
    definition: DelegatedOAuthProviderDefinition,
  ): DelegatedOAuthProvider {
    return {
      authorizationHost: new URL(definition.authorizationUrl).host,
      configured: this.isProviderReady(definition.id),
      connectorTypes: definition.connectorTypes,
      defaultScopes: this.normalizeScopes(),
      displayName: definition.displayName,
      id: definition.id,
      pkceRequired: true,
      tokenHost: new URL(definition.tokenUrl).host,
    };
  }

  private assertProviderReady(
    providerId: DelegatedOAuthProviderId,
    clientId = this.clientId(providerId),
  ): void {
    if (clientId.length === 0) {
      throw new ApiError(
        "delegated_oauth_provider_not_configured",
        "Delegated OAuth provider is not configured.",
        409,
      );
    }
    if (this.clientSecret(providerId).length === 0) {
      throw new ApiError(
        "delegated_oauth_client_secret_not_configured",
        "Delegated OAuth client secret is not configured.",
        409,
      );
    }
    new DelegatedOAuthTokenVault(this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY);
  }

  private isProviderReady(providerId: DelegatedOAuthProviderId): boolean {
    return (
      this.clientId(providerId).length > 0 &&
      this.clientSecret(providerId).length > 0 &&
      this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY.trim().length >= 32
    );
  }

  private clientId(providerId: DelegatedOAuthProviderId): string {
    switch (providerId) {
      case "github":
        return this.env.DELEGATED_OAUTH_GITHUB_CLIENT_ID;
    }
  }

  private clientSecret(providerId: DelegatedOAuthProviderId): string {
    switch (providerId) {
      case "github":
        return this.env.DELEGATED_OAUTH_GITHUB_CLIENT_SECRET;
    }
  }

  private normalizeScopes(input?: string[]): string[] {
    const allowed = csv(this.env.DELEGATED_OAUTH_GITHUB_SCOPES);
    const requested =
      input === undefined || input.length === 0 ? allowed : input;
    const scopes: string[] = [];
    for (const raw of requested) {
      const scope = raw.trim();
      if (!/^[A-Za-z0-9:_./-]{1,120}$/u.test(scope)) {
        throw new ApiError(
          "delegated_oauth_scope_invalid",
          "Delegated OAuth scopes must use safe scope names.",
          400,
        );
      }
      if (!allowed.includes(scope)) {
        throw new ApiError(
          "delegated_oauth_scope_not_allowed",
          "Delegated OAuth scope is not allowed for this provider.",
          400,
        );
      }
      if (!scopes.includes(scope)) scopes.push(scope);
      if (scopes.length > 20) {
        throw new ApiError(
          "delegated_oauth_scope_limit",
          "Delegated OAuth scope count exceeds the limit.",
          400,
        );
      }
    }
    if (scopes.length === 0) {
      throw new ApiError(
        "delegated_oauth_scope_required",
        "Delegated OAuth requires at least one scope.",
        400,
      );
    }
    return scopes;
  }

  private signState(state: DelegatedOAuthState): string {
    const payload = base64Url(JSON.stringify(state));
    const signature = this.signPayload(payload);
    return `${payload}.${signature}`;
  }

  private verifyState(value: string | undefined): DelegatedOAuthState {
    if (value === undefined || value.length === 0) {
      throw new ApiError(
        "delegated_oauth_state_missing",
        "Delegated OAuth state cookie is missing.",
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
        "delegated_oauth_state_invalid",
        "Delegated OAuth state is invalid.",
        400,
      );
    }
    const decoded = parseJsonState(payload);
    if (!isDelegatedOAuthState(decoded)) {
      throw new ApiError(
        "delegated_oauth_state_invalid",
        "Delegated OAuth state is invalid.",
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

  private async audit(
    subject: AuthSubject,
    action: string,
    resourceId: string,
    outcome: "success" | "failure",
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: subject.id,
      action,
      resourceType: "data_connector",
      resourceId,
      outcome,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }
}

function connectionRecord(input: {
  existing: DelegatedOAuthConnection | undefined;
  now: string;
  providerToken: DelegatedOAuthProviderToken;
  state: DelegatedOAuthState;
  token: DelegatedOAuthConnection["token"];
}): DelegatedOAuthConnection {
  const connection: DelegatedOAuthConnection = {
    id: input.existing?.id ?? createId("delegated_oauth_connection"),
    orgId: input.state.orgId,
    workspaceId: input.state.workspaceId,
    userId: input.state.userId,
    providerId: input.state.providerId,
    connectorType: input.state.connectorType,
    providerAccountId: input.providerToken.providerAccountId,
    scopes: input.providerToken.scopes,
    status: "active",
    token: input.token,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  if (input.providerToken.providerAccountLogin !== undefined)
    connection.providerAccountLogin = input.providerToken.providerAccountLogin;
  if (input.providerToken.accessTokenExpiresAt !== undefined)
    connection.accessTokenExpiresAt = input.providerToken.accessTokenExpiresAt;
  if (input.providerToken.refreshTokenExpiresAt !== undefined) {
    connection.refreshTokenExpiresAt =
      input.providerToken.refreshTokenExpiresAt;
  }
  if (input.existing?.lastUsedAt !== undefined)
    connection.lastUsedAt = input.existing.lastUsedAt;
  return connection;
}

function storedToken(
  providerToken: DelegatedOAuthProviderToken,
  obtainedAt: string,
): DelegatedOAuthStoredToken {
  const token: DelegatedOAuthStoredToken = {
    accessToken: providerToken.accessToken,
    tokenType: providerToken.tokenType,
    obtainedAt,
    scopes: providerToken.scopes,
  };
  if (providerToken.refreshToken !== undefined)
    token.refreshToken = providerToken.refreshToken;
  if (providerToken.accessTokenExpiresAt !== undefined)
    token.expiresAt = providerToken.accessTokenExpiresAt;
  if (providerToken.refreshTokenExpiresAt !== undefined)
    token.refreshTokenExpiresAt = providerToken.refreshTokenExpiresAt;
  return token;
}

function refreshedStoredToken(
  refreshed: DelegatedOAuthProviderRefreshedToken,
  previous: DelegatedOAuthStoredToken,
  obtainedAt: string,
): DelegatedOAuthStoredToken {
  const token: DelegatedOAuthStoredToken = {
    accessToken: refreshed.accessToken,
    tokenType: refreshed.tokenType,
    obtainedAt,
    scopes: refreshed.scopes,
  };
  const refreshToken = refreshed.refreshToken ?? previous.refreshToken;
  if (refreshToken !== undefined) token.refreshToken = refreshToken;
  if (refreshed.accessTokenExpiresAt !== undefined)
    token.expiresAt = refreshed.accessTokenExpiresAt;
  const refreshTokenExpiresAt =
    refreshed.refreshTokenExpiresAt ?? previous.refreshTokenExpiresAt;
  if (refreshTokenExpiresAt !== undefined)
    token.refreshTokenExpiresAt = refreshTokenExpiresAt;
  return token;
}

function refreshedConnectionRecord(input: {
  connection: DelegatedOAuthConnection;
  now: string;
  refreshed: DelegatedOAuthProviderRefreshedToken;
  token: DelegatedOAuthConnection["token"];
}): DelegatedOAuthConnection {
  const connection: DelegatedOAuthConnection = {
    ...input.connection,
    scopes: input.refreshed.scopes,
    status: "active",
    token: input.token,
    lastUsedAt: input.now,
    updatedAt: input.now,
  };
  if (input.refreshed.accessTokenExpiresAt !== undefined)
    connection.accessTokenExpiresAt = input.refreshed.accessTokenExpiresAt;
  if (input.refreshed.refreshTokenExpiresAt !== undefined) {
    connection.refreshTokenExpiresAt = input.refreshed.refreshTokenExpiresAt;
  }
  return connection;
}

function toConnectionSummary(
  connection: DelegatedOAuthConnection,
): DelegatedOAuthConnectionSummary {
  const summary: DelegatedOAuthConnectionSummary = {
    id: connection.id,
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    providerId: connection.providerId,
    connectorType: connection.connectorType,
    providerAccountHash: stableHash(connection.providerAccountId),
    providerAccountLoginConfigured:
      connection.providerAccountLogin !== undefined,
    scopes: connection.scopes,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
  if (connection.providerAccountLogin !== undefined)
    summary.providerAccountLoginHash = stableHash(
      connection.providerAccountLogin,
    );
  if (connection.accessTokenExpiresAt !== undefined)
    summary.accessTokenExpiresAt = connection.accessTokenExpiresAt;
  if (connection.refreshTokenExpiresAt !== undefined)
    summary.refreshTokenExpiresAt = connection.refreshTokenExpiresAt;
  if (connection.lastUsedAt !== undefined)
    summary.lastUsedAt = connection.lastUsedAt;
  if (connection.revokedAt !== undefined)
    summary.revokedAt = connection.revokedAt;
  return summary;
}

function delegatedOAuthConnectionPostureCounts(
  connections: DelegatedOAuthConnection[],
  nowMs: number,
): DelegatedOAuthConnectionPostureCounts {
  const nearExpiryMs = 24 * 60 * 60 * 1000;
  const counts: DelegatedOAuthConnectionPostureCounts = {
    active: 0,
    expiredAccessToken: 0,
    expiringAccessToken: 0,
    reauthorizationRequired: 0,
    revoked: 0,
    total: connections.length,
    unused: 0,
  };
  for (const connection of connections) {
    if (connection.status === "active") {
      counts.active += 1;
      if (connection.lastUsedAt === undefined) counts.unused += 1;
      const expiresAtMs =
        connection.accessTokenExpiresAt === undefined
          ? Number.NaN
          : new Date(connection.accessTokenExpiresAt).getTime();
      if (Number.isFinite(expiresAtMs)) {
        if (expiresAtMs <= nowMs) counts.expiredAccessToken += 1;
        else if (expiresAtMs <= nowMs + nearExpiryMs) {
          counts.expiringAccessToken += 1;
        }
      }
    } else if (connection.status === "reauthorization_required") {
      counts.reauthorizationRequired += 1;
    } else if (connection.status === "revoked") {
      counts.revoked += 1;
    }
  }
  return counts;
}

function addConnectionPostureWarnings(
  warnings: Set<string>,
  scope: string,
  counts: DelegatedOAuthConnectionPostureCounts,
): void {
  if (counts.expiredAccessToken > 0) {
    warnings.add(`delegated_oauth_access_token_expired:${scope}`);
  }
  if (counts.expiringAccessToken > 0) {
    warnings.add(`delegated_oauth_access_token_expiring:${scope}`);
  }
  if (counts.reauthorizationRequired > 0) {
    warnings.add(`delegated_oauth_reauthorization_required:${scope}`);
  }
  if (counts.revoked > 0) {
    warnings.add(`delegated_oauth_revoked_connections_present:${scope}`);
  }
}

function stateSubject(state: DelegatedOAuthState): AuthSubject {
  return {
    id: state.userId,
    type: "user",
    orgId: state.orgId,
    workspaceIds: [state.workspaceId],
    groupIds: [],
    scopes: [],
  };
}

function stateSubjectFromConnection(
  connection: DelegatedOAuthConnection,
): AuthSubject {
  return {
    id: connection.userId,
    type: "user",
    orgId: connection.orgId,
    workspaceIds: [connection.workspaceId],
    groupIds: [],
    scopes: [],
  };
}

function isExpiredOrNearExpiry(token: DelegatedOAuthStoredToken): boolean {
  if (token.expiresAt === undefined) return false;
  return new Date(token.expiresAt).getTime() <= Date.now() + 60_000;
}

function normalizeAppOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
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
      "invalid_delegated_oauth_return_to",
      "Delegated OAuth return path must be a relative application path.",
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

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
      "delegated_oauth_state_invalid",
      "Delegated OAuth state is invalid.",
      400,
    );
  }
}

function isDelegatedOAuthState(value: unknown): value is DelegatedOAuthState {
  const candidate = value as Partial<DelegatedOAuthState>;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.v === 1 &&
    typeof candidate.state === "string" &&
    typeof candidate.codeVerifier === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.orgId === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.workspaceId === "string" &&
    candidate.providerId === "github" &&
    isConnectorType(candidate.connectorType) &&
    typeof candidate.redirectUri === "string" &&
    typeof candidate.returnTo === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    typeof candidate.expiresAt === "string"
  );
}

function callbackStateJob(
  state: DelegatedOAuthState,
  now: string,
): BackgroundJob {
  const stateHash = callbackStateHash(state);
  return {
    id: `delegated_oauth_state_${stateHash}`,
    orgId: state.orgId,
    workspaceId: state.workspaceId,
    type: callbackStateJobType,
    status: "completed",
    payload: {
      connectorType: state.connectorType,
      expiresAt: state.expiresAt,
      providerId: state.providerId,
      purpose: "delegated_oauth_callback_replay_guard",
      stateHash,
      userId: state.userId,
      workspaceId: state.workspaceId,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

function callbackStateHash(state: DelegatedOAuthState): string {
  return createHash("sha256")
    .update(
      [
        state.orgId,
        state.userId,
        state.workspaceId,
        state.providerId,
        state.connectorType,
        state.state,
        state.nonce,
      ].join("\0"),
    )
    .digest("hex");
}

function callbackStateReplayError(): ApiError {
  return new ApiError(
    "delegated_oauth_state_replayed",
    "Delegated OAuth state has already been used.",
    409,
  );
}

function isCallbackStateReplayError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.code === "delegated_oauth_state_replayed"
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

function apiErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "delegated_oauth_provider_revoke_failed";
}

function isConnectorType(value: unknown): value is DataConnectorType {
  return (
    value === "github" ||
    value === "local_import" ||
    value === "rss" ||
    value === "s3" ||
    value === "website" ||
    value === "confluence" ||
    value === "jira" ||
    value === "notion" ||
    value === "linear" ||
    value === "slack"
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
