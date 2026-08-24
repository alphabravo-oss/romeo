import { describe, expect, it } from "vitest";
import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { S3ObjectStore } from "./s3-object-store";
import { createS3PresignedRequest } from "./s3-signer";
import type { S3ReadinessClientFactory } from "./s3-readiness";

const config = {
  endpoint: "http://rustfs:9000",
  bucket: "romeo",
  accessKeyId: "romeo",
  secretAccessKey: "romeo-local-secret",
  region: "us-east-1",
};

describe("S3ObjectStore", () => {
  it("creates path-style S3-compatible presigned upload requests", async () => {
    const request = await createS3PresignedRequest({
      ...config,
      key: "knowledge/source one.txt",
      method: "PUT",
      contentType: "text/plain",
      expiresInSeconds: 60,
      now: new Date("2026-06-27T12:00:00.000Z"),
    });
    const url = new URL(request.url);

    expect(url.origin).toBe("http://rustfs:9000");
    expect(url.pathname).toBe("/romeo/knowledge/source%20one.txt");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain(
      "romeo/20260627/us-east-1/s3/aws4_request",
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(request.headers).toEqual({ "content-type": "text/plain" });
    expect(request.expiresAt).toBe("2026-06-27T12:01:00.000Z");
  });

  it("signs bounded S3 API query parameters without allowing signing override", async () => {
    const request = await createS3PresignedRequest({
      ...config,
      key: "",
      method: "GET",
      expiresInSeconds: 60,
      query: { "list-type": "2", "max-keys": "5", prefix: "handbook/" },
      now: new Date("2026-06-27T12:00:00.000Z"),
    });
    const url = new URL(request.url);

    expect(url.pathname).toBe("/romeo/");
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("max-keys")).toBe("5");
    expect(url.searchParams.get("prefix")).toBe("handbook/");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      createS3PresignedRequest({
        ...config,
        key: "",
        method: "GET",
        expiresInSeconds: 60,
        query: { "X-Amz-Date": "override" },
      }),
    ).rejects.toThrow("S3 presigned query cannot override signing parameters.");
  });

  it("uploads through a presigned PUT request", async () => {
    const calls: Array<{
      body: BodyInit | null | undefined;
      headers: HeadersInit | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      });
      return new Response(null, {
        status: 200,
        headers: { etag: '"etag-from-rustfs"' },
      });
    };
    const store = new S3ObjectStore(config, fetchImpl);
    const stored = await store.putObject({
      key: "knowledge/source.txt",
      body: new TextEncoder().encode("romeo storage"),
      contentType: "text/plain",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toContain("/romeo/knowledge/source.txt?");
    expect(calls[0]!.headers).toEqual({ "content-type": "text/plain" });
    expect(stored.etag).toBe("etag-from-rustfs");
    expect(stored.sizeBytes).toBe("romeo storage".length);
  });

  it("signs the declared upload length and bounds streamed object reads", async () => {
    const upload = await createS3PresignedRequest({
      ...config,
      key: "bounded.txt",
      method: "PUT",
      contentType: "text/plain",
      contentLength: 12,
      expiresInSeconds: 60,
      now: new Date("2026-06-27T12:00:00.000Z"),
    });
    expect(
      new URL(upload.url).searchParams.get("X-Amz-SignedHeaders"),
    ).toContain("content-length");

    const store = new S3ObjectStore(config, async (_url, init) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "20",
            "content-type": "text/plain",
            etag: '"bounded-etag"',
          },
        });
      }
      return new Response("twenty bytes payload!", {
        status: 200,
        headers: { "content-length": "20" },
      });
    });

    await expect(store.headObject("bounded.txt")).resolves.toMatchObject({
      sizeBytes: 20,
      etag: "bounded-etag",
    });
    await expect(
      store.getObject("bounded.txt", { maxBytes: 10 }),
    ).rejects.toMatchObject({ name: "ObjectSizeLimitError", maxBytes: 10 });
  });

  it("probes authenticated bucket posture and verifies reversible write/read/delete", async () => {
    const calls: string[] = [];
    let stored: Uint8Array | undefined;
    let deleted = false;
    const clientFactory: S3ReadinessClientFactory = () => ({
      destroy() {
        calls.push("destroy");
      },
      async send(command) {
        calls.push(command.constructor.name);
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketEncryptionCommand) {
          return {
            ServerSideEncryptionConfiguration: {
              Rules: [
                {
                  ApplyServerSideEncryptionByDefault: {
                    SSEAlgorithm: "aws:kms",
                  },
                },
              ],
            },
          };
        }
        if (command instanceof GetBucketVersioningCommand)
          return { Status: "Enabled" };
        if (command instanceof GetBucketLifecycleConfigurationCommand) {
          return {
            Rules: [
              {
                Status: "Enabled",
                NoncurrentVersionExpiration: { NoncurrentDays: 30 },
              },
            ],
          };
        }
        if (command instanceof GetBucketReplicationCommand) return {};
        if (command instanceof PutObjectCommand) {
          deleted = false;
          stored = new Uint8Array(command.input.Body as Uint8Array);
          return {};
        }
        if (command instanceof GetObjectCommand) {
          return {
            ContentLength: stored?.byteLength,
            Body: {
              async transformToByteArray() {
                return stored!;
              },
            },
          };
        }
        if (command instanceof DeleteObjectCommand) {
          deleted = true;
          return {};
        }
        if (command instanceof HeadObjectCommand && deleted) {
          const error = new Error("not found");
          error.name = "NotFound";
          throw error;
        }
        throw new Error("unexpected command");
      },
    });
    const store = new S3ObjectStore(
      {
        ...config,
        endpoint: "https://objects.example.com",
        readiness: {
          requireEncryption: true,
          requireLifecycle: true,
          requireReplication: false,
          requireVersioning: true,
          timeoutMs: 1_000,
        },
      },
      fetch,
      clientFactory,
    );

    await expect(store.checkReadiness()).resolves.toEqual({
      authenticated: true,
      deleteVerified: true,
      encryptionConfigured: true,
      lifecycleConfigured: true,
      readAfterWriteVerified: true,
      ready: true,
      replicationConfigured: false,
      tlsEnabled: true,
      versioningEnabled: true,
      writeVerified: true,
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        "HeadBucketCommand",
        "GetBucketEncryptionCommand",
        "GetBucketVersioningCommand",
        "GetBucketLifecycleConfigurationCommand",
        "GetBucketReplicationCommand",
        "PutObjectCommand",
        "GetObjectCommand",
        "DeleteObjectCommand",
        "HeadObjectCommand",
        "destroy",
      ]),
    );

    const replicationRequired = new S3ObjectStore(
      {
        ...config,
        endpoint: "https://objects.example.com",
        readiness: {
          requireEncryption: true,
          requireLifecycle: true,
          requireReplication: true,
          requireVersioning: true,
          timeoutMs: 1_000,
        },
      },
      fetch,
      clientFactory,
    );
    await expect(replicationRequired.checkReadiness()).resolves.toMatchObject({
      ready: false,
      replicationConfigured: false,
    });
  });

  it("fails posture without leaking bucket or endpoint identifiers", async () => {
    const clientFactory: S3ReadinessClientFactory = () => ({
      destroy() {},
      async send() {
        throw new Error("secret-bucket at private.objects.internal denied");
      },
    });
    const store = new S3ObjectStore(
      {
        ...config,
        bucket: "secret-bucket",
        endpoint: "https://private.objects.internal",
      },
      fetch,
      clientFactory,
    );

    const error = await store.checkReadiness().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("S3 readiness probe failed.");
    expect((error as Error).message).not.toMatch(
      /secret-bucket|private\.objects/,
    );
  });

  it("refuses to send authenticated readiness traffic over plaintext", async () => {
    let clientCreated = false;
    const store = new S3ObjectStore(config, fetch, () => {
      clientCreated = true;
      throw new Error("must not initialize");
    });

    await expect(store.checkReadiness()).rejects.toThrow(
      "S3 readiness probe requires an HTTPS endpoint.",
    );
    expect(clientCreated).toBe(false);
  });

  it("aborts a readiness probe at its total deadline", async () => {
    let destroyed = false;
    const clientFactory: S3ReadinessClientFactory = () => ({
      destroy() {
        destroyed = true;
      },
      send(_command, options) {
        return new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("provider timeout detail")),
            { once: true },
          );
        });
      },
    });
    const store = new S3ObjectStore(
      {
        ...config,
        endpoint: "https://objects.example.com",
        readiness: { timeoutMs: 5 },
      },
      fetch,
      clientFactory,
    );

    await expect(store.checkReadiness()).rejects.toThrow(
      "S3 readiness probe timed out.",
    );
    expect(destroyed).toBe(true);
  });

  it("propagates the caller deadline into every S3 readiness command", async () => {
    let observedAbort = false;
    const clientFactory: S3ReadinessClientFactory = () => ({
      destroy() {},
      send(_command, options) {
        return new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(new Error("caller deadline"));
            },
            { once: true },
          );
        });
      },
    });
    const store = new S3ObjectStore(
      {
        ...config,
        endpoint: "https://objects.example.com",
        readiness: { timeoutMs: 10_000 },
      },
      fetch,
      clientFactory,
    );
    const controller = new AbortController();
    const pending = store.checkReadiness(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("S3 readiness probe timed out.");
    expect(observedAbort).toBe(true);
  });
});
