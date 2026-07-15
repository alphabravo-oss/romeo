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

  it("resolves AWS Secrets Manager refs with SigV4 request metadata", async () => {
    const calls: Array<{ body: string; headers: Headers; url: string }> = [];
    const resolver = new AwsSecretValueResolver({
      accessKeyId: "AKIATEST",
      secretAccessKey: "aws-secret-access-key",
      region: "us-east-1",
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          body: String(init?.body),
          headers: new Headers(init?.headers),
        });
        return new Response(JSON.stringify({ SecretString: "aws-secret" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await resolver.resolveValue("aws-sm://prod/tools/api-key");

    expect(result).toEqual({
      available: true,
      scheme: "aws-sm",
      value: "aws-secret",
    });
    expect(calls[0]?.url).toBe(
      "https://secretsmanager.us-east-1.amazonaws.com/",
    );
    expect(calls[0]?.body).toBe('{"SecretId":"prod/tools/api-key"}');
    expect(calls[0]?.headers.get("x-amz-date")).toBe("20260102T030405Z");
    expect(calls[0]?.headers.get("x-amz-target")).toBe(
      "secretsmanager.GetSecretValue",
    );
    expect(calls[0]?.headers.get("authorization")).toContain(
      "Credential=AKIATEST/20260102/us-east-1/secretsmanager/aws4_request",
    );
    expect(JSON.stringify(calls)).not.toContain("aws-secret-access-key");
  });

  it("resolves GCP Secret Manager refs from base64 payload data", async () => {
    const calls: Array<{ headers: Headers; url: string }> = [];
    const resolver = new GcpSecretValueResolver({
      accessToken: "gcp-access-token",
      projectId: "romeo-prod",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response(
          JSON.stringify({
            payload: {
              data: Buffer.from("gcp-secret", "utf8").toString("base64"),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await resolver.resolveValue("gcp-sm://tool-api-key");

    expect(result).toEqual({
      available: true,
      scheme: "gcp-sm",
      value: "gcp-secret",
    });
    expect(calls[0]?.url).toBe(
      "https://secretmanager.googleapis.com/v1/projects/romeo-prod/secrets/tool-api-key/versions/latest:access",
    );
    expect(calls[0]?.headers.get("authorization")).toBe(
      "Bearer gcp-access-token",
    );
  });

  it("resolves Azure Key Vault refs from value payloads", async () => {
    const calls: Array<{ headers: Headers; url: string }> = [];
    const resolver = new AzureSecretValueResolver({
      accessToken: "azure-access-token",
      vaultUrl: "https://romeo.vault.azure.net",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ value: "azure-secret" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await resolver.resolveValue("azure-kv://tool-api-key");

    expect(result).toEqual({
      available: true,
      scheme: "azure-kv",
      value: "azure-secret",
    });
    expect(calls[0]?.url).toBe(
      "https://romeo.vault.azure.net/secrets/tool-api-key?api-version=7.5",
    );
    expect(calls[0]?.headers.get("authorization")).toBe(
      "Bearer azure-access-token",
    );
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
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("secretsmanager")) {
          return new Response(JSON.stringify({ SecretString: "aws-secret" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("secretmanager.googleapis.com")) {
          return new Response(
            JSON.stringify({
              payload: {
                data: Buffer.from("gcp-secret", "utf8").toString("base64"),
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ value: "azure-secret" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
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
