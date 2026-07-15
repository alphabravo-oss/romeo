import { apiJson } from './http'
import type { AgentKnowledgeBinding, Envelope, KnowledgeBase, KnowledgeExtractionJobResult, KnowledgeSource, RetrievalHit } from './types'

export async function listKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]> {
  const response = await apiJson<Envelope<KnowledgeBase[]>>(`/api/v1/knowledge-bases?workspaceId=${encodeURIComponent(workspaceId)}`)
  return response.data
}

export async function createKnowledgeBase(input: { workspaceId: string; name: string; description?: string }): Promise<KnowledgeBase> {
  const response = await apiJson<Envelope<KnowledgeBase>>('/api/v1/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function listKnowledgeSources(knowledgeBaseId: string): Promise<KnowledgeSource[]> {
  const response = await apiJson<Envelope<KnowledgeSource[]>>(`/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sources`)
  return response.data
}

export async function deleteKnowledgeSource(input: { knowledgeBaseId: string; sourceId: string }): Promise<KnowledgeSource> {
  const response = await apiJson<Envelope<KnowledgeSource>>(
    `/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/sources/${encodeURIComponent(input.sourceId)}`,
    { method: 'DELETE' }
  )
  return response.data
}

export async function reindexKnowledgeSource(input: { knowledgeBaseId: string; sourceId: string; content: string; sizeBytes: number }): Promise<KnowledgeSource> {
  const response = await apiJson<Envelope<KnowledgeSource>>(
    `/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/sources/${encodeURIComponent(input.sourceId)}/reindex`,
    { method: 'POST', body: JSON.stringify({ content: input.content, sizeBytes: input.sizeBytes }) }
  )
  return response.data
}

export async function extractKnowledgeSource(input: { knowledgeBaseId: string; sourceId: string }): Promise<KnowledgeExtractionJobResult> {
  const response = await apiJson<Envelope<KnowledgeExtractionJobResult>>(
    `/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/sources/${encodeURIComponent(input.sourceId)}/extract`,
    { method: 'POST' }
  )
  return response.data
}

export async function createKnowledgeSource(input: {
  knowledgeBaseId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  content?: string
}): Promise<KnowledgeSource> {
  const response = await apiJson<Envelope<KnowledgeSource>>(`/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/sources`, {
    method: 'POST',
    body: JSON.stringify({ fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, content: input.content })
  })
  return response.data
}

export async function queryKnowledgeBase(input: { knowledgeBaseId: string; query: string }): Promise<RetrievalHit[]> {
  const response = await apiJson<Envelope<RetrievalHit[]>>(`/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/query`, {
    method: 'POST',
    body: JSON.stringify({ query: input.query })
  })
  return response.data
}

export async function listAgentKnowledgeBindings(agentId: string): Promise<AgentKnowledgeBinding[]> {
  const response = await apiJson<Envelope<AgentKnowledgeBinding[]>>(`/api/v1/agents/${encodeURIComponent(agentId)}/knowledge-bases`)
  return response.data
}

export async function updateAgentKnowledgeBinding(input: {
  agentId: string
  enabled: boolean
  knowledgeBaseId: string
}): Promise<AgentKnowledgeBinding> {
  const response = await apiJson<Envelope<AgentKnowledgeBinding>>(
    `/api/v1/agents/${encodeURIComponent(input.agentId)}/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}`,
    { method: 'PATCH', body: JSON.stringify({ enabled: input.enabled }) }
  )
  return response.data
}
