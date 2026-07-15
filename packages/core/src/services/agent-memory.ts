import type { AgentMemoryPolicy, Message } from '../domain/entities'
import { ApiError } from '../errors'

export const defaultAgentMemoryPolicy: AgentMemoryPolicy = { mode: 'disabled' }

const defaultRecentMessageCount = 6
const maxRecentMessageCount = 20
const maxMemoryMessageChars = 1_000

export function normalizeAgentMemoryPolicy(input: AgentMemoryPolicy | undefined): AgentMemoryPolicy {
  if (input === undefined || input.mode === 'disabled') return defaultAgentMemoryPolicy
  if (input.mode !== 'recent_messages') throw new ApiError('invalid_agent_memory_policy', 'Unsupported agent memory policy mode.', 400)

  const maxMessages = input.maxMessages ?? defaultRecentMessageCount
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > maxRecentMessageCount) {
    throw new ApiError('invalid_agent_memory_policy', `Recent message memory must include between 1 and ${maxRecentMessageCount} messages.`, 400)
  }

  return { mode: 'recent_messages', maxMessages }
}

export function appendAgentMemoryToSystemPrompt(systemPrompt: string, policy: AgentMemoryPolicy, messages: Message[]): string {
  const normalized = normalizeAgentMemoryPolicy(policy)
  if (normalized.mode === 'disabled') return systemPrompt

  const memoryLines = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-(normalized.maxMessages ?? defaultRecentMessageCount))
    .map((message) => `${message.role}: ${compactMessageContent(message.content)}`)
    .filter((line) => !line.endsWith(': '))

  if (memoryLines.length === 0) return systemPrompt
  return `${systemPrompt}\n\nRomeo chat memory:\n${memoryLines.join('\n')}\n\nUse this prior chat context only when relevant.`
}

function compactMessageContent(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > maxMemoryMessageChars ? `${normalized.slice(0, maxMemoryMessageChars)}...` : normalized
}
