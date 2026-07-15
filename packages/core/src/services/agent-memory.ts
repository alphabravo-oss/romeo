import type { AgentMemoryPolicy } from '../domain/entities'
import { ApiError } from '../errors'

export const defaultAgentMemoryPolicy: AgentMemoryPolicy = { mode: 'disabled' }

const defaultRecentMessageCount = 6
const maxRecentMessageCount = 20

export function normalizeAgentMemoryPolicy(input: AgentMemoryPolicy | undefined): AgentMemoryPolicy {
  if (input === undefined || input.mode === 'disabled') return defaultAgentMemoryPolicy
  if (input.mode !== 'recent_messages') throw new ApiError('invalid_agent_memory_policy', 'Unsupported agent memory policy mode.', 400)

  const maxMessages = input.maxMessages ?? defaultRecentMessageCount
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > maxRecentMessageCount) {
    throw new ApiError('invalid_agent_memory_policy', `Recent message memory must include between 1 and ${maxRecentMessageCount} messages.`, 400)
  }

  return { mode: 'recent_messages', maxMessages }
}

// History is now unconditional and budget-bounded, so the policy is an optional additional cap
// rather than an on/off switch. Counts messages, not turn pairs, matching the previous slice(-maxMessages).
export function historyMessageLimit(policy: AgentMemoryPolicy): number | undefined {
  const normalized = normalizeAgentMemoryPolicy(policy)
  return normalized.mode === 'recent_messages' ? normalized.maxMessages : undefined
}
