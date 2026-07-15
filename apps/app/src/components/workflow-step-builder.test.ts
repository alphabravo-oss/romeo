import { describe, expect, it } from 'vitest'

import { buildWorkflowSteps, newStepDraft, type StepDraft } from './workflow-step-builder'

function draft(type: StepDraft['type'], patch: Partial<StepDraft>): StepDraft {
  return { ...newStepDraft('k', type), ...patch }
}

describe('buildWorkflowSteps', () => {
  it('rejects an empty step list', () => {
    expect(buildWorkflowSteps([])).toEqual({ ok: false, error: 'Add at least one step.' })
  })

  it('requires a step name', () => {
    const res = buildWorkflowSteps([draft('agent_run', { agentId: 'a1' })])
    expect(res).toEqual({ ok: false, error: 'Step 1: name is required.' })
  })

  it('builds an agent_run step with only its variant fields', () => {
    const res = buildWorkflowSteps([draft('agent_run', { name: 'Run', agentId: 'a1' })])
    expect(res).toEqual({ ok: true, steps: [{ id: 'step_1', name: 'Run', type: 'agent_run', agentId: 'a1' }] })
  })

  it('requires agent_run agentId', () => {
    expect(buildWorkflowSteps([draft('agent_run', { name: 'Run' })])).toEqual({
      ok: false,
      error: 'Step 1: agent id is required.'
    })
  })

  it('parses agent_room ids and enforces 2..5 unique', () => {
    expect(buildWorkflowSteps([draft('agent_room', { name: 'Room', agentIds: 'a1' })])).toEqual({
      ok: false,
      error: 'Step 1: add at least 2 agent ids.'
    })
    expect(buildWorkflowSteps([draft('agent_room', { name: 'Room', agentIds: 'a1, a1' })])).toEqual({
      ok: false,
      error: 'Step 1: agent ids must be unique.'
    })
    const ok = buildWorkflowSteps([draft('agent_room', { name: 'Room', agentIds: 'a1\na2 , a3', roomPrompt: 'go' })])
    expect(ok).toEqual({
      ok: true,
      steps: [{ id: 'step_1', name: 'Room', type: 'agent_room', agentIds: ['a1', 'a2', 'a3'], roomPrompt: 'go' }]
    })
  })

  it('validates browser_task url and task', () => {
    expect(buildWorkflowSteps([draft('browser_task', { name: 'B', targetUrl: 'not-a-url', task: 'do' })])).toEqual({
      ok: false,
      error: 'Step 1: target URL is not a valid URL.'
    })
    expect(buildWorkflowSteps([draft('browser_task', { name: 'B', targetUrl: 'https://x.test', task: '' })])).toEqual({
      ok: false,
      error: 'Step 1: task is required.'
    })
  })

  it('validates tool_approval input keys and includes optional fields', () => {
    expect(
      buildWorkflowSteps([draft('tool_approval', { name: 'T', inputKeys: 'good, bad key' })])
    ).toEqual({ ok: false, error: 'Step 1: invalid input key "bad key".' })

    const ok = buildWorkflowSteps([
      draft('tool_approval', { name: 'T', toolChainName: 'chain', riskLevel: 'high', inputKeys: 'a.b, c_d' })
    ])
    expect(ok).toEqual({
      ok: true,
      steps: [
        {
          id: 'step_1',
          name: 'T',
          type: 'tool_approval',
          toolChainName: 'chain',
          riskLevel: 'high',
          inputKeys: ['a.b', 'c_d']
        }
      ]
    })
  })

  it('rejects a bad agent_handoff source and accepts an earlier step ref', () => {
    expect(
      buildWorkflowSteps([draft('agent_handoff', { name: 'H', agentId: 'a1', handoffFromStepId: 'nope' })])
    ).toEqual({ ok: false, error: 'Step 1: handoff source must be an earlier step.' })

    const ok = buildWorkflowSteps([
      draft('agent_run', { name: 'First', agentId: 'a1' }),
      draft('agent_handoff', { name: 'H', agentId: 'a2', handoffFromStepId: 'step_1', handoffPrompt: 'hand off' })
    ])
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.steps[1]).toEqual({
        id: 'step_2',
        name: 'H',
        type: 'agent_handoff',
        agentId: 'a2',
        handoffFromStepId: 'step_1',
        handoffPrompt: 'hand off'
      })
    }
  })

  it('assigns positional ids and omits empty optional fields', () => {
    const res = buildWorkflowSteps([
      draft('approval', { name: 'Gate' }),
      draft('notification', { name: 'Notify' })
    ])
    expect(res).toEqual({
      ok: true,
      steps: [
        { id: 'step_1', name: 'Gate', type: 'approval' },
        { id: 'step_2', name: 'Notify', type: 'notification' }
      ]
    })
  })
})
