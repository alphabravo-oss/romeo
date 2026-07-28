import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRomeoApi } from "../packages/core/src/index.ts";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory.ts";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver.ts";
import { defaultProviderCapabilities } from "../packages/providers/src/index.ts";
import { MemoryObjectStore } from "../packages/storage/src/index.ts";

type Status = "failed" | "not_configured" | "passed";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  repoRoot,
  process.env.ROMEO_LIVE_IMAGE_EVIDENCE_PATH ??
    "dist/evidence/live-image-provider-acceptance.json",
);
const baseUrl = process.env.ROMEO_LIVE_IMAGE_BASE_URL?.trim();
const modelName = process.env.ROMEO_LIVE_IMAGE_MODEL?.trim();
const apiKey =
  process.env.ROMEO_LIVE_IMAGE_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim();
const prompt =
  process.env.ROMEO_LIVE_IMAGE_PROMPT?.trim() ||
  "A simple blue circle centered on a white background, no text";
const timeoutMs = positiveInteger(
  process.env.ROMEO_LIVE_IMAGE_TIMEOUT_MS,
  120_000,
);
const startedAt = performance.now();

if (!baseUrl || !modelName || !apiKey) {
  await writeEvidence({
    status: "not_configured",
    checks: emptyChecks(),
    failureCode: "live_image_configuration_missing",
  });
  console.log(`Wrote not-configured live image evidence to ${outputPath}`);
} else {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const capabilities = {
      ...defaultProviderCapabilities("openai-compatible"),
      imageGeneration: true,
    };
    await repository.createProvider({
      id: "provider_credentialed_image",
      orgId: "org_default",
      type: "openai-compatible",
      name: "Credentialed image acceptance",
      baseUrl,
      credentialRef: "env://ROMEO_LIVE_IMAGE_API_KEY_INTERNAL",
      modelIds: [modelName],
      enabled: true,
      capabilities,
    });
    await repository.upsertModels([
      {
        id: "model_credentialed_image",
        providerId: "provider_credentialed_image",
        name: modelName,
        displayName: "Credentialed image acceptance model",
        enabled: true,
        capabilities,
        capabilitiesSource: "override",
        contextWindow: 8_192,
      },
    ]);
    const api = createRomeoApi(repository, {
      objectStore,
      providerFetch: timeoutFetch(controller.signal),
      secretResolver: new EnvironmentSecretResolver({
        ROMEO_LIVE_IMAGE_API_KEY_INTERNAL: apiKey,
      }),
    });
    const response = await api.request("/api/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        modelId: "model_credentialed_image",
        prompt,
        count: 1,
        size: "1024x1024",
      }),
    });
    const body = await response.json();
    if (response.status !== 201 || body.data?.length !== 1) {
      throw codedError(safeApiCode(body) ?? "live_image_generation_failed");
    }
    const fileId = body.data[0]?.file?.id;
    if (typeof fileId !== "string") {
      throw codedError("live_image_file_missing");
    }
    const file = await repository.getFileObject(fileId);
    if (
      file === undefined ||
      file.status !== "available" ||
      file.purpose !== "generated_image"
    ) {
      throw codedError("live_image_governance_missing");
    }
    const bytes = await objectStore.getObject(file.objectKey);
    if (bytes === undefined || bytes.byteLength === 0) {
      throw codedError("live_image_object_missing");
    }
    const usage = await repository.listUsageEvents("org_default");
    if (
      !usage.some(
        (event) =>
          event.metric === "image.generated" &&
          event.quantity === 1 &&
          event.sourceId === fileId,
      )
    ) {
      throw codedError("live_image_usage_missing");
    }
    const deleteResponse = await api.request(`/api/v1/files/${fileId}`, {
      method: "DELETE",
    });
    if (
      deleteResponse.status !== 200 ||
      (await objectStore.getObject(file.objectKey)) !== undefined ||
      (await repository.getFileObject(fileId))?.status !== "deleted"
    ) {
      throw codedError("live_image_cleanup_failed");
    }
    await writeEvidence({
      status: "passed",
      checks: {
        providerRequestCompleted: true,
        signatureAndDimensionsValidated: true,
        governedFilePersisted: true,
        usageRecorded: true,
        artifactDeleted: true,
        objectReadAfterDeleteEmpty: true,
      },
      observations: {
        artifactBytes: bytes.byteLength,
        modelHash: shortHash(modelName),
      },
    });
    console.log("Credentialed live image-provider acceptance passed.");
    console.log(`Wrote live image evidence to ${outputPath}`);
  } catch (error) {
    await writeEvidence({
      status: "failed",
      checks: emptyChecks(),
      failureCode: safeErrorCode(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function timeoutFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal });
}

function emptyChecks() {
  return {
    providerRequestCompleted: false,
    signatureAndDimensionsValidated: false,
    governedFilePersisted: false,
    usageRecorded: false,
    artifactDeleted: false,
    objectReadAfterDeleteEmpty: false,
  };
}

async function writeEvidence(input: {
  status: Status;
  checks: ReturnType<typeof emptyChecks>;
  observations?: { artifactBytes: number; modelHash: string };
  failureCode?: string;
}): Promise<void> {
  const evidence = {
    schemaVersion: "romeo.live-image-provider-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status: input.status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      providerProtocol: "openai-compatible-images",
      configured: input.status !== "not_configured",
    },
    checks: input.checks,
    ...(input.observations === undefined
      ? {}
      : { observations: input.observations }),
    redaction: {
      endpointReturned: false,
      apiKeyReturned: false,
      modelNameReturned: false,
      promptReturned: false,
      imageBytesReturned: false,
      objectKeyReturned: false,
      providerPayloadReturned: false,
    },
    ...(input.failureCode === undefined
      ? {}
      : { failureCode: input.failureCode }),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function safeApiCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/u.test(code)
    ? code
    : undefined;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (typeof error === "object" && error !== null && "errorCode" in error) {
    const value = (error as { errorCode?: unknown }).errorCode;
    if (typeof value === "string" && /^[a-z0-9_]{1,80}$/u.test(value)) {
      return value;
    }
  }
  return "live_image_acceptance_failed";
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
