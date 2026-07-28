import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type { DataConnectorType } from "../domain/data-connectors";
import type {
  DelegatedOAuthCallbackResult,
  DelegatedOAuthConnectionPostureCounts,
  DelegatedOAuthConnectionSummary,
  DelegatedOAuthConnectorTypePosture,
  DelegatedOAuthPostureReport,
  DelegatedOAuthProvider,
  DelegatedOAuthProviderId,
  DelegatedOAuthProviderPosture,
  DelegatedOAuthStartResult,
} from "../domain/delegated-oauth";
import type { DataConnector } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import {
  DelegatedOAuthConfiguration,
  providerDefinitions,
} from "./delegated-oauth-configuration";
import type {
  DelegatedOAuthState,
  ProviderRevocationResult,
} from "./delegated-oauth-internal-types";
import {
  addConnectionPostureWarnings,
  connectionRecord,
  delegatedOAuthConnectionPostureCounts,
  storedToken,
  toConnectionSummary,
} from "./delegated-oauth-records";
import {
  auditDelegatedOAuth,
  callbackStateJob,
  callbackStateReplayError,
  codeChallenge,
  isCallbackStateReplayError,
  isUniqueConstraintError,
  normalizeAppOrigin,
  randomToken,
  sanitizeReturnTo,
  stableHash,
  stateSubject,
} from "./delegated-oauth-support";
import { DelegatedOAuthTokenRuntime } from "./delegated-oauth-token-runtime";
import { DelegatedOAuthTokenVault } from "./delegated-oauth-token-vault";

const stateTtlMs = 10 * 60 * 1000;

export class DelegatedOAuthService {
  private readonly appOrigin: string;
  private readonly configuration: DelegatedOAuthConfiguration;
  private readonly tokenRuntime: DelegatedOAuthTokenRuntime;

  constructor(
    private readonly repository: RomeoRepository,
    env: RomeoEnv,
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.appOrigin = normalizeAppOrigin(env.APP_ORIGIN);
    this.configuration = new DelegatedOAuthConfiguration(env);
    this.tokenRuntime = new DelegatedOAuthTokenRuntime(
      repository,
      env,
      this.configuration,
      options,
    );
  }

  listProviders(subject: AuthSubject): DelegatedOAuthProvider[] {
    assertScope(subject, "knowledge:read");
    return providerDefinitions.map((definition) =>
      this.configuration.toPublicProvider(definition),
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
      const provider = this.configuration.toPublicProvider(definition);
      const connectionCounts = delegatedOAuthConnectionPostureCounts(
        connections.filter(
          (connection) => connection.providerId === definition.id,
        ),
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

    const definition = this.configuration.providerDefinition(input.providerId);
    if (!definition.connectorTypes.includes(input.connectorType)) {
      throw new ApiError(
        "delegated_oauth_connector_unsupported",
        "Delegated OAuth provider does not support the requested connector type.",
        400,
      );
    }
    const clientId = this.configuration.clientId(definition.id);
    this.configuration.assertProviderReady(definition.id, clientId);
    const scopes = this.configuration.normalizeScopes(input.scopes);
    const state = randomToken(32);
    const codeVerifier = randomToken(32);
    const nonce = randomToken(24);
    const expiresAt = new Date(Date.now() + stateTtlMs).toISOString();
    const redirectUri = new URL(
      "/api/v1/delegated-oauth/callback",
      this.appOrigin,
    ).toString();
    const stateCookie = this.configuration.signState({
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
      provider: this.configuration.toPublicProvider(definition),
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
    const stored = this.configuration.verifyState(input.stateCookie);
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

    const definition = this.configuration.providerDefinition(stored.providerId);
    const clientId = this.configuration.clientId(definition.id);
    this.configuration.assertProviderReady(definition.id, clientId);
    await this.consumeCallbackState(stored);
    const providerToken = await this.tokenRuntime.exchangeProviderToken(
      definition,
      {
        clientId,
        code: input.code,
        codeVerifier: stored.codeVerifier,
        redirectUri: stored.redirectUri,
        scopes: stored.scopes,
      },
    );
    const now = new Date().toISOString();
    const tokenVault = new DelegatedOAuthTokenVault(
      this.configuration.tokenEncryptionKey,
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
      const saved =
        existing === undefined
          ? await repository.createDelegatedOAuthConnection(
              connectionRecord({
                existing,
                now,
                providerToken,
                state: stored,
                token,
              }),
            )
          : await repository.updateDelegatedOAuthConnection(
              connectionRecord({
                existing,
                now,
                providerToken,
                state: stored,
                token,
              }),
            );
      await auditDelegatedOAuth(
        repository,
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
        : await this.tokenRuntime.revokeProviderConnection(connection);
    const now = new Date().toISOString();
    const updated = await this.repository.transaction(async (repository) => {
      const saved = await repository.updateDelegatedOAuthConnection({
        ...connection,
        status: "revoked",
        revokedAt: connection.revokedAt ?? now,
        updatedAt: now,
      });
      await auditDelegatedOAuth(
        repository,
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
    const usable = await this.tokenRuntime.getUsableToken(connection);
    return usable.token.accessToken;
  }

  private async consumeCallbackState(
    state: DelegatedOAuthState,
  ): Promise<void> {
    const job = callbackStateJob(state, new Date().toISOString());
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
}
