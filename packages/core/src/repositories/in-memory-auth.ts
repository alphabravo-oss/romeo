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
    return replaceById(this.data.localPasswordCredentials, credential);
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
    return replaceById(this.data.localMfaFactors, factor);
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
