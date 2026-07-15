import { scrypt as scryptCallback } from "node:crypto";

import { readEnv } from "@romeo/config";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import {
  hashLocalPassword,
  localPasswordNeedsRehash,
  verifyLocalPassword,
} from "./services/local-password";

describe("local password hashing", () => {
  it("stores new local password hashes as Argon2id PHC strings", async () => {
    const encodedHash = await hashLocalPassword("new-local-password-123");

    expect(encodedHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    expect(localPasswordNeedsRehash(encodedHash)).toBe(false);
    await expect(
      verifyLocalPassword("new-local-password-123", encodedHash),
    ).resolves.toBe(true);
    await expect(
      verifyLocalPassword("wrong-local-password", encodedHash),
    ).resolves.toBe(false);
  });

  it("verifies legacy scrypt hashes and marks them for rehash", async () => {
    const encodedHash = await legacyScryptHash("legacy-local-password-123");

    expect(localPasswordNeedsRehash(encodedHash)).toBe(true);
    await expect(
      verifyLocalPassword("legacy-local-password-123", encodedHash),
    ).resolves.toBe(true);
    await expect(
      verifyLocalPassword("wrong-local-password", encodedHash),
    ).resolves.toBe(false);
  });

  it("rehashes legacy scrypt credentials after successful local login", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createUser({
      id: "user_legacy_password",
      orgId: "org_default",
      email: "legacy-password@romeo.local",
      name: "Legacy Password User",
      role: "user",
    });
    await repository.createLocalPasswordCredential({
      id: "local_password_legacy",
      orgId: "org_default",
      userId: "user_legacy_password",
      emailNormalized: "legacy-password@romeo.local",
      passwordHash: await legacyScryptHash("legacy-local-password-123"),
      failedAttemptCount: 0,
      passwordUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const api = createRomeoApi(repository, {
      env: readEnv({
        DEV_SEEDED_LOGIN: "false",
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "prod-local-auth-key-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
      }),
    });

    const loginResponse = await api.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({
        email: "legacy-password@romeo.local",
        password: "legacy-local-password-123",
      }),
    });
    const upgraded = await repository.getLocalPasswordCredentialByEmail(
      "org_default",
      "legacy-password@romeo.local",
    );

    expect(loginResponse.status).toBe(200);
    expect(upgraded?.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u,
    );
    expect(localPasswordNeedsRehash(upgraded?.passwordHash ?? "")).toBe(false);
    await expect(
      verifyLocalPassword(
        "legacy-local-password-123",
        upgraded?.passwordHash ?? "",
      ),
    ).resolves.toBe(true);
  });
});

function legacyScryptHash(password: string): Promise<string> {
  const salt = Buffer.from("romeo-legacy-scrypt-salt");
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(
          `scrypt$v=1$N=16384$r=8$p=1$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`,
        );
      },
    );
  });
}
