import { describe, expect, it } from "vitest";

import {
  AwsSecretValueResolver,
  AzureSecretValueResolver,
  GcpSecretValueResolver,
} from "./cloud-secret-resolver";
import {
  createSecretValueResolver,
  EnvironmentSecretValueResolver,
} from "./secret-resolver";
import { VaultSecretValueResolver } from "./vault-secret-resolver";

describe("secret value resolvers", () => {
  it("resolves env refs from an explicit variable map", async () => {
    const resolver = new EnvironmentSecretValueResolver({
      TOOL_AUTH_TOKEN: "env-secret",
    });

    await expect(
      resolver.resolveValue("env://TOOL_AUTH_TOKEN"),
    ).resolves.toEqual({
      available: true,
      scheme: "env",
      value: "env-secret",
    });
  });

  it("resolves Vault KV v2 refs without exposing the Vault token in results", async () => {
    const calls: Array<{ headers: Headers; url: string }> = [];
    const resolver = new VaultSecretValueResolver({
      address: "https://vault.example.com",
      token: "vault-token",
      namespace: "platform",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response(
          JSON.stringify({ data: { data: { value: "vault-secret" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await resolver.resolveValue("vault://tools/api-key");

    expect(result).toEqual({
      available: true,
      scheme: "vault",
      value: "vault-secret",
    });
    expect(calls[0]?.url).toBe(
      "https://vault.example.com/v1/secret/data/tools/api-key",
    );
    expect(calls[0]?.headers.get("x-vault-token")).toBe("vault-token");
    expect(calls[0]?.headers.get("x-vault-namespace")).toBe("platform");
    expect(JSON.stringify(result)).not.toContain("vault-token");
  });

  it("resolves AWS Secrets Manager refs through the official SDK boundary", async () => {
    const calls: string[] = [];
    const resolver = new AwsSecretValueResolver({
      accessKeyId: "AKIATEST",
      secretAccessKey: "aws-secret-access-key",
      region: "us-east-1",
      clientFactory: () => ({
        async describeSecret() {},
        async getSecretValue(secretId) {
          calls.push(secretId);
          return "aws-secret";
        },
      }),
    });

    const result = await resolver.resolveValue("aws-sm://prod/tools/api-key");

    expect(result).toEqual({
      available: true,
      scheme: "aws-sm",
      value: "aws-secret",
    });
    expect(calls).toEqual(["prod/tools/api-key"]);
    expect(JSON.stringify(calls)).not.toContain("aws-secret-access-key");
  });

  it("resolves GCP Secret Manager refs through the official SDK boundary", async () => {
    const calls: string[] = [];
    const resolver = new GcpSecretValueResolver({
      accessToken: "gcp-access-token",
      projectId: "romeo-prod",
      clientFactory: () => ({
        async checkSecret() {},
        async accessSecretValue(secretVersionName) {
          calls.push(secretVersionName);
          return "gcp-secret";
        },
      }),
    });

    const result = await resolver.resolveValue("gcp-sm://tool-api-key");

    expect(result).toEqual({
      available: true,
      scheme: "gcp-sm",
      value: "gcp-secret",
    });
    expect(calls).toEqual([
      "projects/romeo-prod/secrets/tool-api-key/versions/latest",
    ]);
  });

  it("resolves Azure Key Vault refs through the official SDK boundary", async () => {
    const calls: string[] = [];
    const resolver = new AzureSecretValueResolver({
      accessToken: "azure-access-token",
      vaultUrl: "https://romeo.vault.azure.net",
      clientFactory: () => ({
        async checkSecret() {},
        async getSecretValue(secretName) {
          calls.push(secretName);
          return "azure-secret";
        },
      }),
    });

    const result = await resolver.resolveValue("azure-kv://tool-api-key");

    expect(result).toEqual({
      available: true,
      scheme: "azure-kv",
      value: "azure-secret",
    });
    expect(calls).toEqual(["tool-api-key"]);
  });

  it("routes cloud refs through the selected cloud provider resolver", async () => {
    const resolver = createSecretValueResolver("cloud", {
      env: {
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "aws-secret-access-key",
        AWS_REGION: "us-east-1",
        GCP_ACCESS_TOKEN: "gcp-access-token",
        GCP_SECRET_MANAGER_PROJECT: "romeo-prod",
        AZURE_ACCESS_TOKEN: "azure-access-token",
        AZURE_KEY_VAULT_URL: "https://romeo.vault.azure.net",
      },
      awsClientFactory: () => ({
        async describeSecret() {},
        async getSecretValue() {
          return "aws-secret";
        },
      }),
      azureClientFactory: () => ({
        async checkSecret() {},
        async getSecretValue() {
          return "azure-secret";
        },
      }),
      gcpClientFactory: () => ({
        async checkSecret() {},
        async accessSecretValue() {
          return "gcp-secret";
        },
      }),
    });

    await expect(
      resolver.resolveValue("aws-sm://tools/aws"),
    ).resolves.toMatchObject({
      available: true,
      value: "aws-secret",
    });
    await expect(
      resolver.resolveValue("gcp-sm://tool-gcp"),
    ).resolves.toMatchObject({
      available: true,
      value: "gcp-secret",
    });
    await expect(
      resolver.resolveValue("azure-kv://tool-azure"),
    ).resolves.toMatchObject({
      available: true,
      value: "azure-secret",
    });
    await expect(
      resolver.resolveValue("vault://tools/api-key"),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_scheme_unsupported",
      scheme: "vault",
    });
  });

  it("returns stable failure codes for misconfigured managed resolvers", async () => {
    const resolver = createSecretValueResolver("vault", { env: {} });

    await expect(
      resolver.resolveValue("vault://tools/api-key"),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_resolver_misconfigured",
      scheme: "vault",
    });
  });
});
