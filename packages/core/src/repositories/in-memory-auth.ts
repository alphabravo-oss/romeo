import type * as E from "../domain/entities";
import { append, replaceById } from "./collection-helpers";
import { InMemoryIdentityRepository } from "./in-memory-identity";

export abstract class InMemoryAuthRepository extends InMemoryIdentityRepository {
  async listApiKeys(orgId: string): Promise<E.ApiKey[]> {
    return this.data.apiKeys
      .filter((apiKey) => apiKey.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getApiKey(apiKeyId: string): Promise<E.ApiKey | undefined> {
    return this.data.apiKeys.find((apiKey) => apiKey.id === apiKeyId);
  }

  async getApiKeyByHash(hashedToken: string): Promise<E.ApiKey | undefined> {
    return this.data.apiKeys.find(
      (apiKey) => apiKey.hashedToken === hashedToken,
    );
  }

  async createApiKey(apiKey: E.ApiKey): Promise<E.ApiKey> {
    return append(this.data.apiKeys, apiKey);
  }

  async updateApiKey(apiKey: E.ApiKey): Promise<E.ApiKey> {
    return replaceById(this.data.apiKeys, apiKey);
  }

  async listDeviceAuthorizations(
    orgId: string,
    userId: string,
  ): Promise<E.DeviceAuthorization[]> {
    return this.data.deviceAuthorizations
      .filter(
        (authorization) =>
          authorization.orgId === orgId && authorization.userId === userId,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getDeviceAuthorization(
    deviceAuthorizationId: string,
  ): Promise<E.DeviceAuthorization | undefined> {
    return this.data.deviceAuthorizations.find(
      (authorization) => authorization.id === deviceAuthorizationId,
    );
  }

  async getDeviceAuthorizationByRefreshHash(
    hashedRefreshToken: string,
  ): Promise<E.DeviceAuthorization | undefined> {
    return this.data.deviceAuthorizations.find(
      (authorization) =>
        authorization.hashedRefreshToken === hashedRefreshToken,
    );
  }

  async createDeviceAuthorization(
    authorization: E.DeviceAuthorization,
  ): Promise<E.DeviceAuthorization> {
    return append(this.data.deviceAuthorizations, authorization);
  }

  async updateDeviceAuthorization(
    authorization: E.DeviceAuthorization,
  ): Promise<E.DeviceAuthorization> {
    return replaceById(this.data.deviceAuthorizations, authorization);
  }

  async rotateDeviceAuthorization(input: {
    authorization: E.DeviceAuthorization;
    expectedRefreshHash: string;
  }): Promise<E.DeviceAuthorization | undefined> {
    const current = this.data.deviceAuthorizations.find(
      (authorization) => authorization.id === input.authorization.id,
    );
    if (current?.hashedRefreshToken !== input.expectedRefreshHash)
      return undefined;
    return replaceById(this.data.deviceAuthorizations, input.authorization);
  }

  async listUserSessions(
    orgId: string,
    userId: string,
  ): Promise<E.UserSession[]> {
    return this.data.userSessions
      .filter((session) => session.orgId === orgId && session.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getUserSession(sessionId: string): Promise<E.UserSession | undefined> {
    return this.data.userSessions.find((session) => session.id === sessionId);
  }

  async getUserSessionByHash(
    hashedToken: string,
  ): Promise<E.UserSession | undefined> {
    return this.data.userSessions.find(
      (session) => session.hashedToken === hashedToken,
    );
  }

  async createUserSession(session: E.UserSession): Promise<E.UserSession> {
    return append(this.data.userSessions, session);
  }

  async updateUserSession(session: E.UserSession): Promise<E.UserSession> {
    return replaceById(this.data.userSessions, session);
  }

  async getLocalPasswordCredentialByUserId(
    userId: string,
  ): Promise<E.LocalPasswordCredential | undefined> {
    return this.data.localPasswordCredentials.find(
      (credential) => credential.userId === userId,
    );
  }

  async getLocalPasswordCredentialByEmail(
    orgId: string,
    emailNormalized: string,
  ): Promise<E.LocalPasswordCredential | undefined> {
    return this.data.localPasswordCredentials.find(
      (credential) =>
        credential.orgId === orgId &&
        credential.emailNormalized === emailNormalized,
    );
  }

  async createLocalPasswordCredential(
    credential: E.LocalPasswordCredential,
  ): Promise<E.LocalPasswordCredential> {
    const existing = this.data.localPasswordCredentials.find(
      (item) =>
        item.orgId === credential.orgId && item.userId === credential.userId,
    );
    return existing ?? append(this.data.localPasswordCredentials, credential);
  }

  async updateLocalPasswordCredential(
    credential: E.LocalPasswordCredential,
  ): Promise<E.LocalPasswordCredential> {
    // Like Postgres, a generic update never writes the MFA failure counter;
    // only the dedicated atomic MFA methods change it.
    const current = this.data.localPasswordCredentials.find(
      (item) => item.id === credential.id,
    );
    const next: E.LocalPasswordCredential = { ...credential };
    delete next.mfaFailedAttemptCount;
    if (current?.mfaFailedAttemptCount !== undefined)
      next.mfaFailedAttemptCount = current.mfaFailedAttemptCount;
    return replaceById(this.data.localPasswordCredentials, next);
  }

  async recordFailedLocalMfaAttempt(input: {
    credentialId: string;
    attemptedAt: string;
    lockedUntil: string;
    maxFailedAttempts: number;
  }): Promise<E.LocalPasswordCredential | undefined> {
    const current = this.data.localPasswordCredentials.find(
      (credential) => credential.id === input.credentialId,
    );
    if (current === undefined) return undefined;
    const mfaFailedAttemptCount = (current.mfaFailedAttemptCount ?? 0) + 1;
    return replaceById(this.data.localPasswordCredentials, {
      ...current,
      mfaFailedAttemptCount,
      updatedAt: input.attemptedAt,
      ...(mfaFailedAttemptCount >= input.maxFailedAttempts
        ? { lockedUntil: input.lockedUntil }
        : {}),
    });
  }

  async resetFailedLocalMfaAttempts(input: {
    credentialId: string;
    updatedAt: string;
  }): Promise<void> {
    const current = this.data.localPasswordCredentials.find(
      (credential) => credential.id === input.credentialId,
    );
    if (current === undefined || (current.mfaFailedAttemptCount ?? 0) === 0)
      return;
    const next: E.LocalPasswordCredential = {
      ...current,
      updatedAt: input.updatedAt,
    };
    delete next.mfaFailedAttemptCount;
    replaceById(this.data.localPasswordCredentials, next);
  }

  async recordFailedLocalPasswordAttempt(input: {
    credentialId: string;
    attemptedAt: string;
    lockedUntil: string;
    maxFailedAttempts: number;
  }): Promise<E.LocalPasswordCredential | undefined> {
    const current = this.data.localPasswordCredentials.find(
      (credential) => credential.id === input.credentialId,
    );
    if (current === undefined) return undefined;
    const failedAttemptCount = current.failedAttemptCount + 1;
    const updated: E.LocalPasswordCredential = {
      ...current,
      failedAttemptCount,
      updatedAt: input.attemptedAt,
      ...(failedAttemptCount >= input.maxFailedAttempts
        ? { lockedUntil: input.lockedUntil }
        : {}),
    };
    return replaceById(this.data.localPasswordCredentials, updated);
  }

  async listLocalMfaFactors(
    orgId: string,
    userId: string,
  ): Promise<E.LocalMfaFactor[]> {
    return this.data.localMfaFactors
      .filter((factor) => factor.orgId === orgId && factor.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listLocalMfaFactorsForOrg(orgId: string): Promise<E.LocalMfaFactor[]> {
    return this.data.localMfaFactors
      .filter((factor) => factor.orgId === orgId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getLocalMfaFactor(
    factorId: string,
  ): Promise<E.LocalMfaFactor | undefined> {
    return this.data.localMfaFactors.find((factor) => factor.id === factorId);
  }

  async createLocalMfaFactor(
    factor: E.LocalMfaFactor,
  ): Promise<E.LocalMfaFactor> {
    return append(this.data.localMfaFactors, factor);
  }

  async updateLocalMfaFactor(
    factor: E.LocalMfaFactor,
  ): Promise<E.LocalMfaFactor> {
    return replaceById(
      this.data.localMfaFactors,
      this.withStoredTotpStep(factor),
    );
  }

  async acceptLocalMfaTotpStep(input: {
    factorId: string;
    timeStep: number;
    usedAt: string;
  }): Promise<E.LocalMfaFactor | undefined> {
    const current = this.data.localMfaFactors.find(
      (factor) => factor.id === input.factorId,
    );
    if (
      current === undefined ||
      current.type !== "totp" ||
      current.status === "disabled" ||
      (current.lastTotpStep !== undefined &&
        current.lastTotpStep >= input.timeStep)
    )
      return undefined;
    return replaceById(this.data.localMfaFactors, {
      ...current,
      lastTotpStep: input.timeStep,
      lastUsedAt: input.usedAt,
      updatedAt: input.usedAt,
    });
  }

  /** Generic factor writes never move the replay watermark (as in Postgres). */
  private withStoredTotpStep(factor: E.LocalMfaFactor): E.LocalMfaFactor {
    const current = this.data.localMfaFactors.find(
      (item) => item.id === factor.id,
    );
    const next: E.LocalMfaFactor = { ...factor };
    delete next.lastTotpStep;
    if (current?.lastTotpStep !== undefined)
      next.lastTotpStep = current.lastTotpStep;
    return next;
  }

  async consumeLocalMfaFactor(input: {
    factor: E.LocalMfaFactor;
    expectedSecretEncrypted: string;
  }): Promise<E.LocalMfaFactor | undefined> {
    const current = this.data.localMfaFactors.find(
      (factor) => factor.id === input.factor.id,
    );
    if (
      current?.secretEncrypted !== input.expectedSecretEncrypted ||
      current.status !== "active"
    )
      return undefined;
    return replaceById(
      this.data.localMfaFactors,
      this.withStoredTotpStep(input.factor),
    );
  }

  async createLocalMfaChallenge(
    challenge: E.LocalMfaChallenge,
  ): Promise<E.LocalMfaChallenge> {
    const existing = this.data.localMfaChallenges.find(
      (item) => item.id === challenge.id,
    );
    return existing ?? append(this.data.localMfaChallenges, challenge);
  }

  async consumeLocalMfaChallenge(input: {
    id: string;
    orgId: string;
    userId: string;
    consumedAt: string;
  }): Promise<E.LocalMfaChallenge | undefined> {
    const challenge = this.data.localMfaChallenges.find(
      (item) => item.id === input.id,
    );
    if (
      challenge === undefined ||
      challenge.consumedAt !== undefined ||
      challenge.orgId !== input.orgId ||
      challenge.userId !== input.userId ||
      Date.parse(challenge.expiresAt) <= Date.parse(input.consumedAt)
    )
      return undefined;
    return replaceById(this.data.localMfaChallenges, {
      ...challenge,
      consumedAt: input.consumedAt,
    });
  }

  async claimLocalMfaChallengeAttempt(input: {
    id: string;
    orgId: string;
    userId: string;
    attemptedAt: string;
    maxAttempts: number;
  }): Promise<E.LocalMfaChallenge | undefined> {
    const challenge = this.data.localMfaChallenges.find(
      (item) => item.id === input.id,
    );
    const attemptCount = challenge?.attemptCount ?? 0;
    if (
      challenge === undefined ||
      challenge.consumedAt !== undefined ||
      challenge.orgId !== input.orgId ||
      challenge.userId !== input.userId ||
      Date.parse(challenge.expiresAt) <= Date.parse(input.attemptedAt) ||
      attemptCount >= input.maxAttempts
    )
      return undefined;
    return replaceById(this.data.localMfaChallenges, {
      ...challenge,
      attemptCount: attemptCount + 1,
    });
  }

  async createSamlAuthRequest(
    request: E.SamlAuthRequest,
  ): Promise<E.SamlAuthRequest> {
    const existing = this.data.samlAuthRequests.find(
      (item) => item.id === request.id,
    );
    return existing ?? append(this.data.samlAuthRequests, request);
  }

  async consumeSamlAuthRequest(input: {
    id: string;
    orgId: string;
    providerId: "saml";
    relayStateHash: string;
    consumedAt: string;
  }): Promise<E.SamlAuthRequest | undefined> {
    const request = this.data.samlAuthRequests.find(
      (item) => item.id === input.id,
    );
    if (
      request === undefined ||
      request.consumedAt !== undefined ||
      request.orgId !== input.orgId ||
      request.providerId !== input.providerId ||
      request.relayStateHash !== input.relayStateHash ||
      Date.parse(request.expiresAt) <= Date.parse(input.consumedAt)
    )
      return undefined;
    return replaceById(this.data.samlAuthRequests, {
      ...request,
      consumedAt: input.consumedAt,
    });
  }

  async listServiceAccounts(orgId: string): Promise<E.ServiceAccount[]> {
    return this.data.serviceAccounts
      .filter((account) => account.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getServiceAccount(
    serviceAccountId: string,
  ): Promise<E.ServiceAccount | undefined> {
    return this.data.serviceAccounts.find(
      (account) => account.id === serviceAccountId,
    );
  }

  async createServiceAccount(
    serviceAccount: E.ServiceAccount,
  ): Promise<E.ServiceAccount> {
    return append(this.data.serviceAccounts, serviceAccount);
  }

  async updateServiceAccount(
    serviceAccount: E.ServiceAccount,
  ): Promise<E.ServiceAccount> {
    return replaceById(this.data.serviceAccounts, serviceAccount);
  }
}
