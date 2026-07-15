import { pathId, withQuery } from '../path'
import type { RomeoTransport } from '../transport'
import type {
  Agent,
  AgentExportDocument,
  AgentKnowledgeBinding,
  AgentVersion,
  AgentVersionDiff,
  CloneAgentInput,
  CreateAgentInput,
  ImportAgentInput,
  UpdateAgentInput,
  UpdateAgentKnowledgeBindingInput
} from '../types'

export function createAgentResource(transport: RomeoTransport) {
  return {
    list: (workspaceId?: string) => transport.data<Agent[]>('GET', withQuery('/api/v1/agents', { workspaceId })),
    get: (agentId: string) => transport.data<Agent>('GET', `/api/v1/agents/${pathId(agentId)}`),
    create: (input: CreateAgentInput) => transport.data<Agent>('POST', '/api/v1/agents', input),
    update: (agentId: string, input: UpdateAgentInput) => transport.data<Agent>('PATCH', `/api/v1/agents/${pathId(agentId)}`, input),
    clone: (agentId: string, input: CloneAgentInput = {}) => transport.data<Agent>('POST', `/api/v1/agents/${pathId(agentId)}/clone`, input),
    exportAgent: (agentId: string) => transport.data<AgentExportDocument>('GET', `/api/v1/agents/${pathId(agentId)}/export`),
    importAgent: (input: ImportAgentInput) => transport.data<Agent>('POST', '/api/v1/agents/import', input),
    knowledgeBindings: (agentId: string) => transport.data<AgentKnowledgeBinding[]>('GET', `/api/v1/agents/${pathId(agentId)}/knowledge-bases`),
    updateKnowledgeBinding: (agentId: string, knowledgeBaseId: string, input: UpdateAgentKnowledgeBindingInput) =>
      transport.data<AgentKnowledgeBinding>('PATCH', `/api/v1/agents/${pathId(agentId)}/knowledge-bases/${pathId(knowledgeBaseId)}`, input),
    versions: (agentId: string) => transport.data<AgentVersion[]>('GET', `/api/v1/agents/${pathId(agentId)}/versions`),
    publish: (agentId: string) => transport.data<AgentVersion>('POST', `/api/v1/agents/${pathId(agentId)}/versions`),
    diffVersions: (agentId: string, leftVersionId: string, rightVersionId: string) =>
      transport.data<AgentVersionDiff>(
        'GET',
        withQuery(`/api/v1/agents/${pathId(agentId)}/versions/${pathId(leftVersionId)}/diff`, { compareTo: rightVersionId })
      ),
    rollback: (agentId: string, versionId: string) =>
      transport.data<Agent>('POST', `/api/v1/agents/${pathId(agentId)}/versions/${pathId(versionId)}/rollback`)
  }
}
