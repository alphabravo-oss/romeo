import type { AgentVersion } from '../domain/entities'

export interface AgentVersionDiffChange {
  field: 'baseModelId' | 'knowledgeBaseBindings' | 'memoryPolicy' | 'safetySettings' | 'systemPrompt' | 'parameters' | 'toolBindings' | 'voiceProfileId'
  left: unknown
  right: unknown
}

export interface AgentVersionDiff {
  agentId: string
  leftVersionId: string
  rightVersionId: string
  changes: AgentVersionDiffChange[]
}

export function diffAgentVersions(left: AgentVersion, right: AgentVersion): AgentVersionDiff {
  const changes: AgentVersionDiffChange[] = []

  pushChange(changes, 'baseModelId', left.baseModelId, right.baseModelId)
  pushChange(changes, 'systemPrompt', left.systemPrompt, right.systemPrompt)
  pushChange(changes, 'parameters', left.parameters, right.parameters)
  pushChange(changes, 'memoryPolicy', left.memoryPolicy, right.memoryPolicy)
  pushChange(changes, 'safetySettings', left.safetySettings, right.safetySettings)
  pushChange(changes, 'voiceProfileId', left.voiceProfileId, right.voiceProfileId)
  pushChange(changes, 'knowledgeBaseBindings', left.knowledgeBaseBindings ?? [], right.knowledgeBaseBindings ?? [])
  pushChange(changes, 'toolBindings', left.toolBindings ?? [], right.toolBindings ?? [])

  return {
    agentId: left.agentId,
    leftVersionId: left.id,
    rightVersionId: right.id,
    changes
  }
}

function pushChange(changes: AgentVersionDiffChange[], field: AgentVersionDiffChange['field'], left: unknown, right: unknown) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    changes.push({ field, left, right })
  }
}
