import { describe, expect, it } from "vitest";

import {
  AwsSecretsManagerResolver,
  AzureKeyVaultResolver,
  CloudSecretResolver,
  GcpSecretManagerResolver,
  VaultSecretResolver,
  VaultSecretWriter,
} from "./index";

describe("managed secret SDK adapters", () => {
  it("routes AWS checks and value reads through one typed SDK boundary", async () => {
    const calls: string[] = [];
    const resolver = new AwsSecretsManagerResolver({
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      sessionToken: "session-token",
      region: "us-east-1",
      clientFactory: (options) => {
        expect(options).toEqual({
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
          sessionToken: "session-token",
          region: "us-east-1",
        });
        return {
          async describeSecret(secretId) {
            calls.push(`describe:${secretId}`);
          },
          async getSecretValue(secretId) {
            calls.push(`get:${secretId}`);
            return "resolved-value";
          },
        };
      },
    });

    await expect(resolver.check("aws-sm://tools/api-key")).resolves.toEqual({
      available: true,
      scheme: "aws-sm",
    });
    await expect(
      resolver.resolveValue("aws-sm://tools/api-key"),
    ).resolves.toEqual({
      available: true,
      scheme: "aws-sm",
      value: "resolved-value",
    });
    expect(calls).toEqual(["describe:tools/api-key", "get:tools/api-key"]);
  });

  it("maps official SDK status and error names to redacted stable failures", async () => {
    const resolver = new AwsSecretsManagerResolver({
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "us-east-1",
      clientFactory: () => ({
        async describeSecret() {
          const error = new Error("not found");
          error.name = "ResourceNotFoundException";
          Object.assign(error, { $metadata: { httpStatusCode: 400 } });
          throw error;
        },
        async getSecretValue() {
          return undefined;
        },
      }),
    });

    await expect(resolver.check("aws-sm://missing")).resolves.toEqual({
      available: false,
      failureCode: "secret_not_found",
      scheme: "aws-sm",
    });
  });

  it("uses the Azure SDK boundary for metadata-only checks and value reads", async () => {
    const calls: string[] = [];
    const resolver = new AzureKeyVaultResolver({
      accessToken: "access-token",
      vaultUrl: "https://romeo.vault.azure.net",
      clientFactory: (options) => {
        expect(options).toEqual({
          accessToken: "access-token",
          vaultUrl: "https://romeo.vault.azure.net",
        });
        return {
          async checkSecret(secretName) {
            calls.push(`check:${secretName}`);
          },
          async getSecretValue(secretName) {
            calls.push(`get:${secretName}`);
            return "azure-value";
          },
        };
      },
    });

    await expect(resolver.check("azure-kv://service-token")).resolves.toEqual({
      available: true,
      scheme: "azure-kv",
    });
    await expect(
      resolver.resolveValue("azure-kv://service-token"),
    ).resolves.toEqual({
      available: true,
      scheme: "azure-kv",
      value: "azure-value",
    });
    expect(calls).toEqual(["check:service-token", "get:service-token"]);
  });

  it("uses the GCP SDK boundary and keeps scheme routing strict", async () => {
    const cloud = new CloudSecretResolver({
      aws: new AwsSecretsManagerResolver({
        accessKeyId: "",
        secretAccessKey: "",
        region: "",
      }),
      azure: new AzureKeyVaultResolver({ accessToken: "", vaultUrl: "" }),
      gcp: new GcpSecretManagerResolver({
        accessToken: "token",
        projectId: "romeo-prod1",
        clientFactory: () => ({
          async checkSecret() {},
          async accessSecretValue() {
            return "gcp-value";
          },
        }),
      }),
    });

    await expect(cloud.resolveValue("gcp-sm://service-token")).resolves.toEqual(
      {
        available: true,
        scheme: "gcp-sm",
        value: "gcp-value",
      },
    );
    await expect(cloud.check("vault://service-token")).resolves.toEqual({
      available: false,
      failureCode: "secret_scheme_unsupported",
      scheme: "vault",
    });
  });

  it("delegates Vault KV-v2 request construction and parsing to the typed SDK", async () => {
    const calls: Array<{
      body?: string;
      headers: Headers;
      method?: string;
      url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        headers: new Headers(init?.headers),
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (url.includes("/metadata/")) {
        return Response.json({ data: { current_version: 1 } });
      }
      if (init?.method === "GET") {
        return Response.json({ data: { data: { value: "vault-value" } } });
      }
      return Response.json({ data: { version: 2 } });
    };
    const options = {
      address: "https://vault.example.com",
      token: "vault-token",
      namespace: "platform",
      kvMount: "kv",
      fetchImpl,
    };
    const resolver = new VaultSecretResolver(options);
    const writer = new VaultSecretWriter(options);

    await expect(resolver.check("vault://tools/api-key")).resolves.toEqual({
      available: true,
      scheme: "vault",
    });
    await expect(
      resolver.resolveValue("vault://tools/api-key"),
    ).resolves.toEqual({
      available: true,
      scheme: "vault",
      value: "vault-value",
    });
    await expect(
      writer.write({
        secretRef: "vault://tools/api-key",
        value: "updated-value",
      }),
    ).resolves.toEqual({
      scheme: "vault",
      secretRef: "vault://tools/api-key",
      stored: true,
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://vault.example.com/v1/kv/metadata/tools/api-key",
      "https://vault.example.com/v1/kv/data/tools/api-key",
      "https://vault.example.com/v1/kv/data/tools/api-key",
    ]);
    expect(calls[0]?.headers.get("x-vault-token")).toBe("vault-token");
    expect(calls[0]?.headers.get("x-vault-namespace")).toBe("platform");
    expect(calls[2]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ data: { value: "updated-value" } }),
    });
  });
});
