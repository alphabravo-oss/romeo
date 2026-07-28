import type { RomeoEnv } from "@romeo/config";

import type { DelegatedOAuthConnection } from "../domain/delegated-oauth";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import {
  exchangeGitHubDelegatedOAuth,
  refreshGitHubDelegatedOAuth,
  revokeGitHubDelegatedOAuth,
  type DelegatedOAuthProviderToken,
} from "./delegated-oauth-github-provider";
import { DelegatedOAuthConfiguration } from "./delegated-oauth-configuration";
import type {
  DelegatedOAuthProviderDefinition,
  DelegatedOAuthUsableToken,
  ProviderRevocationResult,
} from "./delegated-oauth-internal-types";
import {
  refreshedConnectionRecord,
  refreshedStoredToken,
} from "./delegated-oauth-records";
import {
  auditDelegatedOAuth,
  apiErrorCode,
  isExpiredOrNearExpiry,
  stableHash,
  stateSubjectFromConnection,
} from "./delegated-oauth-support";
import {
  DelegatedOAuthTokenVault,
  type DelegatedOAuthStoredToken,
} from "./delegated-oauth-token-vault";

export class DelegatedOAuthTokenRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly refreshLocks = new Map<
    string,
    Promise<DelegatedOAuthUsableToken>
  >();

  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly configuration: DelegatedOAuthConfiguration,
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async exchangeProviderToken(
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
            clientSecret: this.configuration.clientSecret(definition.id),
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

  async revokeProviderConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<ProviderRevocationResult> {
    try {
      const tokenVault = new DelegatedOAuthTokenVault(
        this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
      );
      const token = tokenVault.decrypt(connection.token);
      const definition = this.configuration.providerDefinition(
        connection.providerId,
      );
      await this.revokeProviderGrant(definition, token.accessToken);
      return { status: "succeeded" };
    } catch (error) {
      return { status: "failed", errorCode: apiErrorCode(error) };
    }
  }

  async getUsableToken(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthUsableToken> {
    const tokenVault = new DelegatedOAuthTokenVault(
      this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
    );
    const token = tokenVault.decrypt(connection.token);
    return isExpiredOrNearExpiry(token)
      ? this.refreshUsableToken(connection, tokenVault)
      : this.markConnectionUsed(connection, token);
  }

  private async revokeProviderGrant(
    definition: DelegatedOAuthProviderDefinition,
    accessToken: string,
  ): Promise<void> {
    this.configuration.assertProviderReady(definition.id);
    switch (definition.id) {
      case "github":
        await revokeGitHubDelegatedOAuth(
          {
            accessToken,
            clientId: this.configuration.clientId(definition.id),
            clientSecret: this.configuration.clientSecret(definition.id),
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
    repository: RomeoRepository,
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
      const definition = this.configuration.providerDefinition(
        connection.providerId,
      );
      const refreshed = await this.refreshProviderToken(definition, {
        refreshToken: token.refreshToken,
        scopes: connection.scopes,
      });
      const now = new Date().toISOString();
      const nextToken = refreshedStoredToken(refreshed, token, now);
      const saved = await repository.updateDelegatedOAuthConnection(
        refreshedConnectionRecord({
          connection,
          now,
          refreshed,
          token: tokenVault.encrypt(nextToken),
        }),
      );
      await auditDelegatedOAuth(
        repository,
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
  ) {
    this.configuration.assertProviderReady(definition.id);
    switch (definition.id) {
      case "github":
        return refreshGitHubDelegatedOAuth(
          {
            clientId: this.configuration.clientId(definition.id),
            clientSecret: this.configuration.clientSecret(definition.id),
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
    repository: RomeoRepository,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updated = await repository.updateDelegatedOAuthConnection({
      ...connection,
      status: "reauthorization_required",
      updatedAt: now,
    });
    await auditDelegatedOAuth(
      repository,
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
    );
  }
}
