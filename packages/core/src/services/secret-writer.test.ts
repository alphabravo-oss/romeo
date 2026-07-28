import { describe, expect, it } from "vitest";

import { VaultSecretWriter } from "./secret-writer";

describe("VaultSecretWriter", () => {
  it("writes values to Vault KV-v2 without putting raw values in URL or headers", async () => {
    const calls: Array<{ path: string; value: string }> = [];
    const clientOptions: unknown[] = [];
    const writer = new VaultSecretWriter({
      address: "https://vault.example.com",
      token: "vault-token",
      namespace: "admin",
      kvMount: "kv",
      clientFactory: (options) => {
        clientOptions.push(options);
        return {
          async checkSecret() {},
          async getSecretValue() {
            return undefined;
          },
          async writeSecret(path, value) {
            calls.push({ path, value });
          },
        };
      },
    });

    const result = await writer.write({
      secretRef: "vault://auth/okta/client-secret",
      value: "OKTA-CLIENT-SECRET",
    });

    expect(result).toEqual({
      scheme: "vault",
      secretRef: "vault://auth/okta/client-secret",
      stored: true,
    });
    expect(calls).toEqual([
      { path: "auth/okta/client-secret", value: "OKTA-CLIENT-SECRET" },
    ]);
    expect(clientOptions).toEqual([
      {
        address: "https://vault.example.com",
        kvMount: "kv",
        namespace: "admin",
        token: "vault-token",
      },
    ]);
  });

  it("rejects unsafe Vault paths before fetch", async () => {
    let called = false;
    const writer = new VaultSecretWriter({
      address: "https://vault.example.com",
      token: "vault-token",
      fetchImpl: async () => {
        called = true;
        return Response.json({});
      },
    });

    await expect(
      writer.write({
        secretRef: "vault://../okta",
        value: "secret",
      }),
    ).resolves.toMatchObject({
      failureCode: "invalid_secret_ref",
      scheme: "vault",
      stored: false,
    });
    expect(called).toBe(false);
  });
});
