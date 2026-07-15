import {
  AuthorizationError,
  assertScope,
  createApiKeyToken,
  createRefreshToken,
  hashApiKey,
  type AuthSubject,
  type Scope,
} from "@romeo/auth";

import type { DeviceAuthorization } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";

export type DeviceAuthorizationSummary = Omit<
  DeviceAuthorization,
  "hashedRefreshToken"
>;

export interface CreatedDeviceAuthorization {
  authorization: DeviceAuthorizationSummary;
  accessToken: string;
  refreshToken: string;
}

export class DeviceAuthorizationService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<DeviceAuthorizationSummary[]> {
    assertScope(subject, "me:read");
    if (subject.type !== "user")
      throw new AuthorizationError(
        "Device authorizations are only available for user subjects.",
      );
    const authorizations = await this.repository.listDeviceAuthorizations(
      subject.orgId,
      subject.id,
    );
    return authorizations.map(toSummary);
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    scopes: Scope[];
    ttlDays?: number;
  }): Promise<CreatedDeviceAuthorization> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user")
      throw new AuthorizationError(
        "Device authorizations are only available for user subjects.",
      );
    const scopes = normalizeScopes(input.scopes);
    this.assertScopesAllowed(input.subject, scopes);

    const now = new Date();
    const accessToken = createApiKeyToken();
    const refreshToken = createRefreshToken();
    const accessTokenHash = await hashApiKey(accessToken);
    const refreshTokenHash = await hashApiKey(refreshToken);
    const authorization = await this.repository.transaction(
      async (repository) => {
        const apiKey = await repository.createApiKey({
          id: createId("api_key"),
          orgId: input.subject.orgId,
          userId: input.subject.id,
          name: `Device: ${input.name}`,
          hashedToken: accessTokenHash,
          scopes,
          createdAt: now.toISOString(),
        });
        const authorization = await repository.createDeviceAuthorization({
          id: createId("device_auth"),
          orgId: input.subject.orgId,
          userId: input.subject.id,
          name: input.name,
          scopes,
          hashedRefreshToken: refreshTokenHash,
          accessApiKeyId: apiKey.id,
          expiresAt: addDays(now, input.ttlDays ?? 90).toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await this.audit(
          repository,
          input.subject,
          "device_authorization.create",
          authorization.id,
          { scopeCount: scopes.length },
        );
        return authorization;
      },
    );
    return {
      authorization: toSummary(authorization),
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<CreatedDeviceAuthorization> {
    const now = new Date();
    const refreshTokenHash = await hashApiKey(refreshToken);
    const accessToken = createApiKeyToken();
    const refreshTokenNext = createRefreshToken();
    const accessTokenHash = await hashApiKey(accessToken);
    const refreshTokenNextHash = await hashApiKey(refreshTokenNext);
    const refreshed = await this.repository.transaction(async (repository) => {
      const authorization =
        await repository.getDeviceAuthorizationByRefreshHash(refreshTokenHash);
      if (!authorization || authorization.revokedAt !== undefined) {
        throw new AuthorizationError(
          "Device refresh token is invalid or revoked.",
        );
      }
      if (new Date(authorization.expiresAt).getTime() <= Date.now()) {
        throw new AuthorizationError("Device refresh token is expired.");
      }

      const user = await repository.getCurrentUser(authorization.userId);
      if (!user || user.orgId !== authorization.orgId)
        throw new AuthorizationError(
          "Device authorization owner was not found.",
        );

      const previousApiKey = await repository.getApiKey(
        authorization.accessApiKeyId,
      );
      if (
        previousApiKey !== undefined &&
        previousApiKey.revokedAt === undefined
      ) {
        await repository.updateApiKey({
          ...previousApiKey,
          revokedAt: now.toISOString(),
        });
      }

      const apiKey = await repository.createApiKey({
        id: createId("api_key"),
        orgId: authorization.orgId,
        userId: authorization.userId,
        name: `Device: ${authorization.name}`,
        hashedToken: accessTokenHash,
        scopes: authorization.scopes,
        createdAt: now.toISOString(),
      });
      const refreshed = await repository.updateDeviceAuthorization({
        ...authorization,
        hashedRefreshToken: refreshTokenNextHash,
        accessApiKeyId: apiKey.id,
        lastRefreshedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      await this.audit(
        repository,
        systemSubjectFor(user, authorization.scopes),
        "device_authorization.refresh",
        refreshed.id,
        { scopeCount: refreshed.scopes.length },
      );
      return refreshed;
    });
    return {
      authorization: toSummary(refreshed),
      accessToken,
      refreshToken: refreshTokenNext,
    };
  }

  async revoke(input: {
    subject: AuthSubject;
    deviceAuthorizationId: string;
  }): Promise<DeviceAuthorizationSummary> {
    assertScope(input.subject, "me:read");
    const authorization = await this.repository.getDeviceAuthorization(
      input.deviceAuthorizationId,
    );
    if (!authorization || authorization.orgId !== input.subject.orgId)
      throw notFound("Device authorization");
    if (
      input.subject.isAdmin !== true &&
      input.subject.id !== authorization.userId
    ) {
      throw new AuthorizationError(
        "Cannot revoke a device authorization for another user.",
      );
    }
    const now = new Date().toISOString();
    const revoked = await this.repository.transaction(async (repository) => {
      const revoked = await repository.updateDeviceAuthorization({
        ...authorization,
        revokedAt: now,
        updatedAt: now,
      });
      const apiKey = await repository.getApiKey(authorization.accessApiKeyId);
      if (apiKey !== undefined && apiKey.revokedAt === undefined) {
        await repository.updateApiKey({ ...apiKey, revokedAt: now });
      }
      await this.audit(
        repository,
        input.subject,
        "device_authorization.revoke",
        authorization.id,
        {},
      );
      return revoked;
    });
    return toSummary(revoked);
  }

  private assertScopesAllowed(subject: AuthSubject, scopes: Scope[]): void {
    if (scopes.length === 0)
      throw new ApiError(
        "invalid_device_authorization",
        "Device authorization requires at least one scope.",
        400,
      );
    if (subject.isAdmin === true) return;
    const disallowed = scopes.filter(
      (scope) => !subject.scopes.includes(scope),
    );
    if (disallowed.length > 0) {
      throw new ApiError(
        "device_authorization_scope_exceeded",
        "Requested device scopes exceed the current subject scopes.",
        400,
        { scopes: disallowed },
      );
    }
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: subject.id,
      action,
      resourceType: "device_authorization",
      resourceId,
      outcome: "success",
      metadata,
      createdAt: new Date().toISOString(),
    });
  }
}

function normalizeScopes(scopes: Scope[]): Scope[] {
  return [...new Set(scopes)];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function systemSubjectFor(
  user: { id: string; orgId: string },
  scopes: Scope[],
): AuthSubject {
  return {
    id: user.id,
    type: "user",
    orgId: user.orgId,
    workspaceIds: [],
    groupIds: [],
    scopes,
    isAdmin: false,
  };
}

function toSummary(
  authorization: DeviceAuthorization,
): DeviceAuthorizationSummary {
  const { hashedRefreshToken: _hashedRefreshToken, ...summary } = authorization;
  return summary;
}
