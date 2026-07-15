import { describe, expect, it } from "vitest";

import {
  toApiKeyRecord,
  toDeviceAuthorizationRecord,
  toLocalMfaFactorRecord,
  toLocalPasswordCredentialRecord,
  toServiceAccountRecord,
  toUserSessionRecord,
} from "./auth-credential-repository";

describe("auth credential repository mappers", () => {
  it("maps api keys with owner fields and filters unknown scopes", () => {
    const apiKey = toApiKeyRecord({
      id: "api_key_1",
      orgId: "org_1",
      userId: "user_1",
      serviceAccountId: null,
      name: "Local key",
      hashedToken: "hash_secret",
      scopes: ["me:read", "invalid:scope", "runs:read"],
      revokedAt: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(apiKey).toEqual({
      id: "api_key_1",
      orgId: "org_1",
      userId: "user_1",
      name: "Local key",
      hashedToken: "hash_secret",
      scopes: ["me:read", "runs:read"],
      createdAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("maps service accounts and disabled state", () => {
    const serviceAccount = toServiceAccountRecord({
      id: "service_account_1",
      orgId: "org_1",
      name: "Worker",
      scopes: ["runs:create", "tools:use"],
      createdBy: "user_1",
      disabledAt: new Date("2026-06-28T00:00:00.000Z"),
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(serviceAccount.disabledAt).toBe("2026-06-28T00:00:00.000Z");
    expect(serviceAccount.scopes).toEqual(["runs:create", "tools:use"]);
  });

  it("maps user sessions without exposing raw tokens", () => {
    const session = toUserSessionRecord({
      id: "session_1",
      orgId: "org_1",
      userId: "user_1",
      name: "Browser",
      hashedToken: "hash_session",
      scopes: ["me:read", "admin:read"],
      isAdmin: true,
      expiresAt: new Date("2026-06-28T00:00:00.000Z"),
      revokedAt: null,
      lastSeenAt: new Date("2026-06-27T00:05:00.000Z"),
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(session).toMatchObject({
      id: "session_1",
      hashedToken: "hash_session",
      lastSeenAt: "2026-06-27T00:05:00.000Z",
    });
    expect(JSON.stringify(session)).not.toContain("rms_");
  });

  it("maps device authorizations with refresh hash metadata only", () => {
    const authorization = toDeviceAuthorizationRecord({
      id: "device_auth_1",
      orgId: "org_1",
      userId: "user_1",
      name: "CLI",
      scopes: ["me:read", "runs:create"],
      hashedRefreshToken: "hash_refresh",
      accessApiKeyId: "api_key_1",
      expiresAt: new Date("2026-07-27T00:00:00.000Z"),
      revokedAt: null,
      lastRefreshedAt: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(authorization).toEqual({
      id: "device_auth_1",
      orgId: "org_1",
      userId: "user_1",
      name: "CLI",
      scopes: ["me:read", "runs:create"],
      hashedRefreshToken: "hash_refresh",
      accessApiKeyId: "api_key_1",
      expiresAt: "2026-07-27T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("maps local password credentials with lockout and password timestamps", () => {
    const credential = toLocalPasswordCredentialRecord({
      id: "local_password_1",
      orgId: "org_1",
      userId: "user_1",
      emailNormalized: "user@example.com",
      passwordHash: "scrypt$v=1$hash",
      failedAttemptCount: 3,
      lockedUntil: new Date("2026-06-27T00:10:00.000Z"),
      passwordUpdatedAt: new Date("2026-06-27T00:01:00.000Z"),
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:02:00.000Z"),
    });

    expect(credential).toEqual({
      id: "local_password_1",
      orgId: "org_1",
      userId: "user_1",
      emailNormalized: "user@example.com",
      passwordHash: "scrypt$v=1$hash",
      failedAttemptCount: 3,
      lockedUntil: "2026-06-27T00:10:00.000Z",
      passwordUpdatedAt: "2026-06-27T00:01:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:02:00.000Z",
    });
  });

  it("maps local MFA factors without exposing decrypted secrets", () => {
    const factor = toLocalMfaFactorRecord({
      id: "mfa_factor_1",
      orgId: "org_1",
      userId: "user_1",
      type: "totp",
      name: "Authenticator",
      status: "active",
      secretEncrypted: "{\"v\":1}",
      confirmedAt: new Date("2026-06-27T00:01:00.000Z"),
      disabledAt: null,
      lastUsedAt: new Date("2026-06-27T00:02:00.000Z"),
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:03:00.000Z"),
    });

    expect(factor).toEqual({
      id: "mfa_factor_1",
      orgId: "org_1",
      userId: "user_1",
      type: "totp",
      name: "Authenticator",
      status: "active",
      secretEncrypted: "{\"v\":1}",
      confirmedAt: "2026-06-27T00:01:00.000Z",
      lastUsedAt: "2026-06-27T00:02:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:03:00.000Z",
    });
  });
});
