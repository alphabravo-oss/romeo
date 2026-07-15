import { apiJson } from './http'
import type { Bootstrap, Envelope, Workspace } from './types'

export interface WorkspaceExportDocument {
  schema: 'romeo.workspace-export.v1'
  orgId: string
  workspace: Workspace
  counts: {
    agents: number
    chats: number
    messages: number
    knowledgeBases: number
    dataConnectors: number
    workflows: number
  }
  exportedAt: string
}

export async function getBootstrap(): Promise<Bootstrap> {
  return apiJson<Bootstrap>('/api/v1/me')
}

/** Update the current user's own profile. Only provided fields change. */
export async function updateMyProfile(input: { name?: string; email?: string }): Promise<void> {
  await apiJson<Envelope<unknown>>('/api/v1/me', { method: 'PATCH', body: JSON.stringify(input) })
}

export async function logout(): Promise<void> {
  await fetch('/api/v1/sessions/current', { method: 'DELETE', credentials: 'include' })
}

export async function archiveWorkspace(workspaceId: string): Promise<Workspace> {
  const response = await apiJson<Envelope<Workspace>>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/archive`, {
    method: 'POST'
  })
  return response.data
}

export async function exportWorkspace(workspaceId: string): Promise<WorkspaceExportDocument> {
  const response = await apiJson<Envelope<WorkspaceExportDocument>>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/export`)
  return response.data
}
