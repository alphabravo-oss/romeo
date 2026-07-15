import type { IndexedChunk, RetrievalHit } from './types'
import { cosineSimilarity, createTextEmbedding } from './embeddings'

export function retrieveFromChunks(chunks: IndexedChunk[], query: string, maxResults = 5): RetrievalHit[] {
  const terms = tokenize(query)
  const queryEmbedding = createTextEmbedding(query)
  if (terms.length === 0 && queryEmbedding.every((value) => value === 0)) return []

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk.content, terms) + vectorScore(chunk, queryEmbedding) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.sequence - right.chunk.sequence)
    .slice(0, maxResults)
    .map(({ chunk, score }) => {
      const citation = { documentId: chunk.sourceId, chunkId: chunk.id, title: chunk.sourceTitle }
      return {
        id: chunk.id,
        content: chunk.content,
        score,
        citation: chunk.sourceUri ? { ...citation, sourceUri: chunk.sourceUri } : citation,
        metadata: chunk.metadata
      }
    })
}

function vectorScore(chunk: IndexedChunk, queryEmbedding: number[]): number {
  if (chunk.embedding === undefined) return 0
  const similarity = cosineSimilarity(chunk.embedding, queryEmbedding)
  return similarity >= 0.35 ? similarity * 0.25 : 0
}

function scoreChunk(content: string, terms: string[]): number {
  const words = tokenize(content)
  if (words.length === 0) return 0
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  const matched = terms.reduce((total, term) => total + (counts.get(term) ?? 0), 0)
  return matched === 0 ? 0 : matched / Math.sqrt(words.length)
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? []
}
