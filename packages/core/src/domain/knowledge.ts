export interface KnowledgeBase {
  id: string
  orgId: string
  workspaceId: string
  name: string
  description?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface KnowledgeSource {
  id: string
  knowledgeBaseId: string
  orgId: string
  workspaceId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  status: 'pending' | 'indexed' | 'failed'
  objectKey?: string
  metadata: Record<string, unknown>
  chunkCount?: number
  contentHash?: string
  indexedAt?: string
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunk {
  id: string
  knowledgeBaseId: string
  sourceId: string
  orgId: string
  workspaceId: string
  sequence: number
  content: string
  tokenCount: number
  metadata: Record<string, unknown>
  createdAt: string
}

export interface KnowledgeChunkEmbedding {
  id: string
  knowledgeBaseId: string
  sourceId: string
  chunkId: string
  orgId: string
  workspaceId: string
  embeddingProvider: string
  embeddingModel: string
  dimensions: number
  embedding: number[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunkEmbeddingSearchHit {
  embedding: KnowledgeChunkEmbedding
  score: number
}

export interface AgentKnowledgeBinding {
  id: string
  orgId: string
  agentId: string
  knowledgeBaseId: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}
