import {
  knowledgeCompareTieredReplay,
  knowledgeCompleteUpload,
  knowledgeCreateBase,
  knowledgeCreateSource,
  knowledgeCreateUpload,
  knowledgeDeleteSource,
  knowledgeExtractSource,
  knowledgeIndexEmbeddings,
  knowledgeQueryBase,
  knowledgeQueryTiered,
  knowledgeReindexSource,
  knowledgeReplayTiered,
  knowledgeUpdateBase,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  KnowledgeBase,
  KnowledgeEmbeddingIndexResult,
  KnowledgeExtractionJobResult,
  KnowledgeRetrievalReplayComparisonReport,
  KnowledgeRetrievalReplayReport,
  KnowledgeSource,
  KnowledgeUploadRegistration,
  RetrievalHit,
  TieredKnowledgeQueryResult,
} from "./types";

export async function createKnowledgeBase(
  input: Parameters<typeof knowledgeCreateBase>[0]["body"],
): Promise<KnowledgeBase> {
  configureBrowserApiClients();
  const response = await knowledgeCreateBase({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateKnowledgeBase(
  knowledgeBaseId: string,
  input: Parameters<typeof knowledgeUpdateBase>[0]["body"],
): Promise<KnowledgeBase> {
  configureBrowserApiClients();
  const response = await knowledgeUpdateBase({
    path: { knowledgeBaseId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createKnowledgeSource(input: {
  knowledgeBaseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content?: string;
}): Promise<KnowledgeSource> {
  configureBrowserApiClients();
  const { knowledgeBaseId, ...body } = input;
  const response = await knowledgeCreateSource({
    path: { knowledgeBaseId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createKnowledgeUpload(input: {
  knowledgeBaseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<KnowledgeUploadRegistration> {
  configureBrowserApiClients();
  const { knowledgeBaseId, ...body } = input;
  const response = await knowledgeCreateUpload({
    path: { knowledgeBaseId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function completeKnowledgeUpload(input: {
  knowledgeBaseId: string;
  sourceId: string;
}): Promise<KnowledgeSource> {
  configureBrowserApiClients();
  const response = await knowledgeCompleteUpload({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteKnowledgeSource(input: {
  knowledgeBaseId: string;
  sourceId: string;
}): Promise<KnowledgeSource> {
  configureBrowserApiClients();
  const response = await knowledgeDeleteSource({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function reindexKnowledgeSource(input: {
  knowledgeBaseId: string;
  sourceId: string;
  content: string;
  sizeBytes?: number;
}): Promise<KnowledgeSource> {
  configureBrowserApiClients();
  const { knowledgeBaseId, sourceId, ...body } = input;
  const response = await knowledgeReindexSource({
    path: { knowledgeBaseId, sourceId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function extractKnowledgeSource(input: {
  knowledgeBaseId: string;
  sourceId: string;
}): Promise<KnowledgeExtractionJobResult> {
  configureBrowserApiClients();
  const response = await knowledgeExtractSource({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function indexKnowledgeEmbeddings(input: {
  knowledgeBaseId: string;
  providerId: string;
  model: string;
  batchSize?: number;
}): Promise<KnowledgeEmbeddingIndexResult> {
  configureBrowserApiClients();
  const { knowledgeBaseId, ...body } = input;
  const response = await knowledgeIndexEmbeddings({
    path: { knowledgeBaseId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function queryKnowledgeBase(input: {
  knowledgeBaseId: string;
  query: string;
  maxResults?: number;
}): Promise<RetrievalHit[]> {
  configureBrowserApiClients();
  const { knowledgeBaseId, ...body } = input;
  const response = await knowledgeQueryBase({
    path: { knowledgeBaseId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function queryTieredKnowledge(
  input: Parameters<typeof knowledgeQueryTiered>[0]["body"],
): Promise<TieredKnowledgeQueryResult> {
  configureBrowserApiClients();
  const response = await knowledgeQueryTiered({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function replayTieredKnowledge(
  input: Parameters<typeof knowledgeReplayTiered>[0]["body"],
): Promise<KnowledgeRetrievalReplayReport> {
  configureBrowserApiClients();
  const response = await knowledgeReplayTiered({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function compareTieredKnowledgeReplay(
  input: Parameters<typeof knowledgeCompareTieredReplay>[0]["body"],
): Promise<KnowledgeRetrievalReplayComparisonReport> {
  configureBrowserApiClients();
  const response = await knowledgeCompareTieredReplay({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
