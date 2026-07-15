import { apiJson } from './http'
import type { Agent, AgentMemoryPolicy, AgentSafetySettings, AgentVersion, AgentVersionDiff, Envelope } from './types'

export async function listAgents(workspaceId: string): Promise<Agent[]> {
  const response = await apiJson<Envelope<Agent[]>>(`/api/v1/agents?workspaceId=${encodeURIComponent(workspaceId)}`)
  return response.data
}

export async function cloneAgent(input: { agentId: string; name?: string; systemPrompt?: string }): Promise<Agent> {
  const response = await apiJson<Envelope<Agent>>(`/api/v1/agents/${encodeURIComponent(input.agentId)}/clone`, {
    method: 'POST',
    body: JSON.stringify({ name: input.name, systemPrompt: input.systemPrompt })
  })
  return response.data
}

export async function updateAgent(input: {
  agentId: string
  name?: string
  baseModelId?: string
  systemPrompt?: string
  parameters?: Record<string, unknown>
  memoryPolicy?: AgentMemoryPolicy
  safetySettings?: AgentSafetySettings
}): Promise<Agent> {
  const response = await apiJson<Envelope<Agent>>(`/api/v1/agents/${encodeURIComponent(input.agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: input.name,
      baseModelId: input.baseModelId,
      systemPrompt: input.systemPrompt,
      parameters: input.parameters,
      memoryPolicy: input.memoryPolicy,
      safetySettings: input.safetySettings
    })
  })
  return response.data
}

export async function listAgentVersions(agentId: string): Promise<AgentVersion[]> {
  const response = await apiJson<Envelope<AgentVersion[]>>(`/api/v1/agents/${encodeURIComponent(agentId)}/versions`)
  return response.data
}

export async function publishAgent(agentId: string): Promise<AgentVersion> {
  const response = await apiJson<Envelope<AgentVersion>>(`/api/v1/agents/${encodeURIComponent(agentId)}/versions`, {
    method: 'POST'
  })
  return response.data
}

export async function rollbackAgentVersion(input: { agentId: string; versionId: string }): Promise<Agent> {
  const agentId = encodeURIComponent(input.agentId)
  const versionId = encodeURIComponent(input.versionId)
  const response = await apiJson<Envelope<Agent>>(`/api/v1/agents/${agentId}/versions/${versionId}/rollback`, {
    method: 'POST'
  })
  return response.data
}

export async function diffAgentVersions(input: {
  agentId: string
  leftVersionId: string
  rightVersionId: string
}): Promise<AgentVersionDiff> {
  const agentId = encodeURIComponent(input.agentId)
  const leftVersionId = encodeURIComponent(input.leftVersionId)
  const rightVersionId = encodeURIComponent(input.rightVersionId)
  const response = await apiJson<Envelope<AgentVersionDiff>>(
    `/api/v1/agents/${agentId}/versions/${leftVersionId}/diff?compareTo=${rightVersionId}`
  )
  return response.data
}
