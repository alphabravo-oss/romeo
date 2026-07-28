import {
  knowledgeCompleteUpload,
  knowledgeCreateUpload,
  knowledgeExtractSource,
  knowledgeIndexEmbeddings,
  knowledgeListSources,
  type CreateKnowledgeUploadRequest,
  type IndexKnowledgeEmbeddingsRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";
import { basename } from "node:path";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import { numberFlag, optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";
import { runKnowledgeExtractionWorker } from "./knowledge-worker";

interface KnowledgeCommandContext {
  fetchImpl: typeof fetch;
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
  readFile: (path: string) => Promise<Uint8Array>;
}

export function executeKnowledgeCommand(
  area: string,
  action: string | undefined,
  context: KnowledgeCommandContext,
): Promise<number> | undefined {
  if (area === "workers" && action === "knowledge-extraction")
    return knowledgeExtractionWorker(context);
  if (area !== "knowledge") return undefined;
  if (action === "upload") return uploadKnowledgeFile(context);
  if (action === "extract") return result(context, extractSource(context));
  if (action === "index-embeddings")
    return result(context, indexEmbeddings(context));
  return undefined;
}

async function uploadKnowledgeFile(
  context: KnowledgeCommandContext,
): Promise<number> {
  const knowledgeBaseId = requiredFlag(context.parsed, "knowledge-base", "kb");
  const filePath = requiredFlag(context.parsed, "file");
  const file = await context.readFile(filePath);
  const body: CreateKnowledgeUploadRequest = {
    fileName: flagValue(context.parsed.flags, "name") ?? basename(filePath),
    mimeType:
      flagValue(context.parsed.flags, "mime-type", "mime") ??
      "application/octet-stream",
    sizeBytes: file.byteLength,
  };
  const registration = await createUpload(context, knowledgeBaseId, body);
  const uploadResponse = await context.fetchImpl(registration.upload.url, {
    method: registration.upload.method,
    headers: registration.upload.headers,
    body: new Uint8Array(file).buffer,
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Knowledge file upload failed with ${uploadResponse.status}.`,
    );
  }
  writeJson(
    context.io,
    await completeUpload(context, knowledgeBaseId, registration.source.id),
  );
  return 0;
}

function indexEmbeddings(context: KnowledgeCommandContext) {
  const knowledgeBaseId = requiredFlag(context.parsed, "knowledge-base", "kb");
  const batchSize = optionalIntegerFlag(context.parsed, "batch-size");
  const body: IndexKnowledgeEmbeddingsRequest = {
    providerId: requiredFlag(context.parsed, "provider"),
    model: requiredFlag(context.parsed, "model"),
    ...(batchSize === undefined ? {} : { batchSize }),
  };
  return knowledgeIndexEmbeddings({
    body,
    client: generatedClient(context),
    path: { knowledgeBaseId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

function extractSource(context: KnowledgeCommandContext) {
  return extractUpload(
    context,
    requiredFlag(context.parsed, "knowledge-base", "kb"),
    requiredFlag(context.parsed, "source", "source-id"),
  );
}

function knowledgeExtractionWorker(
  context: KnowledgeCommandContext,
): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxSourcesPerIteration = optionalIntegerFlag(
    context.parsed,
    "max-sources",
  );
  return runKnowledgeExtractionWorker({
    client: {
      knowledge: {
        extractUpload: (knowledgeBaseId, sourceId) =>
          extractUpload(context, knowledgeBaseId, sourceId),
        listSources: (knowledgeBaseId) => listSources(context, knowledgeBaseId),
      },
    },
    intervalMs,
    io: context.io,
    knowledgeBaseId: requiredFlag(context.parsed, "knowledge-base", "kb"),
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxSourcesPerIteration === undefined ? {} : { maxSourcesPerIteration }),
  });
}

async function createUpload(
  context: KnowledgeCommandContext,
  knowledgeBaseId: string,
  body: CreateKnowledgeUploadRequest,
) {
  return (
    await knowledgeCreateUpload({
      body,
      client: generatedClient(context),
      path: { knowledgeBaseId },
      throwOnError: true,
    })
  ).data.data;
}

async function completeUpload(
  context: KnowledgeCommandContext,
  knowledgeBaseId: string,
  sourceId: string,
) {
  return (
    await knowledgeCompleteUpload({
      client: generatedClient(context),
      path: { knowledgeBaseId, sourceId },
      throwOnError: true,
    })
  ).data.data;
}

async function extractUpload(
  context: KnowledgeCommandContext,
  knowledgeBaseId: string,
  sourceId: string,
) {
  return (
    await knowledgeExtractSource({
      client: generatedClient(context),
      path: { knowledgeBaseId, sourceId },
      throwOnError: true,
    })
  ).data.data;
}

async function listSources(
  context: KnowledgeCommandContext,
  knowledgeBaseId: string,
) {
  return (
    await knowledgeListSources({
      client: generatedClient(context),
      path: { knowledgeBaseId },
      throwOnError: true,
    })
  ).data.data;
}

function generatedClient(context: KnowledgeCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

async function result(
  context: KnowledgeCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
