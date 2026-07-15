import type { AuthSubject } from '@romeo/auth'

import type { KnowledgeChunk, KnowledgeSource } from '../domain/entities'

export function filterKnowledgeSourcesForSubject(sources: KnowledgeSource[], subject: AuthSubject): KnowledgeSource[] {
  return sources.filter((source) => canReadKnowledgeSource(source, subject))
}

export function filterKnowledgeChunksForSources(chunks: KnowledgeChunk[], sources: KnowledgeSource[]): KnowledgeChunk[] {
  const sourceIds = new Set(sources.map((source) => source.id))
  return chunks.filter((chunk) => sourceIds.has(chunk.sourceId))
}

export function canReadKnowledgeSource(source: KnowledgeSource, subject: AuthSubject): boolean {
  const access = sourceAccess(source)
  if (access?.mode !== 'connector_owner') return true
  return subject.isAdmin === true || access.ownerId === subject.id
}

function sourceAccess(source: KnowledgeSource): { mode?: string; ownerId?: string } | undefined {
  const access = source.metadata.sourceAccess
  if (typeof access !== 'object' || access === null || Array.isArray(access)) return undefined
  const value = access as Record<string, unknown>
  const mode = typeof value.mode === 'string' ? value.mode : undefined
  const ownerId = typeof value.ownerId === 'string' ? value.ownerId : undefined
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(ownerId === undefined ? {} : { ownerId })
  }
}
