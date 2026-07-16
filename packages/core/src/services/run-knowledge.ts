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
  knowledgeContext?: string
  safety?: RunKnowledgeSafetySummary
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
  input: { agentId: string; fetchImpl?: typeof fetch; query: string; safetySettings?: AgentSafetySettings; subject: AuthSubject; vectorStore?: KnowledgeVectorStore }
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

  const knowledgeContext = renderKnowledgeContext(hits)
  return {
    citations: hits.map((hit) => hit.citation),
    hits,
    ...(knowledgeContext === undefined ? {} : { knowledgeContext }),
    ...(safety === undefined ? {} : { safety })
  }
}

// Exported so bracket numbering has one owner: the budget may shed hits after retrieval, and a
// second renderer would desync the numbers from the citations array.
export function renderKnowledgeContext(hits: RetrievalHit[]): string | undefined {
  if (hits.length === 0) return undefined
  return hits.map((hit, index) => `[${index + 1}] ${hit.citation.title}: ${hit.content}`).join('\n')
}

// Retrieved context rides the user turn, not the system prompt: that keeps messages[0] byte-stable
// for the life of the agent version, which is what provider prompt caching keys on.
export function knowledgeUserContent(knowledgeContext: string | undefined, userContent: string): string {
  if (knowledgeContext === undefined) return userContent
  return `Romeo knowledge context:\n${knowledgeContext}\n\nUse this context when relevant and cite sources by bracket number.\n\n${userContent}`
}

export function appendRunCitations(content: string, citations: RunKnowledgeCitation[]): string {
  if (content.trim().length === 0 || citations.length === 0) return content
  const citationLines = citations.map((citation, index) => `- [${index + 1}] ${citation.title} (${citation.chunkId})`).join('\n')
  return `${content}\n\nCitations:\n${citationLines}`
}

// End-anchored so it can only match what appendRunCitations produces; a pathological title simply
// fails to match and leaves the footer intact rather than truncating real assistant content.
const runCitationFooter = /\n\nCitations:\n(?:- \[\d+\] [^\n]*\n?)+$/

export function stripRunCitations(content: string): string {
  return content.replace(runCitationFooter, '')
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
