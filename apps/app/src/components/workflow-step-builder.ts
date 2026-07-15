// Pure build/validate logic for the workflow step builder. Kept UI-free so it
// can be unit-tested. Mirrors packages/core workflowStepSchema (discriminated
// union on `type`) — we build each step with only its variant's fields set and
// let the backend's non-strict z.object drop anything else.

import type { WorkflowStep, WorkflowStepType } from '../api/workflows-types'

export interface StepDraft {
  key: string
  type: WorkflowStepType
  name: string
  agentId: string
  agentIds: string // comma/newline separated (agent_room)
  handoffFromStepId: string // e.g. "step_1" (agent_handoff)
  handoffPrompt: string
  roomPrompt: string
  approvalPrompt: string
  toolChainName: string
  riskLevel: '' | 'high' | 'low' | 'medium'
  inputKeys: string // comma/newline separated (tool_approval)
  targetUrl: string
  task: string
  message: string
}

export const STEP_TYPE_OPTIONS: { value: WorkflowStepType; label: string }[] = [
  { value: 'agent_run', label: 'Agent run' },
  { value: 'agent_handoff', label: 'Agent handoff' },
  { value: 'agent_room', label: 'Agent room' },
  { value: 'approval', label: 'Approval gate' },
  { value: 'tool_approval', label: 'Tool approval' },
  { value: 'browser_task', label: 'Browser task' },
  { value: 'notification', label: 'Notification' }
]

export function newStepDraft(key: string, type: WorkflowStepType = 'agent_run'): StepDraft {
  return {
    key,
    type,
    name: '',
    agentId: '',
    agentIds: '',
    handoffFromStepId: '',
    handoffPrompt: '',
    roomPrompt: '',
    approvalPrompt: '',
    toolChainName: '',
    riskLevel: '',
    inputKeys: '',
    targetUrl: '',
    task: '',
    message: ''
  }
}

const INPUT_KEY_RE = /^[A-Za-z0-9_.-]+$/

/** Split a comma/newline separated field into trimmed, non-empty tokens. */
function tokens(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

export type BuildStepsResult =
  | { ok: true; steps: WorkflowStep[] }
  | { ok: false; error: string }

/**
 * Validate drafts and build WorkflowStep[]. Step ids are assigned positionally
 * as step_1, step_2, … which matches the server-side id scheme, so an
 * agent_handoff can reference an earlier step by that id.
 */
export function buildWorkflowSteps(drafts: StepDraft[]): BuildStepsResult {
  if (drafts.length === 0) return { ok: false, error: 'Add at least one step.' }

  const steps: WorkflowStep[] = []
  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i]!
    const label = `Step ${i + 1}`
    const id = `step_${i + 1}`
    const name = draft.name.trim()
    if (!name) return { ok: false, error: `${label}: name is required.` }
    if (name.length > 120) return { ok: false, error: `${label}: name is too long (max 120).` }

    const base = { id, name }

    switch (draft.type) {
      case 'agent_run': {
        const agentId = draft.agentId.trim()
        if (!agentId) return { ok: false, error: `${label}: agent id is required.` }
        steps.push({ ...base, type: 'agent_run', agentId })
        break
      }
      case 'agent_handoff': {
        const agentId = draft.agentId.trim()
        if (!agentId) return { ok: false, error: `${label}: agent id is required.` }
        const from = draft.handoffFromStepId.trim()
        if (from && !/^step_[1-9][0-9]*$/.test(from)) {
          return { ok: false, error: `${label}: handoff source must be an earlier step.` }
        }
        const prompt = draft.handoffPrompt.trim()
        steps.push({
          ...base,
          type: 'agent_handoff',
          agentId,
          ...(from ? { handoffFromStepId: from } : {}),
          ...(prompt ? { handoffPrompt: prompt } : {})
        })
        break
      }
      case 'agent_room': {
        const agentIds = tokens(draft.agentIds)
        if (agentIds.length < 2) return { ok: false, error: `${label}: add at least 2 agent ids.` }
        if (agentIds.length > 5) return { ok: false, error: `${label}: at most 5 agent ids.` }
        if (new Set(agentIds).size !== agentIds.length) {
          return { ok: false, error: `${label}: agent ids must be unique.` }
        }
        const prompt = draft.roomPrompt.trim()
        steps.push({
          ...base,
          type: 'agent_room',
          agentIds,
          ...(prompt ? { roomPrompt: prompt } : {})
        })
        break
      }
      case 'approval': {
        const prompt = draft.approvalPrompt.trim()
        steps.push({ ...base, type: 'approval', ...(prompt ? { approvalPrompt: prompt } : {}) })
        break
      }
      case 'tool_approval': {
        const inputKeys = tokens(draft.inputKeys)
        for (const key of inputKeys) {
          if (!INPUT_KEY_RE.test(key)) return { ok: false, error: `${label}: invalid input key "${key}".` }
        }
        const toolChainName = draft.toolChainName.trim()
        const prompt = draft.approvalPrompt.trim()
        steps.push({
          ...base,
          type: 'tool_approval',
          ...(toolChainName ? { toolChainName } : {}),
          ...(draft.riskLevel ? { riskLevel: draft.riskLevel } : {}),
          ...(prompt ? { approvalPrompt: prompt } : {}),
          ...(inputKeys.length ? { inputKeys } : {})
        })
        break
      }
      case 'browser_task': {
        const targetUrl = draft.targetUrl.trim()
        if (!targetUrl) return { ok: false, error: `${label}: target URL is required.` }
        try {
          new URL(targetUrl)
        } catch {
          return { ok: false, error: `${label}: target URL is not a valid URL.` }
        }
        const task = draft.task.trim()
        if (!task) return { ok: false, error: `${label}: task is required.` }
        const prompt = draft.approvalPrompt.trim()
        steps.push({
          ...base,
          type: 'browser_task',
          targetUrl,
          task,
          ...(prompt ? { approvalPrompt: prompt } : {})
        })
        break
      }
      case 'notification': {
        const message = draft.message.trim()
        steps.push({ ...base, type: 'notification', ...(message ? { message } : {}) })
        break
      }
      default:
        return { ok: false, error: `${label}: unknown step type.` }
    }
  }

  return { ok: true, steps }
}
