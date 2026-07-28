import { describe, expect, it } from "vitest";

import {
  AwsSecretsManagerResolver,
  AzureKeyVaultResolver,
  CloudSecretResolver,
  GcpSecretManagerResolver,
} from "./cloud-secret-resolver";
import { parseManagedSecretRef } from "./secret-refs";
import {
  EnvironmentSecretResolver,
  VaultSecretResolver,
} from "./secret-resolver";

describe("secret references and resolvers", () => {
  it("accepts bounded environment references without exposing values", async () => {
    const parsed = parseManagedSecretRef("env://ROMEO_TOOL_API_KEY");
    const resolver = new EnvironmentSecretResolver({
      ROMEO_TOOL_API_KEY: "secret-value",
    });

    const check = await resolver.check("env://ROMEO_TOOL_API_KEY");

    expect(parsed).toEqual({ scheme: "env", path: "ROMEO_TOOL_API_KEY" });
    expect(check).toEqual({ available: true, scheme: "env" });
    expect(JSON.stringify(check)).not.toContain("secret-value");
  });

  it("reports missing and empty environment references with stable failure codes", async () => {
    const resolver = new EnvironmentSecretResolver({ EMPTY_SECRET: "" });

    await expect(resolver.check("env://MISSING_SECRET")).resolves.toEqual({
      available: false,
      failureCode: "secret_not_found",
      scheme: "env",
    });
    await expect(resolver.check("env://EMPTY_SECRET")).resolves.toEqual({
      available: false,
      failureCode: "secret_empty",
      scheme: "env",
    });
  });

  it("rejects invalid environment secret reference shapes", () => {
    expect(() =>
      parseManagedSecretRef("env://ROMEO_TOOL_API_KEY/extra"),
    ).toThrow("Secret reference must use a managed secret URI scheme.");
    expect(() => parseManagedSecretRef("env://1_INVALID")).toThrow(
      "Secret reference must use a managed secret URI scheme.",
    );
  });

  it("does not claim unsupported managed providers are available", async () => {
    const resolver = new EnvironmentSecretResolver({
      ROMEO_TOOL_API_KEY: "secret-value",
    });

    await expect(resolver.check("vault://tools/api-key")).resolves.toEqual({
      available: false,
      failureCode: "secret_scheme_unsupported",
      scheme: "vault",
    });
  });

  it("checks Vault KV metadata without exposing token values", async () => {
    const calls: string[] = [];
    const clientOptions: unknown[] = [];
    const resolver = new VaultSecretResolver({
      address: "https://vault.example.com",
      token: "vault-token-value",
      namespace: "admin",
      kvMount: "kv",
      clientFactory: (options) => {
        clientOptions.push(options);
        return {
          async checkSecret(path) {
            calls.push(path);
          },
          async getSecretValue() {
            return undefined;
          },
          async writeSecret() {},
        };
      },
    });

    const check = await resolver.check("vault://tools/issue-tracker/api-key");

    expect(check).toEqual({ available: true, scheme: "vault" });
    expect(calls).toEqual(["tools/issue-tracker/api-key"]);
    expect(clientOptions).toEqual([
      {
        address: "https://vault.example.com",
        kvMount: "kv",
        namespace: "admin",
        token: "vault-token-value",
      },
    ]);
    expect(JSON.stringify(check)).not.toContain("vault-token-value");
  });

  it("resolves Vault KV-v2 values for execution-only secret use", async () => {
    const calls: string[] = [];
    const resolver = new VaultSecretResolver({
      address: "https://vault.example.com",
      token: "vault-token-value",
      kvMount: "kv",
      clientFactory: () => ({
        async checkSecret() {},
        async getSecretValue(path) {
          calls.push(path);
          return JSON.stringify({
            accessKeyId: "vault-key",
            secretAccessKey: "vault-secret",
          });
        },
        async writeSecret() {},
      }),
    });

    const resolution = await resolver.resolveValue(
      "vault://connectors/s3/credentials",
    );

    expect(resolution.available).toBe(true);
    expect(JSON.parse(resolution.value ?? "{}")).toEqual({
      accessKeyId: "vault-key",
      secretAccessKey: "vault-secret",
    });
    expect(calls).toEqual(["connectors/s3/credentials"]);
  });

  it("maps Vault metadata failures to stable failure codes", async () => {
    const resolverForStatus = (status: number) =>
      new VaultSecretResolver({
        address: "https://vault.example.com",
        token: "vault-token-value",
        clientFactory: () => ({
          async checkSecret() {
            throw { statusCode: status };
          },
          async getSecretValue() {
            return undefined;
          },
          async writeSecret() {},
        }),
      });

    await expect(
      resolverForStatus(404).check("vault://tools/api-key"),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_not_found",
      scheme: "vault",
    });
    await expect(
      resolverForStatus(403).check("vault://tools/api-key"),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_access_denied",
      scheme: "vault",
    });
    await expect(
      resolverForStatus(500).check("vault://tools/api-key"),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_resolver_error",
      scheme: "vault",
    });
  });

  it("reports misconfigured Vault and unsupported refs without network checks", async () => {
    const resolver = new VaultSecretResolver({
      address: "",
      token: "",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    await expect(resolver.check("vault://tools/api-key")).resolves.toEqual({
      available: false,
      failureCode: "secret_resolver_misconfigured",
      scheme: "vault",
    });
    await expect(resolver.check("env://ROMEO_TOOL_API_KEY")).resolves.toEqual({
      available: false,
      failureCode: "secret_scheme_unsupported",
      scheme: "env",
    });
  });

  it("checks AWS Secrets Manager metadata without returning secret material", async () => {
    const calls: string[] = [];
    const clientOptions: unknown[] = [];
    const resolver = new AwsSecretsManagerResolver({
      accessKeyId: "access-key",
      secretAccessKey: "secret-access-key",
      sessionToken: "session-token",
      region: "us-east-1",
      clientFactory: (options) => {
        clientOptions.push(options);
        return {
          async describeSecret(secretId) {
            calls.push(secretId);
          },
          async getSecretValue() {
            return undefined;
          },
        };
      },
    });

    const check = await resolver.check("aws-sm://tools/issue-tracker/api-key");

    expect(check).toEqual({ available: true, scheme: "aws-sm" });
    expect(calls).toEqual(["tools/issue-tracker/api-key"]);
    expect(clientOptions).toEqual([
      {
        accessKeyId: "access-key",
        secretAccessKey: "secret-access-key",
        sessionToken: "session-token",
        region: "us-east-1",
      },
    ]);
    expect(JSON.stringify(check)).not.toContain("secret-access-key");
  });

  it("resolves AWS Secrets Manager values through the official SDK boundary", async () => {
    const calls: string[] = [];
    const resolver = new AwsSecretsManagerResolver({
      accessKeyId: "access-key",
      secretAccessKey: "secret-access-key",
      region: "us-east-1",
      clientFactory: () => ({
        async describeSecret() {},
        async getSecretValue(secretId) {
          calls.push(secretId);
          return '{"accessKeyId":"aws-key","secretAccessKey":"aws-secret"}';
        },
      }),
    });

    const resolution = await resolver.resolveValue(
      "aws-sm://connectors/s3/credentials",
    );

    expect(resolution).toEqual({
      available: true,
      scheme: "aws-sm",
      value: '{"accessKeyId":"aws-key","secretAccessKey":"aws-secret"}',
    });
    expect(calls).toEqual(["connectors/s3/credentials"]);
    expect(JSON.stringify(calls)).not.toContain("aws-secret");
  });

  it("maps AWS Secrets Manager metadata failures to stable codes", async () => {
    const resolverForFailure = (name: string, statusCode: number) =>
      new AwsSecretsManagerResolver({
        accessKeyId: "access-key",
        secretAccessKey: "secret-access-key",
        region: "us-east-1",
        clientFactory: () => ({
          async describeSecret() {
            const error = new Error(name);
            error.name = name;
            Object.assign(error, { $metadata: { httpStatusCode: statusCode } });
            throw error;
          },
          async getSecretValue() {
            return undefined;
          },
        }),
      });

    await expect(
      resolverForFailure("ResourceNotFoundException", 400).check(
        "aws-sm://tools/api-key",
      ),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_not_found",
      scheme: "aws-sm",
    });
    await expect(
      resolverForFailure("AccessDeniedException", 403).check(
        "aws-sm://tools/api-key",
      ),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_access_denied",
      scheme: "aws-sm",
    });
    await expect(
      resolverForFailure("InternalServiceError", 500).check(
        "aws-sm://tools/api-key",
      ),
    ).resolves.toEqual({
      available: false,
      failureCode: "secret_resolver_error",
      scheme: "aws-sm",
    });
  });

  it("checks GCP Secret Manager metadata using bearer auth only", async () => {
    const calls: string[] = [];
    const resolver = new GcpSecretManagerResolver({
      accessToken: "gcp-token",
      projectId: "romeo-prod1",
      clientFactory: () => ({
        async checkSecret(secretName) {
          calls.push(secretName);
        },
        async accessSecretValue() {
          return undefined;
        },
      }),
    });

    const check = await resolver.check("gcp-sm://tool-api-key");

    expect(check).toEqual({ available: true, scheme: "gcp-sm" });
    expect(calls).toEqual(["projects/romeo-prod1/secrets/tool-api-key"]);
    expect(JSON.stringify(check)).not.toContain("gcp-token");
  });

  it("resolves GCP Secret Manager latest secret payloads for execution-only use", async () => {
    const calls: string[] = [];
    const resolver = new GcpSecretManagerResolver({
      accessToken: "gcp-token",
      projectId: "romeo-prod1",
      clientFactory: () => ({
        async checkSecret() {},
        async accessSecretValue(secretVersionName) {
          calls.push(secretVersionName);
          return "gcp-secret-value";
        },
      }),
    });

    const resolution = await resolver.resolveValue("gcp-sm://s3-credentials");

    expect(resolution).toEqual({
      available: true,
      scheme: "gcp-sm",
      value: "gcp-secret-value",
    });
    expect(calls).toEqual([
      "projects/romeo-prod1/secrets/s3-credentials/versions/latest",
    ]);
  });

  it("checks Azure Key Vault secret version metadata without reading secret values", async () => {
    const calls: string[] = [];
    const resolver = new AzureKeyVaultResolver({
      accessToken: "azure-token",
      vaultUrl: "https://romeo.vault.azure.net",
      clientFactory: () => ({
        async checkSecret(secretName) {
          calls.push(secretName);
        },
        async getSecretValue() {
          return undefined;
        },
      }),
    });

    const check = await resolver.check("azure-kv://tool-api-key");

    expect(check).toEqual({ available: true, scheme: "azure-kv" });
    expect(calls).toEqual(["tool-api-key"]);
    expect(JSON.stringify(check)).not.toContain("azure-token");
  });

  it("resolves Azure Key Vault secret values for execution-only use", async () => {
    const calls: string[] = [];
    const resolver = new AzureKeyVaultResolver({
      accessToken: "azure-token",
      vaultUrl: "https://romeo.vault.azure.net",
      clientFactory: () => ({
        async checkSecret() {},
        async getSecretValue(secretName) {
          calls.push(secretName);
          return '{"accessKeyId":"azure-key","secretAccessKey":"azure-secret"}';
        },
      }),
    });

    const resolution = await resolver.resolveValue("azure-kv://s3-credentials");

    expect(resolution).toEqual({
      available: true,
      scheme: "azure-kv",
      value: '{"accessKeyId":"azure-key","secretAccessKey":"azure-secret"}',
    });
    expect(calls).toEqual(["s3-credentials"]);
  });

  it("routes cloud secret refs by scheme and rejects unsafe cloud refs", async () => {
    const resolver = new CloudSecretResolver({
      aws: new AwsSecretsManagerResolver({
        accessKeyId: "access-key",
        secretAccessKey: "secret-access-key",
        region: "us-east-1",
        clientFactory: () => ({
          async describeSecret() {},
          async getSecretValue() {
            return undefined;
          },
        }),
      }),
      gcp: new GcpSecretManagerResolver({
        accessToken: "gcp-token",
        projectId: "romeo-prod1",
        clientFactory: () => ({
          async checkSecret() {
            throw Object.assign(new Error("Not found"), { code: 5 });
          },
          async accessSecretValue() {
            return undefined;
          },
        }),
      }),
      azure: new AzureKeyVaultResolver({
        accessToken: "azure-token",
        vaultUrl: "https://romeo.vault.azure.net",
        clientFactory: () => ({
          async checkSecret() {
            throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
          },
          async getSecretValue() {
            return undefined;
          },
        }),
      }),
    });

    await expect(resolver.check("aws-sm://tools/api-key")).resolves.toEqual({
      available: true,
      scheme: "aws-sm",
    });
    await expect(resolver.check("gcp-sm://missing-secret")).resolves.toEqual({
      available: false,
      failureCode: "secret_not_found",
      scheme: "gcp-sm",
    });
    await expect(resolver.check("azure-kv://denied-secret")).resolves.toEqual({
      available: false,
      failureCode: "secret_access_denied",
      scheme: "azure-kv",
    });
    await expect(resolver.check("vault://tools/api-key")).resolves.toEqual({
      available: false,
      failureCode: "secret_scheme_unsupported",
      scheme: "vault",
    });
    await expect(resolver.check("gcp-sm://../bad")).resolves.toEqual({
      available: false,
      failureCode: "invalid_secret_ref",
      scheme: "gcp-sm",
    });
  });
});
