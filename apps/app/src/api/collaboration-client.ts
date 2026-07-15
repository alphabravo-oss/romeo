import { apiJson } from './http'
import type { AgentGalleryItem, Envelope, FolderItemResourceType, ResourceFavorite, ResourceGrant, ShareTarget, WorkspaceFolder, WorkspaceFolderItem } from './types'

export async function shareAgent(input: { agentId: string; principalId: string }): Promise<ResourceGrant[]> {
  return shareAgentAccess({ agentId: input.agentId, principalType: 'group', principalId: input.principalId, permissions: ['read', 'run'] })
}

export async function listShareTargets(query = ''): Promise<ShareTarget[]> {
  const params = new URLSearchParams()
  if (query.trim().length > 0) params.set('query', query.trim())
  params.set('limit', '10')
  const response = await apiJson<Envelope<ShareTarget[]>>(`/api/v1/share-targets?${params.toString()}`)
  return response.data
}

export async function listAgentShares(agentId: string): Promise<ResourceGrant[]> {
  const response = await apiJson<Envelope<ResourceGrant[]>>(`/api/v1/agents/${encodeURIComponent(agentId)}/shares`)
  return response.data
}

export async function shareAgentAccess(input: {
  agentId: string
  principalType: ShareTarget['principalType']
  principalId: string
  permissions: Array<'read' | 'run' | 'write'>
}): Promise<ResourceGrant[]> {
  const response = await apiJson<Envelope<ResourceGrant[]>>(`/api/v1/agents/${encodeURIComponent(input.agentId)}/shares`, {
    method: 'POST',
    body: JSON.stringify({ principalType: input.principalType, principalId: input.principalId, permissions: input.permissions })
  })
  return response.data
}

export async function shareKnowledgeBase(input: { knowledgeBaseId: string; principalId: string }): Promise<ResourceGrant[]> {
  const response = await apiJson<Envelope<ResourceGrant[]>>(`/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/shares`, {
    method: 'POST',
    body: JSON.stringify({ principalType: 'group', principalId: input.principalId, permissions: ['read', 'use'] })
  })
  return response.data
}

export async function shareChat(input: { chatId: string; principalId: string }): Promise<ResourceGrant[]> {
  const response = await apiJson<Envelope<ResourceGrant[]>>(`/api/v1/chats/${encodeURIComponent(input.chatId)}/shares`, {
    method: 'POST',
    body: JSON.stringify({ principalType: 'group', principalId: input.principalId, permissions: ['read', 'write'] })
  })
  return response.data
}

export async function listAgentGallery(workspaceId?: string): Promise<AgentGalleryItem[]> {
  const query = workspaceId === undefined ? '' : `?workspaceId=${encodeURIComponent(workspaceId)}`
  const response = await apiJson<Envelope<AgentGalleryItem[]>>(`/api/v1/agent-gallery${query}`)
  return response.data
}

export async function listFavorites(): Promise<ResourceFavorite[]> {
  const response = await apiJson<Envelope<ResourceFavorite[]>>('/api/v1/favorites')
  return response.data
}

export async function favoriteResource(input: { resourceType: ResourceFavorite['resourceType']; resourceId: string }): Promise<ResourceFavorite> {
  const response = await apiJson<Envelope<ResourceFavorite>>('/api/v1/favorites', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function listFolders(workspaceId: string): Promise<WorkspaceFolder[]> {
  const response = await apiJson<Envelope<WorkspaceFolder[]>>(`/api/v1/folders?workspaceId=${encodeURIComponent(workspaceId)}`)
  return response.data
}

export async function createFolder(input: { workspaceId: string; name: string }): Promise<WorkspaceFolder> {
  const response = await apiJson<Envelope<WorkspaceFolder>>('/api/v1/folders', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function shareFolder(input: { folderId: string; principalId: string }): Promise<ResourceGrant[]> {
  const response = await apiJson<Envelope<ResourceGrant[]>>(`/api/v1/folders/${encodeURIComponent(input.folderId)}/shares`, {
    method: 'POST',
    body: JSON.stringify({ principalType: 'group', principalId: input.principalId, permissions: ['read'] })
  })
  return response.data
}

export async function listFolderItems(folderId: string): Promise<WorkspaceFolderItem[]> {
  const response = await apiJson<Envelope<WorkspaceFolderItem[]>>(`/api/v1/folders/${encodeURIComponent(folderId)}/items`)
  return response.data
}

export async function addFolderItem(input: { folderId: string; resourceType: FolderItemResourceType; resourceId: string }): Promise<WorkspaceFolderItem> {
  const response = await apiJson<Envelope<WorkspaceFolderItem>>(`/api/v1/folders/${encodeURIComponent(input.folderId)}/items`, {
    method: 'POST',
    body: JSON.stringify({ resourceType: input.resourceType, resourceId: input.resourceId })
  })
  return response.data
}
