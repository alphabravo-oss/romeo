import {
  canExtractKnowledgeText,
  chunkText,
  createTextEmbedding,
  extractKnowledgeText,
  KnowledgeExtractionError,
  retrieveFromChunks,
  type ExtractedKnowledgeText,
  type IndexedChunk,
  type RetrievalHit
} from '@romeo/rag'

import type { KnowledgeChunk, KnowledgeSource } from '../domain/entities'
import { ApiError } from '../errors'
import { createId } from '../ids'

export function canIngestInlineText(mimeType: string): boolean {
  return canExtractKnowledgeText(mimeType)
}

export function extractKnowledgeSourceBytes(bytes: Uint8Array, mimeType: string): ExtractedKnowledgeText {
  try {
    return extractKnowledgeText({ bytes, mimeType })
  } catch (error) {
    if (error instanceof KnowledgeExtractionError) {
      throw new ApiError(error.code, error.message, error.code === 'unsupported_media_type' ? 415 : 400, error.details)
    }
    throw error
  }
}

export function extractInlineKnowledgeContent(content: string, mimeType: string): ExtractedKnowledgeText {
  return extractKnowledgeSourceBytes(new TextEncoder().encode(content), mimeType)
}

export function createChunksForSource(source: KnowledgeSource, content: string, metadata: Record<string, unknown> = {}): KnowledgeChunk[] {
  const chunks = chunkText(content)
  return chunks.map((chunk, index) => ({
    id: createId('kb_chunk'),
    knowledgeBaseId: source.knowledgeBaseId,
    sourceId: source.id,
    orgId: source.orgId,
    workspaceId: source.workspaceId,
    sequence: index + 1,
    content: chunk,
    tokenCount: estimateTokens(chunk),
    metadata: { fileName: source.fileName, mimeType: source.mimeType, embedding: createTextEmbedding(chunk), ...metadata },
    createdAt: new Date().toISOString()
  }))
}

export async function hashKnowledgeContent(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function retrieveKnowledgeChunks(
  chunks: KnowledgeChunk[],
  sources: KnowledgeSource[],
  query: string,
  maxResults?: number
): RetrievalHit[] {
  return retrieveFromChunks(toIndexedKnowledgeChunks(chunks, sources), query, maxResults)
}

export function toIndexedKnowledgeChunks(chunks: KnowledgeChunk[], sources: KnowledgeSource[]): IndexedChunk[] {
  const bySourceId = new Map(sources.map((source) => [source.id, source]))
  return chunks.map((chunk): IndexedChunk => {
    const source = bySourceId.get(chunk.sourceId)
    const { embedding: _embedding, ...metadata } = chunk.metadata
    const embedding = readEmbedding(chunk.metadata.embedding)
    const indexedChunk = {
      id: chunk.id,
      sourceId: chunk.sourceId,
      sourceTitle: source?.fileName ?? chunk.sourceId,
      sequence: chunk.sequence,
      content: chunk.content,
      metadata
    }
    const withEmbedding = embedding === undefined ? indexedChunk : { ...indexedChunk, embedding }
    return source?.objectKey ? { ...withEmbedding, sourceUri: source.objectKey } : withEmbedding
  })
}

export function retrievalHitFromIndexedChunk(chunk: IndexedChunk, score: number): RetrievalHit {
  const citation = { documentId: chunk.sourceId, chunkId: chunk.id, title: chunk.sourceTitle }
  return {
    id: chunk.id,
    content: chunk.content,
    score,
    citation: chunk.sourceUri ? { ...citation, sourceUri: chunk.sourceUri } : citation,
    metadata: chunk.metadata
  }
}

function readEmbedding(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'number') ? value : undefined
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}
