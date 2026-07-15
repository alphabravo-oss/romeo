import { describe, expect, it } from 'vitest'

import { toKnowledgeChunkEmbeddingInsertValue, toKnowledgeChunkEmbeddingRecord, type KnowledgeChunkEmbeddingRecord } from './knowledge-embedding-repository'
import { toPgVectorLiteral } from './vector-search'

describe('pgvector search helpers', () => {
  it('formats finite vectors for pgvector query parameters', () => {
    expect(toPgVectorLiteral([0, -0, 1.25, -2], 4)).toBe('[0,0,1.25,-2]')
  })

  it('rejects dimension mismatches before SQL construction', () => {
    expect(() => toPgVectorLiteral([0, 1], 3)).toThrow('Expected 3 vector dimensions')
  })

  it('rejects non-finite vector values before SQL construction', () => {
    expect(() => toPgVectorLiteral([0, Number.NaN], 2)).toThrow('finite numbers')
    expect(() => toPgVectorLiteral([0, Number.POSITIVE_INFINITY], 2)).toThrow('finite numbers')
  })

  it('maps knowledge embedding rows to repository records without leaking Date objects', () => {
    const record = toKnowledgeChunkEmbeddingRecord({
      id: 'embedding_1',
      knowledgeBaseId: 'kb_1',
      sourceId: 'source_1',
      chunkId: 'chunk_1',
      orgId: 'org_1',
      workspaceId: 'workspace_1',
      embeddingProvider: 'provider_1',
      embeddingModel: 'text-embedding',
      dimensions: 3,
      embedding: [1, 0, 0],
      metadata: { chunkSequence: 1 },
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
      updatedAt: new Date('2026-06-27T00:01:00.000Z')
    })

    expect(record.createdAt).toBe('2026-06-27T00:00:00.000Z')
    expect(record.updatedAt).toBe('2026-06-27T00:01:00.000Z')
    expect(record.metadata).toEqual({ chunkSequence: 1 })
  })

  it('maps knowledge embedding records to insert values with Date timestamps', () => {
    const insert = toKnowledgeChunkEmbeddingInsertValue({
      id: 'embedding_1',
      knowledgeBaseId: 'kb_1',
      sourceId: 'source_1',
      chunkId: 'chunk_1',
      orgId: 'org_1',
      workspaceId: 'workspace_1',
      embeddingProvider: 'provider_1',
      embeddingModel: 'text-embedding',
      dimensions: 3,
      embedding: [1, 0, 0],
      metadata: {},
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:01:00.000Z'
    } satisfies KnowledgeChunkEmbeddingRecord)

    expect(insert.createdAt).toEqual(new Date('2026-06-27T00:00:00.000Z'))
    expect(insert.updatedAt).toEqual(new Date('2026-06-27T00:01:00.000Z'))
  })
})
