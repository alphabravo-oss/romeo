import type { RetrievalHit } from '@romeo/rag'
import type { AuthSubject } from '@romeo/auth'

import type { AgentSafetySettings } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { inspectPromptInjection, shouldScanPromptInjection, type PromptInjectionCategory } from './agent-safety'
import { retrieveKnowledgeChunks } from './knowledge-ingestion'
import { filterKnowledgeChunksForSources, filterKnowledgeSourcesForSubject } from './knowledge-source-access'
import { retrievePersistedVectorHits } from './knowledge-vector-retrieval'
import type { KnowledgeVectorStore } from './knowledge-vector-store'

export interface RunKnowledgeContext {
  citations: RunKnowledgeCitation[]
  hits: RetrievalHit[]
  safety?: RunKnowledgeSafetySummary
  systemPrompt: string
}

export interface RunKnowledgeSafetySummary {
  promptInjectionCategories: PromptInjectionCategory[]
  promptInjectionSkippedCount: number
}

export interface RunKnowledgeCitation {
  chunkId: string
  documentId: string
  title: string
  sourceUri?: string
}

export async function buildRunKnowledgeContext(
  repository: RomeoRepository,
  input: { agentId: string; fetchImpl?: typeof fetch; query: string; safetySettings?: AgentSafetySettings; subject: AuthSubject; systemPrompt: string; vectorStore?: KnowledgeVectorStore }
): Promise<RunKnowledgeContext> {
  const bindings = (await repository.listAgentKnowledgeBindings(input.agentId)).filter((binding) => binding.enabled)
  const rawHits = (
    await Promise.all(
      bindings.map(async (binding) => {
        const [knowledgeBase, sources, chunks] = await Promise.all([
          repository.getKnowledgeBase(binding.knowledgeBaseId),
          repository.listKnowledgeSources(binding.knowledgeBaseId),
          repository.listKnowledgeChunks(binding.knowledgeBaseId)
        ])
        if (!knowledgeBase || chunks.length === 0) return []
        const visibleSources = filterKnowledgeSourcesForSubject(sources, input.subject)
        const visibleChunks = filterKnowledgeChunksForSources(chunks, visibleSources)
        if (visibleChunks.length === 0) return []
        const vectorHits = await retrievePersistedVectorHits({
          repository,
          subject: input.subject,
          knowledgeBase,
          chunks: visibleChunks,
          sources: visibleSources,
          query: input.query,
          maxResults: 3,
          ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
          ...(input.vectorStore === undefined ? {} : { vectorStore: input.vectorStore })
        })
        const hits = vectorHits.length > 0 ? vectorHits : retrieveKnowledgeChunks(visibleChunks, visibleSources, input.query, 3)
        return hits.map((hit) => ({
          ...hit,
          metadata: { ...hit.metadata, knowledgeBaseId: knowledgeBase.id }
        }))
      })
    )
  )
    .flat()
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
  const { hits, safety } = filterPromptInjectionGuardedHits(rawHits, input.safetySettings)

  if (hits.length === 0) return { citations: [], hits, ...(safety === undefined ? {} : { safety }), systemPrompt: input.systemPrompt }

  const knowledgeContext = hits.map((hit, index) => `[${index + 1}] ${hit.citation.title}: ${hit.content}`).join('\n')
  return {
    citations: hits.map((hit) => hit.citation),
    hits,
    ...(safety === undefined ? {} : { safety }),
    systemPrompt: `${input.systemPrompt}\n\nRomeo knowledge context:\n${knowledgeContext}\n\nUse this context when relevant and cite sources by bracket number.`
  }
}

export function appendRunCitations(content: string, citations: RunKnowledgeCitation[]): string {
  if (content.trim().length === 0 || citations.length === 0) return content
  const citationLines = citations.map((citation, index) => `- [${index + 1}] ${citation.title} (${citation.chunkId})`).join('\n')
  return `${content}\n\nCitations:\n${citationLines}`
}

function filterPromptInjectionGuardedHits(hits: RetrievalHit[], settings: AgentSafetySettings | undefined): { hits: RetrievalHit[]; safety?: RunKnowledgeSafetySummary } {
  if (settings === undefined || !shouldScanPromptInjection(settings, 'retrieved_context')) return { hits }

  const categories = new Set<PromptInjectionCategory>()
  const filteredHits: RetrievalHit[] = []
  let skipped = 0
  for (const hit of hits) {
    const inspection = inspectPromptInjection(hit.content)
    if (inspection.matched) {
      skipped += 1
      inspection.categories.forEach((category) => categories.add(category))
    } else {
      filteredHits.push(hit)
    }
  }

  if (skipped === 0) return { hits: filteredHits }
  return {
    hits: filteredHits,
    safety: {
      promptInjectionCategories: [...categories].sort(),
      promptInjectionSkippedCount: skipped
    }
  }
}
