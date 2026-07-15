import { describe, expect, it } from "vitest";

import { VaultSecretWriter } from "./secret-writer";

describe("VaultSecretWriter", () => {
  it("writes values to Vault KV-v2 without putting raw values in URL or headers", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const writer = new VaultSecretWriter({
      address: "https://vault.example.com",
      token: "vault-token",
      namespace: "admin",
      kvMount: "kv",
      fetchImpl: async (input, init) => {
        calls.push(
          init === undefined
            ? { url: String(input) }
            : { url: String(input), init },
        );
        return Response.json({ data: { version: 1 } });
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
    expect(calls[0]?.url).toBe(
      "https://vault.example.com/v1/kv/data/auth/okta/client-secret",
    );
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-vault-namespace": "admin",
      "x-vault-token": "vault-token",
    });
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ data: { value: "OKTA-CLIENT-SECRET" } }),
    );
    expect(calls[0]?.url).not.toContain("OKTA-CLIENT-SECRET");
    expect(JSON.stringify(calls[0]?.init?.headers)).not.toContain(
      "OKTA-CLIENT-SECRET",
    );
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
