import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { S3HttpConnectorReader } from "./s3-data-connector-reader";
import { EnvironmentSecretResolver } from "./secret-resolver";

type S3CommandHandler = (command: unknown) => Promise<unknown>;

function sdkClientFactory(
  handler: S3CommandHandler,
  configs: S3ClientConfig[] = [],
) {
  return (config: S3ClientConfig): S3Client => {
    configs.push(config);
    return {
      send: vi.fn((command: unknown) => handler(command)),
      destroy: vi.fn(),
    } as unknown as S3Client;
  };
}

function sdkBody(bytes: Uint8Array) {
  return {
    async transformToByteArray() {
      return bytes;
    },
  };
}

describe("S3HttpConnectorReader", () => {
  it("lists and reads objects through the official AWS SDK", async () => {
    const commands: unknown[] = [];
    const objectBody = "Romeo S3 connector imports bounded text objects.";
    const objectBytes = new TextEncoder().encode(objectBody);
    const configs: S3ClientConfig[] = [];
    const reader = new S3HttpConnectorReader({
      accessKeyId: "connector-access-key",
      endpoint: "https://s3.example.com",
      secretAccessKey: "connector-secret-key",
      clientFactory: sdkClientFactory(async (command) => {
        commands.push(command);
        if (command instanceof ListObjectsV2Command) {
          return {
            IsTruncated: false,
            Contents: [
              {
                Key: "handbook/policies/access.md",
                Size: objectBytes.byteLength,
              },
            ],
          };
        }
        return {
          Body: sdkBody(objectBytes),
          ContentType: "text/markdown",
        };
      }, configs),
    });

    const objects = await reader.listObjects({
      bucket: "romeo-docs",
      prefix: "handbook/",
      region: "us-east-1",
      maxKeys: 5,
    });
    const object = await reader.getObject({
      bucket: "romeo-docs",
      key: objects[0]!.key,
      region: "us-east-1",
    });

    expect(objects).toEqual([
      { key: "handbook/policies/access.md", sizeBytes: objectBytes.byteLength },
    ]);
    expect(new TextDecoder().decode(object?.body)).toContain(
      "bounded text objects",
    );
    expect(object?.contentType).toBe("text/markdown");
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect((commands[0] as ListObjectsV2Command).input).toMatchObject({
      Bucket: "romeo-docs",
      Prefix: "handbook/",
      MaxKeys: 5,
    });
    expect(commands[1]).toBeInstanceOf(GetObjectCommand);
    expect((commands[1] as GetObjectCommand).input).toMatchObject({
      Bucket: "romeo-docs",
      Key: "handbook/policies/access.md",
    });
    expect(configs[0]).toMatchObject({
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      forcePathStyle: true,
      maxAttempts: 2,
    });
    expect(JSON.stringify(commands)).not.toContain("connector-secret-key");
  });

  it("rejects secret refs without a value-capable resolver", async () => {
    const clientFactory = vi.fn();
    const reader = new S3HttpConnectorReader({
      accessKeyId: "connector-access-key",
      endpoint: "https://s3.example.com",
      secretAccessKey: "connector-secret-key",
      clientFactory,
    });

    await expect(
      reader.listObjects({
        bucket: "romeo-docs",
        prefix: "handbook/",
        region: "us-east-1",
        maxKeys: 5,
        secretRef: "env://S3_CONNECTOR_TOKEN",
      }),
    ).rejects.toMatchObject({ code: "connector_s3_secret_ref_unsupported" });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("resolves connector-specific credentials from env secret refs", async () => {
    const configs: S3ClientConfig[] = [];
    const reader = new S3HttpConnectorReader({
      accessKeyId: "",
      endpoint: "https://s3.example.com",
      secretAccessKey: "",
      secretResolver: new EnvironmentSecretResolver({
        S3_CONNECTOR_CREDENTIALS: JSON.stringify({
          accessKeyId: "connector-specific-key",
          secretAccessKey: "connector-specific-secret",
        }),
      }),
      clientFactory: sdkClientFactory(
        async (command) =>
          command instanceof ListObjectsV2Command
            ? {
                Contents: [{ Key: "handbook/private.md", Size: 15 }],
                IsTruncated: false,
              }
            : {
                Body: sdkBody(
                  new TextEncoder().encode("Romeo private S3 notes."),
                ),
                ContentType: "text/markdown",
              },
        configs,
      ),
    });

    const objects = await reader.listObjects({
      bucket: "romeo-docs",
      prefix: "handbook/",
      region: "us-east-1",
      maxKeys: 5,
      secretRef: "env://S3_CONNECTOR_CREDENTIALS",
    });
    const object = await reader.getObject({
      bucket: "romeo-docs",
      key: objects[0]!.key,
      region: "us-east-1",
      secretRef: "env://S3_CONNECTOR_CREDENTIALS",
    });

    expect(objects).toEqual([{ key: "handbook/private.md", sizeBytes: 15 }]);
    expect(new TextDecoder().decode(object?.body)).toContain(
      "private S3 notes",
    );
    expect(configs[0]?.credentials).toMatchObject({
      accessKeyId: "connector-specific-key",
      secretAccessKey: "connector-specific-secret",
    });
  });

  it("resolves connector-specific credentials from managed secret values", async () => {
    const configs: S3ClientConfig[] = [];
    const reader = new S3HttpConnectorReader({
      accessKeyId: "",
      endpoint: "https://s3.example.com",
      secretAccessKey: "",
      secretResolver: {
        async check() {
          return { available: true, scheme: "vault" };
        },
        async resolveValue(secretRef) {
          expect(secretRef).toBe("vault://connectors/s3/credentials");
          return {
            available: true,
            scheme: "vault",
            value: JSON.stringify({
              accessKeyId: "vault-s3-key",
              secretAccessKey: "vault-s3-secret",
            }),
          };
        },
      },
      clientFactory: sdkClientFactory(
        async () => ({
          Contents: [{ Key: "handbook/vault.md", Size: 20 }],
          IsTruncated: false,
        }),
        configs,
      ),
    });

    const objects = await reader.listObjects({
      bucket: "romeo-docs",
      prefix: "handbook/",
      region: "us-east-1",
      maxKeys: 5,
      secretRef: "vault://connectors/s3/credentials",
    });

    expect(objects).toEqual([{ key: "handbook/vault.md", sizeBytes: 20 }]);
    expect(configs[0]?.credentials).toMatchObject({
      accessKeyId: "vault-s3-key",
      secretAccessKey: "vault-s3-secret",
    });
  });

  it("rejects malformed credential secrets before creating an SDK client", async () => {
    const clientFactory = vi.fn();
    const reader = new S3HttpConnectorReader({
      accessKeyId: "",
      endpoint: "https://s3.example.com",
      secretAccessKey: "",
      secretResolver: new EnvironmentSecretResolver({
        S3_CONNECTOR_CREDENTIALS: '{"accessKeyId":"missing-secret"}',
      }),
      clientFactory,
    });

    await expect(
      reader.listObjects({
        bucket: "romeo-docs",
        prefix: "handbook/",
        region: "us-east-1",
        maxKeys: 5,
        secretRef: "env://S3_CONNECTOR_CREDENTIALS",
      }),
    ).rejects.toMatchObject({ code: "connector_s3_secret_ref_invalid" });
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
