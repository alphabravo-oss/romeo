import { describe, expect, it } from 'vitest'

import { cosineSimilarity, createTextEmbedding } from './embeddings'
import { retrieveFromChunks } from './retrieve'

describe('local text embeddings', () => {
  it('creates deterministic normalized vectors', () => {
    const left = createTextEmbedding('Romeo quota controls')
    const right = createTextEmbedding('Romeo quota controls')

    expect(left).toHaveLength(32)
    expect(left).toEqual(right)
    expect(cosineSimilarity(left, right)).toBeGreaterThan(0.99)
  })

  it('uses embeddings as part of retrieval scoring', () => {
    const hits = retrieveFromChunks(
      [
        {
          id: 'chunk_b',
          sourceId: 'source_b',
          sourceTitle: 'B',
          sequence: 2,
          content: 'Unrelated calendar notes.',
          embedding: createTextEmbedding('Unrelated calendar notes.'),
          metadata: {}
        },
        {
          id: 'chunk_a',
          sourceId: 'source_a',
          sourceTitle: 'A',
          sequence: 1,
          content: 'Romeo quota controls and usage alerts.',
          embedding: createTextEmbedding('Romeo quota controls and usage alerts.'),
          metadata: {}
        }
      ],
      'quota usage alerts'
    )

    expect(hits[0]?.id).toBe('chunk_a')
  })
})
