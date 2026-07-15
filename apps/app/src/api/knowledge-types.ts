import type { BackgroundJob } from './admin-types'

export interface KnowledgeBase {
  id: string
  workspaceId: string
  name: string
  description?: string
  updatedAt: string
}

export interface KnowledgeSource {
  id: string
  knowledgeBaseId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  status: 'pending' | 'indexed' | 'failed'
  objectKey?: string
  metadata: Record<string, unknown>
  chunkCount?: number
  contentHash?: string
  indexedAt?: string
}

export interface RetrievalHit {
  id: string
  content: string
  score: number
  citation: {
    documentId: string
    chunkId: string
    title: string
    sourceUri?: string
  }
  metadata: Record<string, unknown>
}

export interface AgentKnowledgeBinding {
  id: string
  agentId: string
  knowledgeBaseId: string
  enabled: boolean
  knowledgeBase: KnowledgeBase
}

export interface KnowledgeExtractionJobResult {
  job: BackgroundJob
  source: KnowledgeSource
}
