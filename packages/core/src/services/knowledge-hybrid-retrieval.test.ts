import { describe, expect, it } from 'vitest'
import type { RetrievalHit } from '@romeo/rag'

import { mergeHybridRetrievalHits } from './knowledge-hybrid-retrieval'

describe('hybrid knowledge retrieval', () => {
  it('rank-fuses vector and lexical channels without relying on raw score scale', () => {
    const merged = mergeHybridRetrievalHits({
      maxResults: 3,
      vectorHits: [hit('vector-only', 0.95), hit('shared', 0.75)],
      lexicalHits: [hit('shared', 10), hit('lexical-only', 9)]
    })

    expect(merged.map((item) => item.id)).toEqual(['shared', 'vector-only', 'lexical-only'])
    expect(merged[0]?.score).toBeGreaterThan(merged[1]?.score ?? 0)
    expect(merged[0]?.score).toBeLessThan(10)
  })

  it('keeps result limits and deterministic tie breaking stable', () => {
    const merged = mergeHybridRetrievalHits({
      maxResults: 2,
      vectorHits: [hit('b', 0.5), hit('c', 0.5)],
      lexicalHits: [hit('a', 0.5), hit('d', 0.5)]
    })

    expect(merged.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

function hit(id: string, score: number): RetrievalHit {
  return {
    id,
    content: `${id} content`,
    score,
    citation: { documentId: `source_${id}`, chunkId: id, title: `${id}.txt` },
    metadata: {}
  }
}
