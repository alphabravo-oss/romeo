import type { ToolDefinition } from '@romeo/tools'

import type { Agent, AgentToolBinding } from '../domain/entities'

export interface ToolSummary {
  id: string
  name: string
  description: string
  riskLevel: string
  approvalPolicy: string
  requiredScopes: string[]
  timeoutMs: number
}

export interface AgentToolSummary extends ToolSummary {
  agentId: string
  bound: boolean
  enabled: boolean
  approvalRequired: boolean
  hasAccess: boolean
}

export function toToolSummary(tool: ToolDefinition): ToolSummary {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    riskLevel: tool.riskLevel,
    approvalPolicy: tool.approvalPolicy,
    requiredScopes: tool.requiredScopes,
    timeoutMs: tool.timeoutMs
  }
}

export function toAgentToolSummary(
  tool: ToolDefinition,
  agent: Agent,
  binding: AgentToolBinding | undefined,
  hasAccess: boolean
): AgentToolSummary {
  return {
    ...toToolSummary(tool),
    agentId: agent.id,
    bound: binding !== undefined,
    enabled: binding?.enabled === true,
    approvalRequired: binding?.approvalRequired === true,
    hasAccess
  }
}

export function toolAuditMetadata(
  tool: ToolDefinition,
  input: unknown,
  agentId: string,
  binding: AgentToolBinding | undefined
): Record<string, unknown> {
  return {
    agentId,
    riskLevel: tool.riskLevel,
    approvalPolicy: tool.approvalPolicy,
    bindingId: binding?.id,
    bound: binding !== undefined,
    enabled: binding?.enabled === true,
    approvalRequired: binding?.approvalRequired === true,
    inputKeys: objectKeys(input)
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Tool execution timed out.')), timeoutMs)
    })
  ])
}

export function objectKeys(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.keys(value).sort()
}
