import { describe, expect, it } from 'vitest'

import { flagValue, parseArgs } from './args'

describe('parseArgs', () => {
  it('parses nested commands and flags', () => {
    const parsed = parseArgs(['chat', 'run', '--workspace=ws_1', '--agent', 'agent_1', '--json'])

    expect(parsed.positionals).toEqual(['chat', 'run'])
    expect(flagValue(parsed.flags, 'workspace')).toBe('ws_1')
    expect(flagValue(parsed.flags, 'agent')).toBe('agent_1')
    expect(parsed.flags.json).toBe(true)
  })
})
