import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  S3ObjectStore,
  createS3PresignedRequest,
} from "../packages/storage/src/index.ts";

interface Check {
  id: string;
  status: "passed" | "failed";
  bytes?: number;
  contentType?: string;
}

const endpoint = requiredEnv("S3_ENDPOINT");
const bucket = requiredEnv("S3_BUCKET");
const region = process.env.S3_REGION?.trim() || "us-east-1";
const accessKeyId = requiredEnv("S3_ACCESS_KEY_ID");
const secretAccessKey = requiredEnv("S3_SECRET_ACCESS_KEY");
const createBucket = process.argv.includes("--create-bucket");
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputValue =
  argValue("--output") ?? "dist/evidence/live-object-store-acceptance.json";
const output = outputValue.startsWith("/")
  ? outputValue
  : resolve(repoRoot, outputValue);
const config = {
  endpoint,
  bucket,
  region,
  accessKeyId,
  secretAccessKey,
};
const startedAt = new Date();
const checks: Check[] = [];

try {
  if (createBucket) await ensureBucket(config);
  checks.push({ id: "bucket_ready", status: "passed" });

  const store = new S3ObjectStore(config);
  const runPrefix = `romeo-live-acceptance/${randomUUID()}`;
  const objects = [
    {
      id: "attachment_round_trip",
      key: `${runPrefix}/attachments/context.txt`,
      contentType: "text/plain",
      body: new TextEncoder().encode(
        "Synthetic retained attachment for Romeo object-store acceptance.",
      ),
    },
    {
      id: "generated_image_round_trip",
      key: `${runPrefix}/generated-images/result.png`,
      contentType: "image/png",
      body: Uint8Array.from(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64",
        ),
      ),
    },
    {
      id: "chat_export_round_trip",
      key: `${runPrefix}/chat-exports/chat.json`,
      contentType: "application/json",
      body: new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: "romeo.chat-export.v1",
          synthetic: true,
        }),
      ),
    },
  ];

  for (const object of objects) {
    await store.putObject(object);
    const read = await store.getObject(object.key);
    if (read === undefined || !bytesEqual(read, object.body)) {
      throw new Error(`${object.id} did not round-trip exact bytes.`);
    }
    checks.push({
      id: object.id,
      status: "passed",
      bytes: object.body.byteLength,
      contentType: object.contentType,
    });
  }

  const deletionKey = `${runPrefix}/retention/delete-probe.bin`;
  await store.putObject({
    key: deletionKey,
    contentType: "application/octet-stream",
    body: new Uint8Array([82, 111, 109, 101, 111]),
  });
  await store.deleteObject(deletionKey);
  if ((await store.getObject(deletionKey)) !== undefined) {
    throw new Error("Deleted object remained readable.");
  }
  checks.push({ id: "delete_and_missing_read", status: "passed" });

  writeEvidence("passed");
  console.log("Live S3-compatible object-store acceptance passed.");
  console.log(`Wrote object-store acceptance evidence to ${output}`);
} catch (error) {
  checks.push({ id: "acceptance_completed", status: "failed" });
  writeEvidence("failed", error);
  throw error;
}

function writeEvidence(status: "passed" | "failed", error?: unknown): void {
  const completedAt = new Date();
  const parsedEndpoint = new URL(endpoint);
  const evidence = {
    schemaVersion: "romeo.live-object-store-acceptance.v1",
    generatedAt: completedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    status,
    target: {
      protocol: parsedEndpoint.protocol,
      local: ["127.0.0.1", "::1", "localhost"].includes(
        parsedEndpoint.hostname,
      ),
      region,
      bucketConfigured: bucket.length > 0,
    },
    checks,
    redaction: {
      endpointReturned: false,
      bucketNameReturned: false,
      accessKeyReturned: false,
      secretKeyReturned: false,
      objectKeysReturned: false,
      objectBodiesReturned: false,
      presignedUrlsReturned: false,
    },
    ...(error === undefined
      ? {}
      : {
          error: error instanceof Error ? error.message : "Acceptance failed.",
        }),
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function ensureBucket(input: typeof config): Promise<void> {
  const request = await createS3PresignedRequest({
    ...input,
    key: "",
    method: "PUT",
    expiresInSeconds: 300,
  });
  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
  });
  if (response.ok) return;
  const body = await response.text();
  if (response.status === 409 && /BucketAlreadyOwnedByYou/u.test(body)) return;
  throw new Error(`Bucket creation failed with HTTP ${response.status}.`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
