import type { KnowledgeSource } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { createChunksForSource, hashKnowledgeContent } from './knowledge-ingestion'

export async function indexKnowledgeSource(
  repository: RomeoRepository,
  source: KnowledgeSource,
  content: string,
  input: { metadata?: Record<string, unknown> } = {}
): Promise<KnowledgeSource> {
  const chunks = createChunksForSource(source, content, input.metadata)
  const now = new Date().toISOString()
  await repository.deleteKnowledgeChunkEmbeddingsForSource(source.id)
  await repository.deleteKnowledgeChunksForSource(source.id)
  await repository.createKnowledgeChunks(chunks)
  return repository.updateKnowledgeSource({
    ...source,
    status: chunks.length > 0 ? 'indexed' : 'failed',
    chunkCount: chunks.length,
    contentHash: await hashKnowledgeContent(content),
    indexedAt: now,
    updatedAt: now
  })
}
