export interface RetrievalQuery {
  orgId: string
  workspaceId: string
  agentId?: string
  query: string
  maxResults?: number
}

export interface RetrievalCitation {
  documentId: string
  chunkId: string
  title: string
  sourceUri?: string
}

export interface RetrievalHit {
  id: string
  content: string
  score: number
  citation: RetrievalCitation
  metadata: Record<string, unknown>
}

export interface IndexedChunk {
  id: string
  sourceId: string
  sourceTitle: string
  sourceUri?: string
  sequence: number
  content: string
  embedding?: number[]
  metadata: Record<string, unknown>
}

export interface RagProvider {
  retrieve(query: RetrievalQuery): Promise<RetrievalHit[]>
}
