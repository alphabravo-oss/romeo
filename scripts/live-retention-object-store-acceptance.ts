import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readEnv } from "../packages/config/src/index.ts";
import { createRomeoApi, createServices } from "../packages/core/src/index.ts";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver.ts";
import { defaultProviderCapabilities } from "../packages/providers/src/index.ts";
import {
  createLivePostgresRepositoryFixture,
  postgresConformanceDatabaseUrl,
} from "../packages/db/src/test-support/postgres-conformance-harness.ts";
import {
  S3ObjectStore,
  createS3PresignedRequest,
} from "../packages/storage/src/index.ts";

const adminDatabaseUrl = postgresConformanceDatabaseUrl();
if (adminDatabaseUrl === undefined) {
  throw new Error("ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL is required.");
}
const s3 = {
  endpoint: requiredEnv("S3_ENDPOINT"),
  bucket: requiredEnv("S3_BUCKET"),
  region: process.env.S3_REGION?.trim() || "us-east-1",
  accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
};
await ensureBucket(s3);
const fixture = await createLivePostgresRepositoryFixture(adminDatabaseUrl);
const imageSecret = `image_acceptance_${randomUUID()}`;
const imagePrompt = `IMAGE_GENERATION_SENTINEL_${randomUUID()}`;
const generatedPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const imageProvider = await controlledImageProvider();
const startedAt = performance.now();
const checks: Record<string, boolean | number> = {};

try {
  const env = readEnv({
    DATABASE_URL: fixture.databaseUrl,
    DEV_SEEDED_LOGIN: "true",
    LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "prod-local-auth-secret-key-32-bytes",
    OBJECT_STORE_DRIVER: "s3",
    REPOSITORY_DRIVER: "postgres",
    S3_ENDPOINT: s3.endpoint,
    S3_BUCKET: s3.bucket,
    S3_REGION: s3.region,
    S3_ACCESS_KEY_ID: s3.accessKeyId,
    S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
    SESSION_SECRET: "prod-session-secret-32-bytes-long",
    WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
  });
  const store = new S3ObjectStore(s3);
  const capabilities = {
    ...defaultProviderCapabilities("openai-compatible"),
    imageGeneration: true,
  };
  await fixture.repository.createProvider({
    id: "provider_live_image_acceptance",
    orgId: "org_default",
    type: "openai-compatible",
    name: "Controlled live image provider",
    baseUrl: `${imageProvider.baseUrl}/v1`,
    credentialRef: "env://IMAGE_ACCEPTANCE_API_KEY",
    modelIds: ["controlled-image-model"],
    enabled: true,
    capabilities,
  });
  await fixture.repository.upsertModels([
    {
      id: "model_live_image_acceptance",
      providerId: "provider_live_image_acceptance",
      name: "controlled-image-model",
      displayName: "Controlled image model",
      enabled: true,
      capabilities,
      capabilitiesSource: "override",
      contextWindow: 8_192,
      pricing: {
        inputTokenUsd: 0,
        outputTokenUsd: 0,
        imageGenerationUsd: {
          "1024x1024": 0.04,
          "1024x1536": 0.08,
          "1536x1024": 0.08,
        },
      },
    },
  ]);
  const api = createRomeoApi(fixture.repository, {
    env,
    secretResolver: new EnvironmentSecretResolver({
      IMAGE_ACCEPTANCE_API_KEY: imageSecret,
    }),
  });
  const fileFixtures = [
    {
      purpose: "chat_attachment",
      fileName: "retention-attachment.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("live attachment retention sentinel"),
    },
  ] as const;
  const storedKeys: string[] = [];
  for (const input of fileFixtures) {
    const response = await api.request("/api/v1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        dataBase64: Buffer.from(input.bytes).toString("base64"),
        purpose: input.purpose,
      }),
    });
    const body = await response.json();
    if (response.status !== 201)
      throw new Error("Retention file upload failed.");
    const file = await fixture.repository.getFileObject(body.data.id);
    if (file === undefined)
      throw new Error("Retention file metadata is missing.");
    if ((await store.getObject(file.objectKey)) === undefined) {
      throw new Error("Retention file object was not uploaded.");
    }
    storedKeys.push(file.objectKey);
    await fixture.repository.updateFileObject({
      ...file,
      metadata: {
        ...file.metadata,
        expiresAt: "2020-01-02T00:00:00.000Z",
      },
      updatedAt: "2026-07-16T11:00:00.000Z",
    });
  }
  const generationResponse = await api.request("/api/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace_default",
      modelId: "model_live_image_acceptance",
      prompt: imagePrompt,
      count: 1,
      size: "1024x1024",
    }),
  });
  const generated = await generationResponse.json();
  if (generationResponse.status !== 201 || generated.data?.length !== 1) {
    throw new Error("Live image generation API failed.");
  }
  const generatedFile = await fixture.repository.getFileObject(
    generated.data[0].file.id,
  );
  if (
    generatedFile === undefined ||
    generatedFile.purpose !== "generated_image"
  ) {
    throw new Error("Generated image was not governed as a file object.");
  }
  const generatedBytes = await store.getObject(generatedFile.objectKey);
  if (
    generatedBytes === undefined ||
    !Buffer.from(generatedBytes).equals(generatedPng)
  ) {
    throw new Error("Generated image bytes were not persisted exactly in S3.");
  }
  storedKeys.push(generatedFile.objectKey);
  await fixture.repository.updateFileObject({
    ...generatedFile,
    metadata: {
      ...generatedFile.metadata,
      expiresAt: "2020-01-02T00:00:00.000Z",
    },
    updatedAt: "2026-07-16T11:00:00.000Z",
  });
  const imageUsage = await fixture.repository.listUsageEvents("org_default");
  if (
    !imageUsage.some(
      (event) =>
        event.metric === "image.generated" &&
        event.quantity === 1 &&
        event.sourceId === generatedFile.id,
    ) ||
    !imageUsage.some(
      (event) =>
        event.metric === "image.cost.estimated" &&
        event.quantity === 40_000 &&
        event.sourceId === generatedFile.id,
    )
  ) {
    throw new Error("Generated image usage or cost accounting is incomplete.");
  }
  if (
    imageProvider.requestCount() !== 1 ||
    !imageProvider.credentialAccepted()
  ) {
    throw new Error(
      "Controlled image provider request contract was incomplete.",
    );
  }
  checks.imageProviderHttpRequest = true;
  checks.imageProviderCredentialAccepted = true;
  checks.generatedImageStoredExactly = true;
  checks.generatedImageUsageRecorded = true;
  const policyResponse = await api.request("/api/v1/governance/retention", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      auditLogRetentionDays: 365,
      fileRetentionDays: 1,
    }),
  });
  const enforceResponse = await api.request(
    "/api/v1/governance/retention/enforce",
    { method: "POST" },
  );
  const enforced = await enforceResponse.json();
  if (policyResponse.status !== 200 || enforceResponse.status !== 200) {
    throw new Error("Retention enforcement API failed.");
  }
  if (enforced.data.deletedFileObjectCount !== 2) {
    throw new Error("Retention did not delete both governed file records.");
  }
  for (const key of storedKeys) {
    if ((await store.getObject(key)) !== undefined) {
      throw new Error("Expired governed file remained in object storage.");
    }
  }
  checks.attachmentExpiredAndDeleted = true;
  checks.generatedImageExpiredAndDeleted = true;
  checks.deletedGovernedFileObjects = 2;

  const temporaryObjectKey =
    "chat-attachments/msg_live_retention/part_live_retention/document.txt";
  await fixture.repository.createChat({
    id: "chat_live_retention_expired",
    orgId: "org_default",
    workspaceId: "workspace_default",
    title: "Expired live retention chat",
    temporary: true,
    expiresAt: "2026-07-16T11:59:00.000Z",
    createdBy: "user_dev_admin",
    updatedAt: "2026-07-16T11:00:00.000Z",
  });
  await fixture.repository.createMessage({
    id: "msg_live_retention",
    chatId: "chat_live_retention_expired",
    role: "user",
    content: "temporary retention attachment",
    createdAt: "2026-07-16T11:30:00.000Z",
  });
  await fixture.repository.createMessageParts([
    {
      id: "part_live_retention",
      messageId: "msg_live_retention",
      type: "attachment",
      content: temporaryObjectKey,
      metadata: {},
    },
  ]);
  await store.putObject({
    key: temporaryObjectKey,
    contentType: "text/plain",
    body: new TextEncoder().encode("temporary chat object deletion sentinel"),
  });
  const services = createServices(fixture.repository, { env });
  await services.temporaryChatCleanup.runOnce("2026-07-16T12:00:00.000Z");
  if (
    (await fixture.repository.getChat("chat_live_retention_expired")) !==
    undefined
  ) {
    throw new Error("Temporary-chat worker did not delete the expired chat.");
  }
  if ((await store.getObject(temporaryObjectKey)) !== undefined) {
    throw new Error("Temporary-chat worker left its attachment object behind.");
  }
  const cleanupJob = (
    await fixture.repository.listBackgroundJobs("org_default")
  ).find((job) => job.type === "temporary_chat.cleanup");
  if (
    cleanupJob?.status !== "completed" ||
    cleanupJob.payload.deleted !== 1 ||
    cleanupJob.payload.deletedObjects !== 1
  ) {
    throw new Error("Temporary-chat worker evidence was incomplete.");
  }
  checks.temporaryChatWorkerCompleted = true;
  checks.temporaryChatAttachmentDeleted = true;

  const auditText = JSON.stringify(
    await fixture.repository.listAuditLogs("org_default"),
  );
  if (
    [...storedKeys, temporaryObjectKey].some((key) =>
      auditText.includes(key),
    ) ||
    auditText.includes("retention sentinel")
  ) {
    throw new Error("Retention audit metadata leaked object data.");
  }
  checks.auditRedaction = true;

  await writeEvidence("passed");
  console.log("Live PostgreSQL/S3 retention acceptance passed.");
} catch (error) {
  await writeEvidence("failed", error);
  throw error;
} finally {
  await closeServer(imageProvider.server);
  await fixture.close();
}

async function writeEvidence(
  status: "failed" | "passed",
  error?: unknown,
): Promise<void> {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const outputValue =
    process.env.ROMEO_RETENTION_OBJECT_STORE_EVIDENCE_PATH ??
    "dist/evidence/live-retention-object-store-acceptance.json";
  const output = outputValue.startsWith("/")
    ? outputValue
    : resolve(repoRoot, outputValue);
  const evidence = {
    schemaVersion: "romeo.live-retention-object-store-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      postgresql: true,
      s3Compatible: true,
      loopback: new URL(s3.endpoint).hostname === "127.0.0.1",
    },
    checks,
    redaction: {
      databaseUrlReturned: false,
      endpointReturned: false,
      bucketReturned: false,
      credentialsReturned: false,
      objectKeysReturned: false,
      objectBodiesReturned: false,
      auditBodiesReturned: false,
    },
    ...(error === undefined
      ? {}
      : { errorCode: "retention_object_store_acceptance_failed" }),
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function ensureBucket(input: typeof s3): Promise<void> {
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

async function controlledImageProvider(): Promise<{
  server: Server;
  baseUrl: string;
  requestCount: () => number;
  credentialAccepted: () => boolean;
}> {
  let requests = 0;
  let acceptedCredential = false;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/images/generations") {
      response.statusCode = 404;
      response.end();
      return;
    }
    requests += 1;
    acceptedCredential =
      request.headers.authorization === `Bearer ${imageSecret}`;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as Record<string, unknown>;
      if (
        !acceptedCredential ||
        payload.prompt !== imagePrompt ||
        payload.model !== "controlled-image-model" ||
        payload.response_format !== "b64_json"
      ) {
        response.statusCode = 400;
        response.end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: [
            {
              b64_json: generatedPng.toString("base64"),
              revised_prompt: "Controlled revised prompt",
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Controlled image provider did not expose a TCP port.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
    credentialAccepted: () => acceptedCredential,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
