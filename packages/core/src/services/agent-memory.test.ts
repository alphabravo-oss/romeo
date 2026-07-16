import { describe, expect, it } from 'vitest'

import type { AgentMemoryPolicy } from '../domain/entities'
import { ApiError } from '../errors'
import { defaultAgentMemoryPolicy, historyMessageLimit, normalizeAgentMemoryPolicy } from './agent-memory'

describe('normalizeAgentMemoryPolicy', () => {
  it('collapses undefined and disabled to the default policy', () => {
    expect(normalizeAgentMemoryPolicy(undefined)).toEqual(defaultAgentMemoryPolicy)
    expect(normalizeAgentMemoryPolicy({ mode: 'disabled' })).toEqual(defaultAgentMemoryPolicy)
    expect(defaultAgentMemoryPolicy).toEqual({ mode: 'disabled' })
  })

  it('materializes the default recent message count', () => {
    expect(normalizeAgentMemoryPolicy({ mode: 'recent_messages' })).toEqual({ mode: 'recent_messages', maxMessages: 6 })
  })

  it('preserves an in-range explicit count', () => {
    expect(normalizeAgentMemoryPolicy({ mode: 'recent_messages', maxMessages: 2 })).toEqual({ mode: 'recent_messages', maxMessages: 2 })
  })

  it.each([
    ['zero', 0],
    ['above the maximum', 21],
    ['fractional', 1.5]
  ])('rejects a %s message count', (_label, maxMessages) => {
    expect(() => normalizeAgentMemoryPolicy({ mode: 'recent_messages', maxMessages })).toThrowError(ApiError)

    try {
      normalizeAgentMemoryPolicy({ mode: 'recent_messages', maxMessages })
      expect.unreachable('expected an invalid policy to throw')
    } catch (error) {
      const apiError = error as ApiError
      expect(apiError.code).toBe('invalid_agent_memory_policy')
      expect(apiError.status).toBe(400)
    }
  })

  it('rejects an unsupported mode', () => {
    const policy = { mode: 'bogus' } as unknown as AgentMemoryPolicy

    expect(() => normalizeAgentMemoryPolicy(policy)).toThrowError(ApiError)
  })
})

describe('historyMessageLimit', () => {
  it('returns the message cap for recent_messages', () => {
    expect(historyMessageLimit({ mode: 'recent_messages', maxMessages: 4 })).toBe(4)
    expect(historyMessageLimit({ mode: 'recent_messages' })).toBe(6)
  })

  it('returns undefined for disabled, so history is bounded only by the context budget', () => {
    expect(historyMessageLimit({ mode: 'disabled' })).toBeUndefined()
  })
})
